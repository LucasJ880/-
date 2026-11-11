/**
 * Tender RFQ（P1-2）— 准备一轮询价 → PendingAction（tender.send_rfq）
 *
 * 流程：项目/组织 → 轮次锁 → 供应商就绪（显式 > 名称提示 > 个人偏好 > 候选列表）→ 已确认要求 + 关键事实 → buildRfqDocument
 *       → 创建 ProjectInquiry(draft) + items → 每家渲染邮件 → requestApproval（审批卡）
 *
 * 本函数零出站。真正发送只在 execute.ts（批准后）。
 *
 * 调用方：Muse `rfq` 意图（source=muse）与项目页「问供应商要价」（W-1，source=web）——两边共用同一流程。
 * loadRfqRoundLockState / loadRfqRequirementInputs 也被 web-entry.ts 的入口预判复用，保证「按钮可点」与「真正送审」判定一致。
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { RoundNumberTakenError, addInquiryItem, createInquiry } from "@/lib/inquiry/service";
import { buildRfqDocument, renderRfqEmail, type RfqFactInput, type RfqRequirementInput } from "./build";
import {
  decideRoundLock,
  factFromText,
  hashRfqPayloadItems,
  partitionSuppliers,
  previewRfqPayload,
  readCriticalFactSlot,
  readTenderRfqSettings,
  type ExistingRound,
  type RoundLockVerdict,
} from "./round-pure";
import { chaseTemplateHash, resolveChaseAfterDays } from "./chase-pure";
import { buildFollowUpPolicy } from "./followup-coverage";
import { AUTO_DRAFT_TITLE_PREFIX, AUTO_DRAFT_TOOL_NAME, autoDraftPreviewLineZh } from "./auto-draft-pure";
import { isRfqFollowUpPreapprovalEnabledForOrg } from "./followup-flags";
import { TENDER_SEND_RFQ_TYPE, type RfqFollowUpPolicy, type TenderSendRfqPayload } from "./types";
import { pickRfqIncoterm, pickRfqSuppliers, readUserPrefs } from "@/lib/muse-bridge/prefs-pure";

const RFQ_FACT_TYPES = ["quantity", "delivery", "location", "warranty", "scope"] as const;

export type PrepareRfqInput = {
  projectId: string;
  orgId: string;
  userId: string;
  /**
   * 入口来源：写进审批卡 source.toolName 供审计区分。
   * auto = RFQ-AUTO-2 要求审核完后由系统起草（标题与摘要标明；不带跟进授权——那只在 web 且明确勾选时写）。
   */
  source: "web" | "muse" | "auto";
  /** RFQ-AUTO-2：只在项目还没有任何轮次时才建（并发或重复触发时最多建出一个第 1 轮）；否则返回 ROUND_LOCKED，不建任何东西 */
  onlyIfFirstRound?: boolean;
  supplierIds?: string[];
  /** 没给 supplierIds 时按名称模糊匹配 */
  supplierHint?: string | null;
  scopeNote?: string | null;
  extraQuestions?: string[];
  incoterm?: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null;
  destination?: string | null;
  quantityTiers?: number[];
  /** RFQ-AUTO-1：这一轮的催单与追问随本卡一并批准。只在网页发起、开关打开时生效；Muse 不传 */
  autoFollowUp?: boolean;
  now?: Date;
};

