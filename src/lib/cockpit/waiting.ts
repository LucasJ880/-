/**
 * 组织驾驶舱 — "等你 N 件"（A-2，openspec change org-cockpit-read-model）
 *
 * 口径：/capabilities/approvals 的"待我审批"（PendingAction / ApprovalRequest / 产品内容审批，
 * 待审批且调用者有决策权）∪ 本组织 workforce 需要你的作业。作业关联的 PendingAction
 * 全部已在待我审批里时不再单独计数；需决策类通知只是这些条目的提醒，不另计。
 *
 * 纯函数：调用方把查询结果与关联表（PendingAction 上下文、项目工作域、AgentRun 类型）传入。
 */

import { containsOutboundSensitive } from "@/lib/muse-bridge/contract";
import { POST_KEYS, UNCLASSIFIED_PROJECT_DOMAIN, postForPendingAction, postForWorkDomain, type PostKey } from "./posts";

// ── 脱敏 ──────────────────────────────────────────────────────

export const COCKPIT_REDACTED = "（该内容含内部财务信息，驾驶舱不展示，请到对应页面查看。）";
const TEXT_MAX = 300;

/**
 * Muse 的检测覆盖 estimatedValue / ourBidPrice / winningBidPrice / margin / 毛利 / 内部成本 / 预算上限（strict 再加利润 / profit），
 * 但不含估值、标的额、我方报价、最终报价、中标金额等中文说法——驾驶舱在本地补上（不改 muse-bridge）。
 */
export const COCKPIT_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /估值/,
  /\bvaluation\b/i,
  /标的额/,
  /我方(最终)?报价/,
  /最终报价/,
  /中标(金额|价)/,
  /成交价/,
  /\bbid\s*price\b/i,
];

/** 截断后经 Muse 的敏感词检测（strict）与驾驶舱补充词表，命中整段替换，不做局部遮盖 */
export function redactCockpitText(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  const clipped = raw.length > TEXT_MAX ? `${raw.slice(0, TEXT_MAX - 1)}…` : raw;
  const sensitive = containsOutboundSensitive(clipped, { strict: true }) || COCKPIT_SENSITIVE_PATTERNS.some((p) => p.test(clipped));
  return sensitive ? COCKPIT_REDACTED : clipped;
}

// ── 输入形状 ──────────────────────────────────────────────────

export type ApprovalSource = "PENDING_ACTION" | "APPROVAL_REQUEST" | "PRODUCT_CONTENT" | "OTHER";

/** 待我审批的一条（取自 ApprovalProjection） */
export interface PendingMineInput {
  sourceType: ApprovalSource;
  sourceId: string;
  actionType: string;
  title: string | null;
  createdAt: string;
  projectId: string | null;
}

/** PendingAction 的归属上下文（按 sourceId 批量取） */
export interface PendingActionRow {
  type: string;
  projectId: string | null;
  agentRunId: string | null;
  payload: unknown;
}

/** workforce 需要你的作业（取自 WorkforceJobListItem + AgentRun.metadata 解析出的工作域） */
export interface NeedsYouJobInput {
  jobId: string;
  title: string | null;
  needsYouTitle: string;
  pendingActionIds: readonly string[];
  lastActivityAt: string;
  workDomain: string | null;
}

export interface AttributionLookups {
  pendingActions: ReadonlyMap<string, PendingActionRow>;
  /** projectId → Project.workDomain */
  projectWorkDomains: ReadonlyMap<string, string>;
  /** agentRunId → AgentRun.runType */
  agentRunTypes: ReadonlyMap<string, string>;
}

// ── 上下文字段提取 ────────────────────────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** payload.targetType，为空再取 payload.metadata.targetType */
export function targetTypeOf(payload: unknown): string | null {
  const p = record(payload);
  return str(p?.targetType) ?? str(record(p?.metadata)?.targetType);
}

/** 所属项目：PendingAction.projectId，为空时取目标类型为 PROJECT 的 payload.targetId */
export function projectIdOf(row: PendingActionRow): string | null {
  if (row.projectId) return row.projectId;
  const p = record(row.payload);
  if (targetTypeOf(row.payload)?.toUpperCase() !== "PROJECT") return null;
  return str(p?.targetId) ?? str(record(p?.metadata)?.targetId);
}

/** 装配层需要额外查询的 id（项目工作域、产出 run 类型） */
export function lookupIdsFor(rows: Iterable<PendingActionRow>, extraProjectIds: Iterable<string | null> = []): {
  projectIds: string[];
  agentRunIds: string[];
} {
  const projectIds = new Set<string>();
  const agentRunIds = new Set<string>();
  for (const row of rows) {
    const projectId = projectIdOf(row);
    if (projectId) projectIds.add(projectId);
    if (row.agentRunId) agentRunIds.add(row.agentRunId);
  }
  for (const id of extraProjectIds) if (id) projectIds.add(id);
  return { projectIds: [...projectIds], agentRunIds: [...agentRunIds] };
}

