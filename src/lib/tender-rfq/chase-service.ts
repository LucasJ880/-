/**
 * Tender RFQ（P1-7）— 催单 / 缺字段追问：扫描 + 起草 tender.send_chase 审批卡（DB 侧）
 *
 *   runChaseScan(orgId)：挂在 tender-rfq-inbound 每次 tick 的末尾（先收信，再判断谁该催），不新增 cron；
 *   draftChasesForProject：Muse `chase` 意图手动起草（不看天数，其它规则一样）。
 *
 * 本文件不直接发信：只建审批卡、只对 no_response 做状态迁移。真正发信只在 chase-execute.ts（批准后）。
 * 一个 item 一张卡——审批人可以只催其中一家。
 *
 * RFQ-AUTO-1：发询价的卡若带跟进授权，扫描路径（runChaseScan）对授权覆盖得住的催单 / 追问，
 * 在照常建卡之后，以批准该轮的人的身份经既有审批入口执行，不等人点；覆盖不住的照旧待批。
 * 手动路径（Muse chase 意图）不受影响。只看进行中的轮次：已取消 / 已完成的不再起草。
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { logAudit } from "@/lib/audit/logger";
import { markItemNoResponse } from "@/lib/inquiry/service";
import { readUserPrefs } from "@/lib/muse-bridge/prefs-pure";
import { parseRfqThreadId } from "./inbound-contract";
import {
  CHASE_TTL_HOURS,
  buildChasePayload,
  chaseSlot,
  chaseTemplateHash,
  chaseTitle,
  decideChases,
  parseChaseNotes,
  previewChasePayload,
  resolveChaseAfterDays,
  type ChaseCardState,
  type ChaseDecision,
  type ChaseItemSnapshot,
  type ChaseKind,
  type ChaseSkipReason,
} from "./chase-pure";
import {
  FOLLOWUP_AUTO_SEND_AUDIT_ACTION,
  FOLLOWUP_STOP_AUDIT_ACTION,
  decideFollowUpCoverage,
  parseFollowUpPolicy,
  sameChaseContent,
  type CoverageDecision,
  type CoverageReason,
  type CoverageRoundCard,
} from "./followup-coverage";
import { isRfqFollowUpPreapprovalEnabledForOrg } from "./followup-flags";
import type { InboundMissingField } from "./inbound-contract";
import { readTenderRfqSettings } from "./round-pure";
import { notifyChaseNoResponse, notifyChaseRoundDrafted } from "./tracking-notify";
import type { RoundRef } from "./tracking-notify-pure";
import { TENDER_SEND_CHASE_TYPE, TENDER_SEND_RFQ_TYPE, type RfqFollowUpPolicy, type TenderSendChasePayload } from "./types";

/** 与入站同一窗口：只看最近 90 天发出的询价 */
const OPEN_ITEM_WINDOW_DAYS = 90;

export type ChaseDraftResult = { itemId: string; supplierName: string; actionId: string; kind: ChaseKind; chaseIndex: 1 | 2 };
/** RFQ-AUTO-1：随轮次授权自动执行的一封（sent=false：执行器判定不需要发，如对方刚回复） */
export type ChaseAutoResult = ChaseDraftResult & { sent: boolean; message: string };
export type ChaseRunResult = {
  /** 建成、等人批的卡 */
  drafted: ChaseDraftResult[];
  /** RFQ-AUTO-1：授权之内、已自动执行的（不在 drafted 里，不触发「催单待批」通知） */
  autoSent: ChaseAutoResult[];
  /** RFQ-AUTO-1：这一轮有授权但这封没被覆盖的原因（这封仍在 drafted 里等人批） */
  notCovered: Array<{ itemId: string; supplierName: string; reason: CoverageReason }>;
  noResponse: Array<{ itemId: string; supplierName: string }>;
  skipped: Array<{ itemId: string; supplierName: string; reason: ChaseSkipReason }>;
  failed: Array<{ itemId: string; supplierName: string; error: string }>;
};

const emptyRun = (): ChaseRunResult => ({ drafted: [], autoSent: [], notCovered: [], noResponse: [], skipped: [], failed: [] });

/** T-1：一轮的上下文（给定时检查的站内通知用） */
export type ChaseRoundContext = {
  inquiryId: string;
  projectId: string;
  projectName: string;
  roundNumber: number;
  ownerId: string;
  roundCreatorId: string;
  /** 这一轮使用的催单天数 */
  days: number;
};