export type PrepareRfqResult =
  | {
      ok: true;
      actionId: string;
      inquiryId: string;
      roundNumber: number;
      preview: string;
      replyBy: string | null;
      /** RFQ-AUTO-1：写进审批卡的跟进授权；null = 这一轮不带授权 */
      followUpPolicy: RfqFollowUpPolicy | null;
      fromName: string;
      fromEmail: string;
      suppliers: Array<{ id: string; name: string; to: string }>;
      blockedSuppliers: Array<{ id: string; name: string; reason: "no_email" | "inactive" }>;
      excludedRequirements: number;
      /** 供应商从哪来：显式指定 / 名称提示 / 操作者的常用供应商（P1-8 偏好） */
      supplierSource: "explicit" | "hint" | "prefs";
      incoterm: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null;
      incotermFromPrefs: boolean;
    }
  | {
      ok: false;
      errorCode:
        | "PROJECT_NOT_FOUND"
        | "ROUND_LOCKED"
        | "NO_SUPPLIERS"
        | "SUPPLIERS_NOT_READY"
        | "NO_CONFIRMED_REQUIREMENTS"
        | "SENSITIVE_LEAK"
        | "DRAFT_FAILED";
      message: string;
      /** NO_SUPPLIERS 时给候选，让 Muse 渲染成可选项 */
      candidates?: Array<{ id: string; name: string; contactEmail: string | null }>;
      blockedSuppliers?: Array<{ id: string; name: string; reason: "no_email" | "inactive" }>;
    };

export async function prepareRfqRound(input: PrepareRfqInput): Promise<PrepareRfqResult> {
  const now = input.now ?? new Date();

  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId, workDomain: "tender" },
    select: { id: true, name: true, closeDate: true, ownerId: true, org: { select: { settingsJson: true } } },
  });
  if (!project) return { ok: false, errorCode: "PROJECT_NOT_FOUND", message: "没找到这个投标项目，或它不属于你的组织。" };
  const settings = readTenderRfqSettings(project.org?.settingsJson);

  // ── 轮次锁 ──
  const { lock } = await loadRfqRoundLockState({ orgId: input.orgId, projectId: project.id, now, roundLockDays: settings.roundLockDays });
  if (lock.locked) return { ok: false, errorCode: "ROUND_LOCKED", message: lock.message };

  // ── 供应商：显式 > 名称提示 > 操作者的常用供应商（偏好）> 候选列表 ──
  const prefs = readUserPrefs(project.org?.settingsJson, input.userId);
  const pick = pickRfqSuppliers({ supplierIds: input.supplierIds, supplierHint: input.supplierHint, prefs });
  const listCandidates = async (): Promise<PrepareRfqResult> => {
    const candidates = await db.supplier.findMany({
      where: { orgId: input.orgId, status: "active" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, name: true, contactEmail: true },
    });
    return { ok: false, errorCode: "NO_SUPPLIERS", message: "要问哪几家？", candidates };
  };
  if (pick.source === "candidates") return listCandidates();
  const where =
    pick.source === "hint"
      ? { orgId: input.orgId, name: { contains: pick.hint, mode: "insensitive" as const } }
      : { orgId: input.orgId, id: { in: pick.supplierIds } };
  const supplierRows = await db.supplier.findMany({ where, select: { id: true, name: true, contactEmail: true, status: true } });
  // RFQ-AUTO-2：自动起草时收件人按传入的顺序排（= 操作者保存常用供应商的顺序）；其余入口保持原样
  const order = input.source === "auto" && pick.source === "explicit" ? new Map(pick.supplierIds.map((id, i) => [id, i])) : null;
  const suppliers = order ? [...supplierRows].sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0)) : supplierRows;
  const { ready, blocked } = partitionSuppliers(suppliers);
  // 常用供应商都发不了（已删 / 没邮箱 / 停用）→ 回候选列表让人选，而不是报错
  if (ready.length === 0 && pick.source === "prefs") return listCandidates();
  if (ready.length === 0) {
    return {
      ok: false,
      errorCode: "SUPPLIERS_NOT_READY",
      message: blocked.length
        ? `这些供应商还发不了：${blocked.map((b) => `${b.name}（${b.reason === "no_email" ? "没有邮箱" : "已停用"}）`).join("、")}。先在青砚补上联系邮箱。`
        : "没匹配到供应商。",
      blockedSuppliers: blocked,
    };
  }

  // ── 要求 + 事实（最新非 SUPERSEDED 的 run） ──
  const { requirements, facts } = await loadRfqRequirementInputs(project.id);

  // Web 表单总是提交用户的显式选择（默认值已预填进下拉框），null = 用户选了「不指定」，不能再回退到个人默认；
  // Muse 不带 incoterm 时仍按偏好补齐（P1-8 行为不变）。
  const term = input.source === "web" ? { incoterm: input.incoterm ?? null, fromPrefs: false } : pickRfqIncoterm(input.incoterm, prefs);
  const built = buildRfqDocument({
    projectName: project.name,
    buyerDisplayName: settings.fromName,
    closeDate: project.closeDate ? project.closeDate.toISOString() : null,
    now,
    requirements,
    facts,
    quantityTiers: input.quantityTiers,
    incoterm: term.incoterm,
    destination: input.destination ?? null,
    replyLeadDays: settings.replyLeadDays,
    extraQuestions: input.extraQuestions,
    scopeNote: input.scopeNote ?? null,
  });
  if (!built.ok) return { ok: false, errorCode: built.errorCode, message: built.message };
  const doc = built.doc;

  // ── 建轮次（draft，零出站） ──
  let inquiry: Awaited<ReturnType<typeof createInquiry>>;
  try {
    inquiry = await createInquiry(
      // 标题留空 → createInquiry 默认「第 N 轮询价」（原硬编码的「第 N 轮询价（Muse）」未插值，界面会显示字面 N）
      { projectId: project.id, scope: doc.scopeNote ?? undefined, dueDate: doc.replyBy ?? undefined, ...(input.onlyIfFirstRound ? { expectRoundNumber: 1 } : {}) },
      input.userId,
    );
  } catch (err) {
    if (err instanceof RoundNumberTakenError) return { ok: false, errorCode: "ROUND_LOCKED", message: "项目已有询价轮次。" };
    throw err;
  }
  // 轮次已建、审批卡还没建成之前出任何错：把这一轮标为已取消再抛出，不留下一轮没有审批卡的草稿
  try {
    return await draftRoundCard(input, { project, settings, doc, inquiry, ready, blocked, requirements, term, supplierSource: pick.source });
  } catch (err) {
    await db.projectInquiry.update({ where: { id: inquiry.id }, data: { status: "canceled" } }).catch(() => undefined);
    throw err;
  }
}