// ── 归属 ──────────────────────────────────────────────────────

export function attributePendingMine(item: PendingMineInput, lookups: AttributionLookups): PostKey | null {
  if (item.sourceType === "PRODUCT_CONTENT") return "content";
  if (item.sourceType === "APPROVAL_REQUEST") {
    const domain = item.projectId ? lookups.projectWorkDomains.get(item.projectId)?.trim().toLowerCase() : undefined;
    // ApprovalRequest 由 project-inspection 的旧任务流产生；判定不出工作域（含未分类项目）时归项目交付
    return (domain && domain !== UNCLASSIFIED_PROJECT_DOMAIN ? postForWorkDomain(domain) : null) ?? "projects";
  }
  if (item.sourceType !== "PENDING_ACTION") return null;

  const row = lookups.pendingActions.get(item.sourceId);
  const projectId = row ? projectIdOf(row) : item.projectId;
  return postForPendingAction({
    type: row?.type ?? item.actionType,
    projectWorkDomain: projectId ? lookups.projectWorkDomains.get(projectId) ?? null : null,
    targetType: row ? targetTypeOf(row.payload) : null,
    agentRunType: row?.agentRunId ? lookups.agentRunTypes.get(row.agentRunId) ?? null : null,
  });
}

export function attributeNeedsYouJob(job: NeedsYouJobInput): PostKey | null {
  const domain = job.workDomain?.trim().toLowerCase();
  return domain ? postForWorkDomain(domain) : null;
}

// ── 合并 ──────────────────────────────────────────────────────

export type WaitingKind = "pending_action" | "approval_request" | "product_content" | "workforce_job";

export interface WaitingItem {
  kind: WaitingKind;
  id: string;
  title: string;
  post: PostKey | null;
  /** 排序时刻：审批为创建时间，需要你作业为最近活动时间 */
  at: string;
  href: string;
}

export interface WaitingForYou {
  total: number;
  truncated: boolean;
  unattributed: number;
  items: WaitingItem[];
  href: string;
}

export interface PostWaitingCounts {
  pendingApprovals: number;
  needsYou: number;
}

export const WAITING_HREF = "/capabilities/approvals";
export const WAITING_ITEMS_LIMIT = 10;

// ── 落点（VIS-1b，spec cockpit/posts-overview「等你 N 件…」；design D4）──────────

/** 审批详情页：审批 id = `<来源类型>:<来源 id>`，整段 URL 编码（与审批中心列表、报价审批接口同写法） */
export function approvalDetailHref(sourceType: ApprovalSource, sourceId: string): string {
  return `${WAITING_HREF}/${encodeURIComponent(`${sourceType}:${sourceId}`)}`;
}

type LandingFn = (payload: Record<string, unknown> | null, row: PendingActionRow | null) => string | null;
const enc = encodeURIComponent;
const quoteSheet: LandingFn = (p) => {
  const quoteId = str(p?.quoteId);
  return quoteId ? `/sales/quote-sheet?mode=order&quoteId=${enc(quoteId)}` : null;
};
const rfqRound: LandingFn = (p, row) => {
  const projectId = str(p?.projectId) ?? row?.projectId ?? null;
  const inquiryId = str(p?.inquiryId);
  return projectId && inquiryId ? `/projects/${enc(projectId)}?tab=bid#rfq-round-${enc(inquiryId)}` : null;
};

/** PendingAction 类型 → 专属落点（payload 缺对应 id 时为 null，退回审批详情） */
export const PENDING_ACTION_LANDINGS: Readonly<Record<string, LandingFn>> = {
  "sales.approve_quote_promotion": quoteSheet,
  "sales.update_signed_quote": quoteSheet,
  "sales.update_quote_settings": () => "/sales/cockpit",
  "install.send_warranty_email": (p) => {
    const orderId = str(p?.orderId);
    return orderId ? `/accounting?tab=balance&order=${enc(orderId)}` : null;
  },
  "install.send_repair_visit_email": (p) => {
    const repairId = str(p?.repairId);
    return repairId ? `/install/repairs/${enc(repairId)}` : null;
  },
  "orders.cancel_blinds_order": (p) => {
    const orderId = str(p?.orderId);
    return orderId ? `/blinds-orders/${enc(orderId)}` : null;
  },
  "tender.send_rfq": rfqRound,
  "tender.send_chase": rfqRound,
};