/** T-1：一轮、一次扫描新起草的全部卡 */
export type ChaseRoundDrafted = ChaseRoundContext & {
  cards: Array<{ itemId: string; supplierName: string; actionId: string; kind: ChaseKind; missingFields: InboundMissingField[] }>;
};

export type LoadedItem = {
  snapshot: ChaseItemSnapshot;
  supplierEmail: string | null;
  inquiryId: string;
  roundDueDate: Date | null;
  projectName: string;
  ownerId: string;
  roundNumber: number;
  roundCreatorId: string;
};

async function loadItems(where: { orgId: string; projectId?: string; inquiryId?: string; itemIds?: string[] }, now: Date): Promise<LoadedItem[]> {
  const rows = await db.inquiryItem.findMany({
    where: {
      ...(where.itemIds ? { id: { in: where.itemIds } } : {}),
      status: { in: ["sent", "replied", "quoted"] },
      sentAt: { gte: new Date(now.getTime() - OPEN_ITEM_WINDOW_DAYS * 86_400_000) },
      inquiry: {
        // RFQ-AUTO-1：已取消 / 已完成的轮次不再起草催单与追问（对手动与扫描两条路径都生效）。
        // 只排除这两种终态：经旧入口逐家标记发出的轮次可能仍是 draft，照旧要催。
        status: { notIn: ["canceled", "completed"] },
        ...(where.inquiryId ? { id: where.inquiryId } : {}),
        project: { orgId: where.orgId, ...(where.projectId ? { id: where.projectId } : {}) },
      },
    },
    select: {
      id: true,
      status: true,
      sentAt: true,
      unitPrice: true,
      totalPrice: true,
      deliveryDays: true,
      validUntil: true,
      quoteNotes: true,
      contactNotes: true,
      updatedAt: true,
      supplier: { select: { name: true, contactEmail: true } },
      inquiry: { select: { id: true, dueDate: true, projectId: true, roundNumber: true, createdById: true, project: { select: { name: true, ownerId: true } } } },
    },
  });
  if (rows.length === 0) return [];

  const actions = await db.pendingAction.findMany({
    where: { orgId: where.orgId, type: TENDER_SEND_CHASE_TYPE, OR: rows.map((r) => ({ idempotencyKey: { startsWith: `${TENDER_SEND_CHASE_TYPE}:${r.id}:` } })) },
    select: { idempotencyKey: true, status: true, expiresAt: true },
  });
  const cards: ChaseCardState[] = actions
    .filter((a): a is typeof a & { idempotencyKey: string } => !!a.idempotencyKey)
    .map((a) => ({
      slot: a.idempotencyKey.replace(/:r\d+$/, ""),
      state:
        a.status === "approved" || (a.status === "pending" && a.expiresAt.getTime() > now.getTime())
          ? "live"
          : a.status === "rejected"
            ? "rejected"
            : "dead",
    }));

  return rows.map((r) => ({
    snapshot: {
      itemId: r.id,
      inquiryId: r.inquiry.id,
      projectId: r.inquiry.projectId,
      supplierName: r.supplier?.name ?? "供应商",
      status: r.status,
      sentAt: r.sentAt,
      threadId: parseRfqThreadId(r.contactNotes),
      chases: parseChaseNotes(r.contactNotes),
      cards: cards.filter((c) => c.slot.startsWith(`${TENDER_SEND_CHASE_TYPE}:${r.id}:`)),
      quote: { unitPrice: r.unitPrice, totalPrice: r.totalPrice, deliveryDays: r.deliveryDays, validUntil: r.validUntil, quoteNotes: r.quoteNotes, updatedAt: r.updatedAt },
    },
    supplierEmail: r.supplier?.contactEmail ?? null,
    inquiryId: r.inquiry.id,
    roundDueDate: r.inquiry.dueDate,
    projectName: r.inquiry.project.name,
    ownerId: r.inquiry.project.ownerId,
    roundNumber: r.inquiry.roundNumber,
    roundCreatorId: r.inquiry.createdById,
  }));
}