type DraftRoundContext = {
  project: { id: string; name: string; ownerId: string; org: { settingsJson: unknown } | null };
  settings: ReturnType<typeof readTenderRfqSettings>;
  doc: Extract<ReturnType<typeof buildRfqDocument>, { ok: true }>["doc"];
  inquiry: Awaited<ReturnType<typeof createInquiry>>;
  ready: ReturnType<typeof partitionSuppliers>["ready"];
  blocked: ReturnType<typeof partitionSuppliers>["blocked"];
  requirements: RfqRequirementInput[];
  term: { incoterm: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null; fromPrefs: boolean };
  supplierSource: "explicit" | "hint" | "prefs";
};

/** 给刚建好的轮次加询价项、建发询价审批卡（零出站） */
async function draftRoundCard(input: PrepareRfqInput, c: DraftRoundContext): Promise<PrepareRfqResult> {
  const { project, settings, doc, inquiry, ready, blocked, requirements, term } = c;
  const pick = { source: c.supplierSource };
  const items: TenderSendRfqPayload["items"] = [];
  for (const s of ready) {
    const item = await addInquiryItem({ projectId: project.id, inquiryId: inquiry.id }, s.id, input.userId);
    const mail = renderRfqEmail(doc, { supplierName: s.name, roundNumber: inquiry.roundNumber });
    items.push({ inquiryItemId: item.id, supplierId: s.id, supplierName: s.name, to: s.contactEmail, subject: mail.subject, body: mail.body });
  }

  // RFQ-AUTO-1 跟进授权：网页发起 + 明确勾选 + 开关打开才写。间隔按项目负责人的偏好（与催单扫描同一口径），与回复截止一起在此定格。
  const followUpPolicy =
    input.source === "web" && input.autoFollowUp === true && isRfqFollowUpPreapprovalEnabledForOrg(input.orgId)
      ? buildFollowUpPolicy({
          chaseAfterDays: resolveChaseAfterDays(readUserPrefs(project.org?.settingsJson, project.ownerId).chaseAfterDays, project.org?.settingsJson),
          replyBy: doc.replyBy,
          templateHash: chaseTemplateHash(),
        })
      : null;

  // RFQ-AUTO-2：自动起草的卡在标题与摘要里标明，摘要写明供应商取自谁的常用供应商
  const autoDraftNote =
    input.source === "auto"
      ? autoDraftPreviewLineZh((await db.user.findUnique({ where: { id: input.userId }, select: { name: true } }))?.name ?? "", {
          confirmedCount: doc.lineItems.length,
          unconfirmedCount: requirements.filter((r) => r.reviewStatus === "AI_EXTRACTED").length,
        })
      : null;

  const payload: TenderSendRfqPayload = {
    projectId: project.id,
    inquiryId: inquiry.id,
    roundNumber: inquiry.roundNumber,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    items,
    rfqDocHash: hashRfqPayloadItems(items),
    incoterm: term.incoterm,
    // 不带授权时不写这个键：载荷与本功能之前逐字节相同
    ...(followUpPolicy ? { followUpPolicy } : {}),
  };

  // 新审批一律走 canonical 入口 requestApproval（runtime-architecture 守卫禁止新代码直接调旧的草稿创建 helper）
  const approval = await requestApproval({
    orgId: input.orgId,
    principal: { userId: input.userId, actorType: "user" },
    actionType: TENDER_SEND_RFQ_TYPE,
    // 带跟进授权时标题里就写明：只显示标题的界面（通知、列表）也看得出批的不只是首封
    title: `${autoDraftNote ? AUTO_DRAFT_TITLE_PREFIX : ""}发送第 ${inquiry.roundNumber} 轮询价给 ${items.length} 家供应商${followUpPolicy ? "（含自动跟进授权）" : ""} — ${project.name}`,
    preview: autoDraftNote ? `${previewRfqPayload(payload)}\n${autoDraftNote}` : previewRfqPayload(payload),
    payload: payload as unknown as Record<string, unknown>,
    // 对外发邮件：与 revenue-spine 跟进邮件同级
    risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
    source: { module: "tender-rfq.service", toolName: input.source === "web" ? "tender_send_rfq_web" : input.source === "auto" ? AUTO_DRAFT_TOOL_NAME : "tender_send_rfq", stepKey: `rfq:${inquiry.id}` },
    business: { projectId: project.id },
    ttlHours: 72,
    idempotencyKey: `${TENDER_SEND_RFQ_TYPE}:${inquiry.id}`,
  });
  if (!approval.ok) {
    // 审批卡没建成：把刚建的草稿轮次标为已取消，免得留下一轮「看似可手工发送」的孤儿草稿（draft → canceled 是合法流转）
    await db.projectInquiry.update({ where: { id: inquiry.id }, data: { status: "canceled" } }).catch(() => undefined);
    return { ok: false, errorCode: "DRAFT_FAILED", message: `生成审批草稿失败：${approval.error}` };
  }
  const actionId = approval.actionIds[0] ?? "";

  return {
    ok: true,
    actionId,
    inquiryId: inquiry.id,
    roundNumber: inquiry.roundNumber,
    preview: payload.items.map((i) => `${i.supplierName} <${i.to}>`).join("、"),
    replyBy: doc.replyBy,
    followUpPolicy,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    suppliers: items.map((i) => ({ id: i.supplierId, name: i.supplierName, to: i.to })),
    blockedSuppliers: blocked,
    excludedRequirements: doc.excluded.length,
    supplierSource: pick.source,
    incoterm: term.incoterm,
    incotermFromPrefs: term.fromPrefs,
  };
}

