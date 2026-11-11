/**
 * RFQ-AUTO-2 要求确认后自动起草第 1 轮询价 — 纯逻辑（判定 / 选供应商 / 对外结果）
 *
 * 系统只起草：产出一张待批的发询价审批卡，不批准、不发信。
 * 判定是查表：条件按固定顺序检查，返回第一条不满足的原因；不调用模型。
 * 供应商只来自操作者自己保存的常用供应商——不按品类、标签、评分增补或替换。
 */

import type { EntryAction, EntryBlockReason } from "./web-entry-pure";

/** 自动起草的审批卡来源标记（写进审批卡载荷的元数据，供审计与轮次列表识别） */
export const AUTO_DRAFT_TOOL_NAME = "tender_send_rfq_auto" as const;
export const AUTO_DRAFT_AUDIT_ACTION = "tender.rfq_auto_draft" as const;
/** 与「问供应商要价」抽屉的上限一致 */
export const AUTO_DRAFT_MAX_SUPPLIERS = 8;

export const AUTO_DRAFT_TRIGGERS = ["approve_run", "confirm_requirement", "batch_confirm", "reject_requirement"] as const;
export type AutoDraftTrigger = (typeof AUTO_DRAFT_TRIGGERS)[number];

export const AUTO_DRAFT_REASONS = [
  "FLAG_OFF",
  "RUN_NOT_APPROVED",
  "ROUND_EXISTS",
  "NO_CONFIRMED_REQUIREMENTS",
  "SENSITIVE_LEAK",
  "SENDER_NOT_READY",
  "NO_DEFAULT_SUPPLIERS",
  "DRAFT_FAILED",
] as const;
export type AutoDraftReason = (typeof AUTO_DRAFT_REASONS)[number];

/* ---------------------------------- 选供应商 ---------------------------------- */

