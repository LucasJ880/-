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

/** 截断后经 Muse 的敏感词检测（strict），命中整段替换，不做局部遮盖 */
export function redactCockpitText(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  const clipped = raw.length > TEXT_MAX ? `${raw.slice(0, TEXT_MAX - 1)}…` : raw;
  return containsOutboundSensitive(clipped, { strict: true }) ? COCKPIT_REDACTED : clipped;
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
  createdAt: string;
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

const KIND_BY_SOURCE: Record<ApprovalSource, WaitingKind | null> = {
  PENDING_ACTION: "pending_action",
  APPROVAL_REQUEST: "approval_request",
  PRODUCT_CONTENT: "product_content",
  OTHER: null,
};

function byNewest(a: WaitingItem, b: WaitingItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
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
}): { waitingForYou: WaitingForYou; perPost: Record<PostKey, PostWaitingCounts> } {
  const perPost = Object.fromEntries(POST_KEYS.map((k) => [k, { pendingApprovals: 0, needsYou: 0 }])) as Record<
    PostKey,
    PostWaitingCounts
  >;
  const items: WaitingItem[] = [];

  for (const approval of input.pendingMine) {
    const kind = KIND_BY_SOURCE[approval.sourceType];
    if (!kind) continue;
    const post = attributePendingMine(approval, input.lookups);
    if (post) perPost[post].pendingApprovals++;
    items.push({
      kind,
      id: approval.sourceId,
      title: redactCockpitText(approval.title ?? approval.actionType),
      post,
      createdAt: approval.createdAt,
      href: WAITING_HREF,
    });
  }

  const listedPendingActions = new Set(
    input.pendingMine.filter((a) => a.sourceType === "PENDING_ACTION").map((a) => a.sourceId),
  );
  let separateJobs = 0;
  for (const job of input.jobs) {
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
      createdAt: job.lastActivityAt,
      href: `/workforce/${job.jobId}`,
    });
  }

  items.sort(byNewest);
  const fetchedApprovals = input.pendingMine.filter((a) => KIND_BY_SOURCE[a.sourceType] !== null).length;
  return {
    waitingForYou: {
      total: Math.max(input.pendingMineTotal, fetchedApprovals) + separateJobs,
      truncated: input.pendingMineTruncated || input.jobsTruncated || input.pendingMineTotal > fetchedApprovals,
      unattributed: items.filter((i) => i.post === null).length,
      items: items.slice(0, input.limit ?? WAITING_ITEMS_LIMIT),
      href: WAITING_HREF,
    },
    perPost,
  };
}