/* ---------------------------------- 共用加载器（prepare 与 W-1 入口预判） ---------------------------------- */

export type RfqPendingSend = { actionId: string; inquiryId: string; createdAt: Date };

/** 读本项目各轮次 + 待批 / 已批未执行的 tender.send_rfq → decideRoundLock。只读。 */
export async function loadRfqRoundLockState(input: {
  orgId: string;
  projectId: string;
  now: Date;
  roundLockDays: number;
}): Promise<{ existing: ExistingRound[]; lock: RoundLockVerdict; pendingSends: RfqPendingSend[] }> {
  const rounds = await db.projectInquiry.findMany({
    where: { projectId: input.projectId },
    select: {
      id: true,
      roundNumber: true,
      status: true,
      createdAt: true,
      createdById: true,
      items: { select: { status: true } },
    },
  });
  const pendingRows = await db.pendingAction.findMany({
    where: { orgId: input.orgId, projectId: input.projectId, type: TENDER_SEND_RFQ_TYPE, status: { in: ["pending", "approved"] } },
    select: { id: true, createdAt: true, payload: true },
    orderBy: { createdAt: "desc" },
  });
  const pendingSends: RfqPendingSend[] = [];
  for (const p of pendingRows) {
    const inquiryId = (p.payload as { inquiryId?: string } | null)?.inquiryId;
    if (inquiryId) pendingSends.push({ actionId: p.id, inquiryId, createdAt: p.createdAt });
  }
  const pendingInquiryIds = new Set(pendingSends.map((p) => p.inquiryId));
  const creatorIds = [...new Set(rounds.map((r) => r.createdById))];
  const creators = creatorIds.length ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(creators.map((u) => [u.id, u.name]));
  const existing: ExistingRound[] = rounds.map((r) => ({
    inquiryId: r.id,
    roundNumber: r.roundNumber,
    status: r.status,
    createdAt: r.createdAt,
    createdByName: nameOf.get(r.createdById) ?? null,
    sentCount: r.items.filter((i) => i.status !== "pending").length,
    hasPendingSend: pendingInquiryIds.has(r.id),
  }));
  return { existing, lock: decideRoundLock(existing, input.now, input.roundLockDays), pendingSends };
}