/** 一条待我审批的落点：专属页面，否则审批详情 */
export function approvalLandingHref(item: PendingMineInput, row: PendingActionRow | null): string {
  if (item.sourceType === "PENDING_ACTION") {
    const type = row?.type ?? item.actionType;
    const payload = record(row?.payload);
    if (type.startsWith("revenue_spine.")) return "/revenue";
    const landing = PENDING_ACTION_LANDINGS[type]?.(payload, row);
    if (landing) return landing;
  }
  return approvalDetailHref(item.sourceType, item.sourceId);
}

/** 调用者的入口判定（缺省 = 不过滤，测试与改动前口径用） */
export interface WaitingAccess {
  /** 该地址对调用者放行（与路由门同源；平台 super_admin 一律放行） */
  canOpen(href: string): boolean;
  /** 需要你作业的工作域对调用者可读（spec agents/workforce-job-scope） */
  canReadWorkDomain(domain: string | null): boolean;
}

const KIND_BY_SOURCE: Record<ApprovalSource, WaitingKind | null> = {
  PENDING_ACTION: "pending_action",
  APPROVAL_REQUEST: "approval_request",
  PRODUCT_CONTENT: "product_content",
  OTHER: null,
};

function byNewest(a: WaitingItem, b: WaitingItem): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function buildWaitingForYou(input: {
  pendingMine: readonly PendingMineInput[];
  /** 待我审批过滤后的总数（可能大于已取回的条目数） */
  pendingMineTotal: number;
  pendingMineTruncated: boolean;
  jobs: readonly NeedsYouJobInput[];
  jobsTruncated: boolean;
  lookups: AttributionLookups;
  limit?: number;
  /** VIS-1b：只列落点放行的审批、只列可读的需要你作业 */
  access?: WaitingAccess;
}): { waitingForYou: WaitingForYou; perPost: Record<PostKey, PostWaitingCounts> } {
  const perPost = Object.fromEntries(POST_KEYS.map((k) => [k, { pendingApprovals: 0, needsYou: 0 }])) as Record<
    PostKey,
    PostWaitingCounts
  >;
  const items: WaitingItem[] = [];

  let listedApprovals = 0;
  const listedPendingActions = new Set<string>();
  for (const approval of input.pendingMine) {
    const kind = KIND_BY_SOURCE[approval.sourceType];
    if (!kind) continue;
    const row = approval.sourceType === "PENDING_ACTION" ? input.lookups.pendingActions.get(approval.sourceId) ?? null : null;
    const href = approvalLandingHref(approval, row);
    // 落点对调用者不放行的条目：不列、不计数（例：Sunny 的 revenue_spine.* → /revenue）
    if (input.access && !input.access.canOpen(href)) continue;
    listedApprovals++;
    if (approval.sourceType === "PENDING_ACTION") listedPendingActions.add(approval.sourceId);
    const post = attributePendingMine(approval, input.lookups);
    if (post) perPost[post].pendingApprovals++;
    items.push({
      kind,
      id: approval.sourceId,
      title: redactCockpitText(approval.title ?? approval.actionType),
      post,
      at: approval.createdAt,
      href,
    });
  }

  let separateJobs = 0;
  for (const job of input.jobs) {
    if (input.access && !input.access.canReadWorkDomain(job.workDomain)) continue;
    const post = attributeNeedsYouJob(job);
    if (post) perPost[post].needsYou++;
    const coveredByApprovals =
      job.pendingActionIds.length > 0 && job.pendingActionIds.every((id) => listedPendingActions.has(id));
    if (coveredByApprovals) continue;
    separateJobs++;
    items.push({
      kind: "workforce_job",
      id: job.jobId,
      title: redactCockpitText(job.title ?? job.needsYouTitle),
      post,
      at: job.lastActivityAt,
      href: `/workforce/${job.jobId}`,
    });
  }

  items.sort(byNewest);
  const fetchedApprovals = input.pendingMine.filter((a) => KIND_BY_SOURCE[a.sourceType] !== null).length;
  // 截断：未取到的行判不了落点，原样计入（design D4）
  const unfetchedApprovals = Math.max(0, input.pendingMineTotal - fetchedApprovals);
  return {
    waitingForYou: {
      total: listedApprovals + unfetchedApprovals + separateJobs,
      truncated: input.pendingMineTruncated || input.jobsTruncated || input.pendingMineTotal > fetchedApprovals,
      unattributed: items.filter((i) => i.post === null).length,
      items: items.slice(0, input.limit ?? WAITING_ITEMS_LIMIT),
      href: WAITING_HREF,
    },
    perPost,
  };
}