/** 原询价那封邮件的主题与收件地址（tender.send_rfq payload 里——发出去的就是事实来源） */
async function loadRfqMail(inquiryId: string): Promise<Map<string, { subject: string; to: string }>> {
  const pa = await db.pendingAction.findFirst({
    where: { type: TENDER_SEND_RFQ_TYPE, payload: { path: ["inquiryId"], equals: inquiryId } },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const items = (pa?.payload as { items?: Array<{ inquiryItemId?: string; subject?: string; to?: string }> } | null)?.items ?? [];
  return new Map(items.filter((i) => i.inquiryItemId).map((i) => [i.inquiryItemId as string, { subject: i.subject ?? "", to: i.to ?? "" }]));
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** runForItems 的读写（T-1：可注入，让「一轮一条催单待批」能被执行测试锁住；默认就是原来的库调用） */
export type ChaseRunDeps = {
  loadOrgSettingsJson: (orgId: string) => Promise<unknown>;
  markItemNoResponse: (scope: { projectId: string; inquiryId: string; itemId: string }) => Promise<unknown>;
  loadRfqMail: (inquiryId: string) => Promise<Map<string, { subject: string; to: string }>>;
  requestApproval: typeof requestApproval;
  /** RFQ-AUTO-1：这一轮的跟进授权状态。不注入 = 没有自动跟进（与本功能之前相同） */
  loadFollowUp?: (orgId: string, inquiryId: string) => Promise<FollowUpRoundState>;
  /** RFQ-AUTO-1：以批准该轮的人的身份，经既有审批入口执行这张刚建的卡 */
  autoApprove?: (input: FollowUpAutoApproveInput) => Promise<FollowUpAutoApproveResult>;
  /** RFQ-AUTO-1：每封自动执行的跟进写一条审计 */
  writeAutoSendAudit?: (entry: FollowUpAutoSendAudit) => Promise<void>;
};

/** RFQ-AUTO-1：一轮的跟进授权状态（覆盖判定的输入，全部在这里查好） */
export type FollowUpRoundState = {
  flagEnabled: boolean;
  /** 发询价卡；roundActionId 用于审计 */
  roundCard: (CoverageRoundCard & { actionId: string }) | null;
  /** 批准人现在在本组织的成员身份 */
  approver: { active: boolean; role: string | null };
  inquiryStatus: string;
  stopped: boolean;
};

export type FollowUpAutoApproveResult = {
  ok: boolean;
  /** 邮件是否真的发出（按询价项的联系记录核对，不看文案） */
  sent: boolean;
  /** 执行没发生、卡还在待批（如批准人已无审批权）→ 留给人批 */
  stillPending: boolean;
  /** 这张卡刚被另一次扫描或某个人处理过：这里不发、不记失败、不重复留审计 */
  handledElsewhere?: boolean;
  message: string;
};

export type FollowUpAutoSendAudit = {
  orgId: string;
  projectId: string;
  inquiryId: string;
  approverUserId: string;
  roundActionId: string;
  chaseActionId: string;
  inquiryItemId: string;
  supplierName: string;
  kind: ChaseKind;
  chaseIndex: 1 | 2;
  sent: boolean;
  message: string;
  policy: RfqFollowUpPolicy;
};

const NO_FOLLOW_UP: FollowUpRoundState = { flagEnabled: false, roundCard: null, approver: { active: false, role: null }, inquiryStatus: "", stopped: false };

/** 读这一轮的跟进授权状态。开关关闭时不查库。 */
export async function loadFollowUpRoundState(orgId: string, inquiryId: string): Promise<FollowUpRoundState> {
  if (!isRfqFollowUpPreapprovalEnabledForOrg(orgId)) return NO_FOLLOW_UP;
  const [card, inquiry, stop] = await Promise.all([
    db.pendingAction.findFirst({
      where: { orgId, type: TENDER_SEND_RFQ_TYPE, payload: { path: ["inquiryId"], equals: inquiryId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, decidedById: true, payload: true },
    }),
    db.projectInquiry.findUnique({ where: { id: inquiryId }, select: { status: true } }),
    db.auditLog.findFirst({ where: { orgId, action: FOLLOWUP_STOP_AUDIT_ACTION, targetType: FOLLOWUP_AUDIT_TARGET, targetId: inquiryId }, select: { id: true } }),
  ]);
  const payload = (card?.payload ?? null) as { followUpPolicy?: unknown; fromName?: string; fromEmail?: string; items?: Array<{ inquiryItemId?: string; to?: string; supplierName?: string; subject?: string }> } | null;
  const member = card?.decidedById
    ? await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: card.decidedById } }, select: { role: true, status: true } })
    : null;
  return {
    flagEnabled: true,
    roundCard: card
      ? {
          actionId: card.id,
          status: card.status,
          decidedById: card.decidedById,
          policy: payload?.followUpPolicy ?? null,
          fromName: payload?.fromName ?? "",
          fromEmail: payload?.fromEmail ?? "",
          items: (payload?.items ?? []).filter((i) => i.inquiryItemId).map((i) => ({ inquiryItemId: i.inquiryItemId as string, to: i.to ?? "", supplierName: i.supplierName ?? "", subject: i.subject ?? "" })),
        }
      : null,
    approver: { active: member?.status === "active", role: member?.role ?? null },
    inquiryStatus: inquiry?.status ?? "",
    stopped: !!stop,
  };
}