export type AutoDraftSupplierInput = { id: string; name: string; contactEmail: string | null; status: string };
export type AutoDraftSkipped = { id: string; name: string; reason: "no_email" | "inactive" | "not_found" | "over_limit" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 按操作者保存的顺序取在用且有邮箱的常用供应商，最多 8 家。
 * 就绪规则与 round-pure.partitionSuppliers 逐字一致（status=active 且原始 contactEmail 通过同一正则）——
 * 这里说能发的，建轮次时一定能发（测试里用 partitionSuppliers 做对照）。
 */
export function pickAutoDraftSuppliers(
  defaultSupplierIds: readonly string[],
  suppliers: readonly AutoDraftSupplierInput[],
  max: number = AUTO_DRAFT_MAX_SUPPLIERS,
): { picked: Array<{ id: string; name: string }>; skipped: AutoDraftSkipped[] } {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const picked: Array<{ id: string; name: string }> = [];
  const skipped: AutoDraftSkipped[] = [];
  const seen = new Set<string>();
  for (const id of defaultSupplierIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    if (!s) {
      skipped.push({ id, name: "", reason: "not_found" });
    } else if (s.status !== "active") {
      skipped.push({ id, name: s.name, reason: "inactive" });
    } else if (!s.contactEmail || !EMAIL_RE.test(s.contactEmail)) {
      skipped.push({ id, name: s.name, reason: "no_email" });
    } else if (picked.length >= max) {
      skipped.push({ id, name: s.name, reason: "over_limit" });
    } else {
      picked.push({ id: s.id, name: s.name });
    }
  }
  return { picked, skipped };
}

/* ---------------------------------- 判定 ---------------------------------- */

export type AutoDraftFacts = {
  flagEnabled: boolean;
  /** 这次动作所属的分析：是不是项目当前有效的那一份、状态 */
  run: { isCurrent: boolean; status: string };
  /** 项目已有的询价轮次数（含已取消） */
  roundCount: number;
  /** 既有询价入口对这个操作者的结论：null = 可以发 */
  entryBlock: EntryBlockReason | null;
  /** 操作者的常用供应商里就绪的那几家（pickAutoDraftSuppliers 的结果） */
  pickedSupplierCount: number;
};

export type AutoDraftDecision = { draft: true } | { draft: false; reason: AutoDraftReason };

const ENTRY_BLOCK_TO_REASON: Record<EntryBlockReason, AutoDraftReason> = {
  // 这两种锁只在项目已有轮次时出现
  pending_approval: "ROUND_EXISTS",
  recently_sent: "ROUND_EXISTS",
  no_confirmed_requirements: "NO_CONFIRMED_REQUIREMENTS",
  sensitive_leak: "SENSITIVE_LEAK",
  sender_not_connected: "SENDER_NOT_READY",
  sender_no_compose_scope: "SENDER_NOT_READY",
  // 组织里一家就绪的供应商都没有 → 操作者自然也没有就绪的常用供应商
  no_ready_suppliers: "NO_DEFAULT_SUPPLIERS",
};

/** 是否自动起草。确定性；检查顺序固定，返回第一条不满足的原因。 */
export function decideAutoDraft(f: AutoDraftFacts): AutoDraftDecision {
  const no = (reason: AutoDraftReason): AutoDraftDecision => ({ draft: false, reason });
  if (!f.flagEnabled) return no("FLAG_OFF");
  if (!f.run.isCurrent || f.run.status !== "APPROVED") return no("RUN_NOT_APPROVED");
  if (f.roundCount > 0) return no("ROUND_EXISTS");
  if (f.entryBlock) return no(ENTRY_BLOCK_TO_REASON[f.entryBlock]);
  if (f.pickedSupplierCount <= 0) return no("NO_DEFAULT_SUPPLIERS");
  return { draft: true };
}

/* ---------------------------------- 对外结果 ---------------------------------- */

/**
 * 审核接口响应里的 rfqAutoDraft。只有这几个字段——不含供应商联系方式、我方价格、项目估值或毛利率。
 * quiet = 这次不必在界面上提示（审核过程中的常态：分析还没批准、项目已有轮次）；字段本身仍在响应里。
 */
export type RfqAutoDraftResult =
  | { drafted: true; roundNumber: number; supplierCount: number; skippedCount: number; unconfirmedCount: number; messageZh: string; href: string; quiet: false }
  | { drafted: false; reason: Exclude<AutoDraftReason, "FLAG_OFF">; messageZh: string; action: EntryAction | null; quiet: boolean };

const bidTabHref = (projectId: string) => `/projects/${encodeURIComponent(projectId)}?tab=bid`;
export const autoDraftRoundHref = (projectId: string, inquiryId: string) => `${bidTabHref(projectId)}#rfq-round-${encodeURIComponent(inquiryId)}`;

export function autoDraftDone(input: { projectId: string; inquiryId: string; roundNumber: number; supplierCount: number; skippedCount: number; unconfirmedCount: number }): RfqAutoDraftResult {
  const skipped = input.skippedCount > 0 ? `（常用供应商里有 ${input.skippedCount} 家停用、没有邮箱或超出上限，已跳过）` : "";
  // 批准分析即视为审核完成：询价单只带已确认的要求，没确认的不带——这里说清楚有几条没带上
  const unconfirmed = input.unconfirmedCount > 0 ? `询价单只带已确认的要求，另有 ${input.unconfirmedCount} 条没有确认的没带上。` : "";
  return {
    drafted: true,
    roundNumber: input.roundNumber,
    supplierCount: input.supplierCount,
    skippedCount: input.skippedCount,
    unconfirmedCount: input.unconfirmedCount,
    messageZh: `已为你起草第 ${input.roundNumber} 轮询价：${input.supplierCount} 家常用供应商${skipped}。${unconfirmed}还没有发出，批准后才发。`,
    href: autoDraftRoundHref(input.projectId, input.inquiryId),
    quiet: false,
  };
}

/** 没起草：原因 → 一句话 + 去处。审核过程中必然反复出现的原因标为 quiet，避免每点一下都提示。 */
export function autoDraftBlocked(
  reason: Exclude<AutoDraftReason, "FLAG_OFF">,
  ctx: { projectId: string; trigger: AutoDraftTrigger },
): RfqAutoDraftResult {
  const rfqEntry: EntryAction = { label: "去「标书与报价」发询价", href: bidTabHref(ctx.projectId) };
  const requirements: EntryAction = { label: "去「需求」", href: `/projects/${encodeURIComponent(ctx.projectId)}?tab=requirements` };
  const blocked = (messageZh: string, action: EntryAction | null, quiet = false): RfqAutoDraftResult => ({ drafted: false, reason, messageZh, action, quiet });
  switch (reason) {
    case "RUN_NOT_APPROVED":
      return blocked("招标分析还没有批准（或已有更新的一份），没有自动起草询价。", null, true);
    case "ROUND_EXISTS":
      return blocked("项目已有询价轮次，不再自动起草。", rfqEntry, true);
    case "NO_CONFIRMED_REQUIREMENTS":
      return blocked("没有已确认的要求，询价单会是空的，没有自动起草。", requirements);
    case "SENSITIVE_LEAK":
      return blocked("要求里含有不能发给供应商的内容（如我方价格或内部备注），没有自动起草。", requirements);
    case "SENDER_NOT_READY":
      return blocked("发询价的授权邮箱还没连接好，没有自动起草。", { label: "去连接邮箱", href: "/settings/email" });
    case "NO_DEFAULT_SUPPLIERS":
      return blocked("你还没有能发询价的常用供应商，没有自动起草。在询价入口手动选一次，之后选定报价的供应商会成为常用。", rfqEntry);
    case "DRAFT_FAILED":
      return blocked("自动起草询价没有成功，可以在询价入口手动发起。", rfqEntry);
  }
}

/* ---------------------------------- 审批卡与轮次列表上的标记 ---------------------------------- */

export const AUTO_DRAFT_TITLE_PREFIX = "自动起草：";
/** 摘要里那一行的固定开头：轮次列表靠它把这一行从卡的摘要里取出来，显示在原地审批处 */
export const AUTO_DRAFT_PREVIEW_PREFIX = "系统在招标分析批准后自动起草";
export const AUTO_DRAFT_NOTE_FALLBACK = "系统在招标分析批准后自动起草，供应商取自操作者的常用供应商。请核对收件人与正文后再批准。";
export function autoDraftPreviewLineZh(userName: string, counts: { confirmedCount: number; unconfirmedCount: number }): string {
  const unconfirmed = counts.unconfirmedCount > 0 ? `，另有 ${counts.unconfirmedCount} 条没有确认的没带上` : "";
  return `${AUTO_DRAFT_PREVIEW_PREFIX}；供应商取自 ${userName || "操作者"} 的常用供应商；询价单带了 ${counts.confirmedCount} 条已确认的要求${unconfirmed}。请核对收件人与正文后再批准。`;
}

/**
 * 从发询价审批卡里认出自动起草的轮次（靠载荷元数据里的来源标记），并取出摘要里的那一行说明：
 * inquiryId → 说明。说明只可能是 autoDraftPreviewLineZh 生成的那一行；取不到就用固定的兜底句。
 */
export function autoDraftedRoundNotes(cards: ReadonlyArray<{ payload: unknown; preview?: string | null }>): Record<string, { noteZh: string }> {
  const out: Record<string, { noteZh: string }> = {};
  for (const c of cards) {
    const p = c.payload as { inquiryId?: unknown; metadata?: { sourceToolName?: unknown } } | null;
    if (!p || typeof p.inquiryId !== "string" || p.metadata?.sourceToolName !== AUTO_DRAFT_TOOL_NAME) continue;
    const line = (c.preview ?? "").split("\n").find((l) => l.startsWith(AUTO_DRAFT_PREVIEW_PREFIX));
    out[p.inquiryId] = { noteZh: line ?? AUTO_DRAFT_NOTE_FALLBACK };
  }
  return out;
}