/** 最新可用分析运行（REVIEW_REQUIRED / APPROVED）的要求 + 关键事实槽。只读。 */
export async function loadRfqRequirementInputs(projectId: string): Promise<{ requirements: RfqRequirementInput[]; facts: RfqFactInput[] }> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      summaryJson: true,
      requirements: {
        select: { requirementCode: true, category: true, originalRequirement: true, chineseTranslation: true, mandatory: true, reviewStatus: true, sourcePage: true },
        orderBy: { requirementCode: "asc" },
      },
    },
  });
  const requirements: RfqRequirementInput[] = run?.requirements ?? [];

  const facts: RfqFactInput[] = [];
  if (run) {
    const factIds: Array<{ type: string; factId: string }> = [];
    for (const t of RFQ_FACT_TYPES) {
      const slot = readCriticalFactSlot(run.summaryJson, t);
      if (!slot) continue;
      if ("text" in slot) facts.push(factFromText(t, slot.text));
      else factIds.push({ type: t, factId: slot.factId });
    }
    if (factIds.length) {
      const rows = await db.tenderAnalysisFact.findMany({
        where: { id: { in: factIds.map((f) => f.factId) } },
        select: { id: true, contentZh: true, contentOriginal: true, confidence: true, manuallyConfirmed: true },
      });
      for (const f of factIds) {
        const r = rows.find((x) => x.id === f.factId);
        if (r) facts.push({ type: f.type, contentZh: r.contentZh, contentOriginal: r.contentOriginal, confidence: r.confidence, manuallyConfirmed: r.manuallyConfirmed });
      }
    }
  }
  return { requirements, facts };
}