/** 审计对象类型：一轮询价 */
export const FOLLOWUP_AUDIT_TARGET = "project_inquiry" as const;

/**
 * 以批准该轮的人的身份执行刚建的催单卡：走既有的审批入口（权限、组织、状态原子切换、载荷哈希、
 * 执行器里的全部复核都照常生效）。是否真的发出按询价项的联系记录核对。
 */
export type FollowUpAutoApproveInput = {
  actionId: string;
  orgId: string;
  approverUserId: string;
  approverRole: string | null;
  itemId: string;
  kind: ChaseKind;
  chaseIndex: 1 | 2;
  /** 覆盖判定所依据的那份载荷：库里这张卡的内容必须与它一致才执行 */
  expected: TenderSendChasePayload;
};

async function autoApproveChase(input: FollowUpAutoApproveInput): Promise<FollowUpAutoApproveResult> {
  // 覆盖判定看的是这次起草的载荷；同一幂等键下库里可能是别处先建的卡——内容不一致就不代批，留给人看
  const stored = await db.pendingAction.findFirst({ where: { id: input.actionId, orgId: input.orgId, type: TENDER_SEND_CHASE_TYPE }, select: { status: true, payload: true } });
  if (!stored) return { ok: false, sent: false, stillPending: false, message: "找不到这张催单卡" };
  if (!sameChaseContent(stored.payload, input.expected)) {
    return { ok: false, sent: false, stillPending: stored.status === "pending", message: "待批卡的内容与这次起草的不一致，留给人工批准" };
  }
  // 内容一致但已不是待批：另一次扫描或某个人刚处理过这张卡，这里什么都不做
  if (stored.status !== "pending") return { ok: false, sent: false, stillPending: false, handledElsewhere: true, message: "" };
  const { approveApprovalItem } = await import("@/lib/approval/port");
  let ok = false;
  let message = "";
  try {
    const res = await approveApprovalItem("pending_action", input.actionId, { userId: input.approverUserId, role: input.approverRole, orgId: input.orgId });
    ok = res.ok;
    message = res.message ?? res.error ?? "";
  } catch (err) {
    // 执行途中抛错：邮件可能已经发出。下面按库里的实际状态核对，照样留审计。
    message = err instanceof Error ? err.message : String(err);
  }
  const [action, item] = await Promise.all([
    db.pendingAction.findUnique({ where: { id: input.actionId }, select: { status: true } }),
    db.inquiryItem.findUnique({ where: { id: input.itemId }, select: { contactNotes: true } }),
  ]);
  const sent = parseChaseNotes(item?.contactNotes ?? null).some((c) => (input.kind === "missing_fields" ? c.kind === "missing_fields" : c.kind === "no_reply" && c.index === input.chaseIndex));
  // 抛错但邮件确实发出了 → 按已发出记（要留审计）；没发出 → 按失败处理
  return { ok: ok || sent, sent, stillPending: action?.status === "pending", message };
}

async function writeFollowUpAutoSendAudit(e: FollowUpAutoSendAudit): Promise<void> {
  await logAudit({
    userId: e.approverUserId,
    orgId: e.orgId,
    projectId: e.projectId,
    action: FOLLOWUP_AUTO_SEND_AUDIT_ACTION,
    targetType: FOLLOWUP_AUDIT_TARGET,
    targetId: e.inquiryId,
    afterData: {
      // 这不是批准人当时的一次点击：是他批准发询价卡时一并授权、由系统到点执行的
      source: "round_preapproval",
      roundActionId: e.roundActionId,
      chaseActionId: e.chaseActionId,
      inquiryItemId: e.inquiryItemId,
      supplierName: e.supplierName,
      kind: e.kind,
      chaseIndex: e.chaseIndex,
      sent: e.sent,
      message: e.message,
      policy: e.policy,
    },
  });
}

export const defaultChaseRunDeps: ChaseRunDeps = {
  loadOrgSettingsJson: async (orgId) =>
    (await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson ?? null,
  markItemNoResponse,
  loadRfqMail,
  requestApproval,
  loadFollowUp: loadFollowUpRoundState,
  autoApprove: autoApproveChase,
  writeAutoSendAudit: writeFollowUpAutoSendAudit,
};

/** 这一轮批准时是否带了跟进授权（不论现在是否仍生效）——用来决定要不要记「未覆盖」的原因 */
function roundHasPolicy(f: FollowUpRoundState): boolean {
  return f.flagEnabled && !!parseFollowUpPolicy(f.roundCard?.policy);
}

/** 轮次层面的条件都满足时返回授权（用来定催单间隔）；否则 null */
function roundPolicyInEffect(f: FollowUpRoundState): RfqFollowUpPolicy | null {
  if (!f.flagEnabled || !f.roundCard) return null;
  const policy = parseFollowUpPolicy(f.roundCard.policy);
  if (!policy || f.roundCard.status !== "executed" || !f.roundCard.decidedById || !f.approver.active || f.inquiryStatus !== "in_progress" || f.stopped) return null;
  return policy;
}

function coverageOf(f: FollowUpRoundState, payload: Parameters<typeof decideFollowUpCoverage>[0]["chase"], plan: { itemId: string; kind: ChaseKind; chaseIndex: 1 | 2; idempotencyKey: string }, now: Date, chaseReplyBy: string | null): CoverageDecision {
  return decideFollowUpCoverage({
    flagEnabled: f.flagEnabled,
    roundCard: f.roundCard,
    approverActive: f.approver.active,
    inquiryStatus: f.inquiryStatus,
    stopped: f.stopped,
    now,
    currentTemplateHash: chaseTemplateHash(),
    // 同一槽位此前起草过（过期 / 失败后重起草，幂等键带 :r<n> 后缀）→ 不自动发
    priorAttempt: plan.idempotencyKey !== chaseSlot(plan.itemId, plan.kind, plan.chaseIndex),
    chase: payload,
    chaseReplyBy,
  });
}

/**
 * 按轮次分组决策 → 起草 / 标 no_response。
 * principalUserId：手动 = 发起人；扫描 = 项目 owner（催单天数也按 owner 的偏好）。
 */
export async function runForItems(
  orgId: string,
  items: LoadedItem[],
  now: Date,
  opts: {
    manual: boolean;
    principalUserId?: string;
    /** 标了一家未响应之后（第三个参数：该轮上下文与供应商名） */
    onNoResponse?: (itemId: string, reason: "two_chases" | "deadline", ctx: ChaseRoundContext & { supplierName: string }) => Promise<void>;
    /** T-1：一轮起草完、本轮有新卡时调用一次 */
    onRoundDrafted?: (round: ChaseRoundDrafted) => Promise<void>;
  },
  deps: ChaseRunDeps = defaultChaseRunDeps,
): Promise<ChaseRunResult> {
  const out = emptyRun();
  if (items.length === 0) return out;
  const orgSettingsJson = await deps.loadOrgSettingsJson(orgId);
  const settings = readTenderRfqSettings(orgSettingsJson);

  const byRound = new Map<string, LoadedItem[]>();
  for (const it of items) byRound.set(it.inquiryId, [...(byRound.get(it.inquiryId) ?? []), it]);

  for (const [inquiryId, roundItems] of byRound) {
    const owner = roundItems[0].ownerId;
    // RFQ-AUTO-1：只有扫描路径看跟进授权；手动起草（Muse chase）照旧逐张待批
    const followUp = !opts.manual && deps.loadFollowUp ? await deps.loadFollowUp(orgId, inquiryId) : NO_FOLLOW_UP;
    const roundPolicy = roundPolicyInEffect(followUp);
    // 授权生效的轮次：间隔用批准时定格的天数（之后有人改设置不影响已批准的这一轮）
    const days = roundPolicy ? roundPolicy.chaseAfterDays : resolveChaseAfterDays(readUserPrefs(orgSettingsJson, owner).chaseAfterDays, orgSettingsJson);
    const replyBy = roundItems[0].roundDueDate;
    const decision: ChaseDecision = decideChases({ now, chaseAfterDays: days, replyBy, items: roundItems.map((i) => i.snapshot) }, { manual: opts.manual });
    const nameOf = (id: string) => roundItems.find((i) => i.snapshot.itemId === id)?.snapshot.supplierName ?? "供应商";
    const first = roundItems[0];
    const roundCtx: ChaseRoundContext = {
      inquiryId,
      projectId: first.snapshot.projectId,
      projectName: first.projectName,
      roundNumber: first.roundNumber,
      ownerId: owner,
      roundCreatorId: first.roundCreatorId,
      days,
    };

    for (const s of decision.skipped) out.skipped.push({ ...s, supplierName: nameOf(s.itemId) });

    for (const itemId of decision.noResponse) {
      const it = roundItems.find((i) => i.snapshot.itemId === itemId)!;
      try {
        await deps.markItemNoResponse({ projectId: it.snapshot.projectId, inquiryId, itemId });
        out.noResponse.push({ itemId, supplierName: it.snapshot.supplierName });
        const twoChases = it.snapshot.chases.filter((c) => c.kind === "no_reply").length >= 2;
        await opts.onNoResponse?.(itemId, twoChases ? "two_chases" : "deadline", { ...roundCtx, supplierName: it.snapshot.supplierName });
      } catch (err) {
        out.failed.push({ itemId, supplierName: it.snapshot.supplierName, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (decision.drafts.length === 0) continue;
    const roundCards: ChaseRoundDrafted["cards"] = [];
    const mails = await deps.loadRfqMail(inquiryId);
    for (const plan of decision.drafts) {
      const it = roundItems.find((i) => i.snapshot.itemId === plan.itemId)!;
      const mail = mails.get(plan.itemId);
      const to = mail?.to || it.supplierEmail || "";
      if (!to) {
        out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: "没有供应商邮箱" });
        continue;
      }
      const built = buildChasePayload({
        plan,
        projectId: it.snapshot.projectId,
        inquiryId,
        supplierName: it.snapshot.supplierName,
        to,
        threadId: it.snapshot.threadId!,
        originalSubject: mail?.subject || `询价：${it.projectName}`,
        sentAt: it.snapshot.sentAt,
        replyBy: ymd(it.roundDueDate),
        fromName: settings.fromName,
        fromEmail: settings.fromEmail,
      });
      if (!built.ok) {
        out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: built.message });
        continue;
      }
      const approval = await deps.requestApproval({
        orgId,
        principal: { userId: opts.principalUserId ?? owner, actorType: opts.manual ? "user" : "agent" },
        actionType: TENDER_SEND_CHASE_TYPE,
        title: chaseTitle(built.payload, plan.missingFields, it.projectName),
        preview: previewChasePayload(built.payload),
        payload: built.payload as unknown as Record<string, unknown>,
        // 对外发邮件：与询价发送同级
        risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
        source: { module: "tender-rfq.chase-service", toolName: "tender_send_chase", stepKey: plan.idempotencyKey },
        business: { projectId: it.snapshot.projectId },
        ttlHours: CHASE_TTL_HOURS,
        idempotencyKey: plan.idempotencyKey,
      });
      if (!approval.ok) {
        out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: approval.error });
        continue;
      }
      const actionId = approval.actionIds[0] ?? "";

      // RFQ-AUTO-1：授权覆盖得住 → 以批准该轮的人的身份执行这张刚建的卡；覆盖不住 → 照旧留作待批
      const coverage = coverageOf(followUp, built.payload, plan, now, ymd(it.roundDueDate));
      if (coverage.covered && actionId && deps.autoApprove && deps.loadFollowUp) {
        // 执行前重读一次：建卡到执行之间可能有人取消了轮次或点了停止
        const fresh = coverageOf(await deps.loadFollowUp(orgId, inquiryId), built.payload, plan, now, ymd(it.roundDueDate));
        if (fresh.covered) {
          const auto = await deps.autoApprove({ actionId, orgId, approverUserId: fresh.approverUserId, approverRole: followUp.approver.role, itemId: plan.itemId, kind: plan.kind, chaseIndex: plan.chaseIndex, expected: built.payload });
          if (auto.ok) {
            const entry: ChaseAutoResult = { itemId: plan.itemId, supplierName: it.snapshot.supplierName, actionId, kind: plan.kind, chaseIndex: plan.chaseIndex, sent: auto.sent, message: auto.message };
            out.autoSent.push(entry);
            await deps.writeAutoSendAudit?.({
              orgId,
              projectId: it.snapshot.projectId,
              inquiryId,
              approverUserId: fresh.approverUserId,
              roundActionId: followUp.roundCard?.actionId ?? "",
              chaseActionId: actionId,
              inquiryItemId: plan.itemId,
              supplierName: it.snapshot.supplierName,
              kind: plan.kind,
              chaseIndex: plan.chaseIndex,
              sent: auto.sent,
              message: auto.message,
              policy: fresh.policy,
            });
            continue;
          }
          if (auto.handledElsewhere) continue;
          if (!auto.stillPending) {
            // 执行过了但失败（如邮箱授权失效）：不自动重试。下次扫描会重起草，届时因「此前起草过」退回人工批。
            out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: auto.message || "自动跟进执行失败" });
            continue;
          }
          // 没执行、卡还在待批（如批准人已无审批权）→ 落到下面，当作普通待批卡
        } else {
          out.notCovered.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, reason: fresh.reason });
        }
      } else if (!coverage.covered && roundHasPolicy(followUp)) {
        out.notCovered.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, reason: coverage.reason });
      }
      out.drafted.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, actionId, kind: plan.kind, chaseIndex: plan.chaseIndex });
      roundCards.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, actionId, kind: plan.kind, missingFields: plan.missingFields });
    }
    if (roundCards.length > 0) await opts.onRoundDrafted?.({ ...roundCtx, cards: roundCards });
  }
  return out;
}

async function emitNoResponse(itemId: string, reason: "two_chases" | "deadline"): Promise<void> {
  const { museOnNoResponse } = await import("@/lib/muse-bridge/hooks");
  await museOnNoResponse(itemId, reason);
}

const roundRef = (c: ChaseRoundContext): RoundRef => ({
  inquiryId: c.inquiryId,
  projectId: c.projectId,
  projectName: c.projectName,
  roundNumber: c.roundNumber,
});

/**
 * cron：入站 tick 末尾调用（同一次 tick，先收信再判断谁该催）。
 * T-1：只有这里发站内通知（催单待批一轮一条、未响应每家一条）；两个回调都不向外抛错，
 * 否则 runForItems 会把已标未响应的那家再记一次 failed（design D12）。
 */
export async function runChaseScan(orgId: string, now: Date = new Date()): Promise<ChaseRunResult> {
  const items = await loadItems({ orgId }, now);
  return runForItems(orgId, items, now, {
    manual: false,
    onNoResponse: async (itemId, reason, ctx) => {
      try {
        await emitNoResponse(itemId, reason);
      } catch (err) {
        console.error(`[tender-rfq-chase] muse no_response 事件失败 item=${itemId}:`, err);
      }
      await notifyChaseNoResponse({
        orgId,
        round: roundRef(ctx),
        ownerId: ctx.ownerId,
        roundCreatorId: ctx.roundCreatorId,
        itemId,
        supplierName: ctx.supplierName,
        reason,
      });
    },
    onRoundDrafted: (round) =>
      notifyChaseRoundDrafted({ orgId, round: roundRef(round), ownerId: round.ownerId, days: round.days, cards: round.cards }),
  });
}

/** Muse `chase` 意图：立即为指定项目 / 轮次 / item 起草（不看天数；不标 no_response） */
export async function draftChasesForProject(input: {
  orgId: string;
  userId: string;
  projectId: string;
  inquiryId?: string;
  itemIds?: string[];
  now?: Date;
}): Promise<{ ok: true; run: ChaseRunResult } | { ok: false; errorCode: "PROJECT_NOT_FOUND" | "NO_ROUND"; message: string }> {
  const now = input.now ?? new Date();
  const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId, workDomain: "tender" }, select: { id: true } });
  if (!project) return { ok: false, errorCode: "PROJECT_NOT_FOUND", message: "没找到这个投标项目，或它不属于你的组织。" };
  // 不指定轮次 → 最新一轮
  const inquiryId =
    input.inquiryId ??
    (await db.projectInquiry.findFirst({ where: { projectId: project.id }, orderBy: { roundNumber: "desc" }, select: { id: true } }))?.id;
  if (!inquiryId) return { ok: false, errorCode: "NO_ROUND", message: "这个标还没有询价轮次，没有可催的供应商。" };
  const items = await loadItems({ orgId: input.orgId, projectId: project.id, inquiryId, itemIds: input.itemIds }, now);
  const run = await runForItems(input.orgId, items, now, { manual: true, principalUserId: input.userId });
  return { ok: true, run };
}
