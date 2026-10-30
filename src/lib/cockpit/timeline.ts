/**
 * 组织驾驶舱 — company.log 时间线（A-2，openspec change org-cockpit-read-model）
 *
 * 三路来源（AuditLog / AgentRunEvent / AutomationRun）转成统一信封，按 (at, id) 倒序归并、游标分页。
 * 每路由装配层各取 limit + 1 条（严格早于游标、不早于窗口起点），本模块只做纯计算。
 */

import { AUTOMATION_REGISTRY, type AutomationKey } from "@/lib/automation/registry";
import { POST_REGISTRY, postForAgentRunType, postForAutomation, postForPendingAction, postForWorkDomain, type PostKey } from "./posts";
import { auditSource, auditSummaryText, principalActorTypeOf, type TimelineSource, type TransitionDetail } from "./audit-labels";
import { AUTOMATION_SCHEDULES, maxGapMinutes } from "./schedule";
import { projectIdOf, redactCockpitText, targetTypeOf, type PendingActionRow } from "./waiting";

// ── 范围与参数 ────────────────────────────────────────────────

export const TIMELINE_DEFAULT_LIMIT = 20;
export const TIMELINE_MAX_LIMIT = 50;
export const TIMELINE_DEFAULT_DAYS = 7;
export const TIMELINE_MAX_DAYS = 7;

/**
 * AgentRunEvent 只取这些 run / 作业级结果事件（与 workforce 读模型的用户可见事件表取交集：
 * job.resume_blocked 等内部机制事件不进）。visibleToUser 列与白名单双重把关。
 */
export const TIMELINE_EVENT_TYPES = [
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.needs_human",
  "job.completed",
  "job.failed",
  "job.cancelled",
  "job.waiting_human",
  "approval.required",
  "verification.needs_human",
] as const;

const EVENT_LABELS: Record<(typeof TIMELINE_EVENT_TYPES)[number], string> = {
  "run.completed": "AI 运行完成",
  "run.failed": "AI 运行失败",
  "run.cancelled": "AI 运行已取消",
  "run.needs_human": "AI 运行需要人工处理",
  "job.completed": "作业完成",
  "job.failed": "作业失败",
  "job.cancelled": "作业已取消",
  "job.waiting_human": "作业等待人工",
  "approval.required": "需要审批",
  "verification.needs_human": "核验需要人工",
};

/**
 * 只取有岗位归属的 run 的事件：岗位认领的 runType + workforce 作业（按工作域归属）。
 * 对话类 run（conversation / assistant_dispatch / background_conversation）每次都会写 run.completed，进来会刷屏。
 */
export const TIMELINE_AGENT_RUN_TYPES: readonly string[] = [
  ...new Set([...POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]), "workforce_job"]),
];
/** 先取窗口内最近更新的这么多个 run，再按 runId 查事件（AgentRunEvent 没有 (orgId, createdAt) 索引） */
export const TIMELINE_RUN_SCAN_LIMIT = 2000;

/** 审计日志里的记账 / 查看类动作：每次 AI 运行都会写多条，不进 company.log */
export const TIMELINE_AUDIT_ACTION_DENYLIST = [
  "QUOTA_RESERVED",
  "QUOTA_COMMITTED",
  "QUOTA_RELEASED",
  "QUOTA_SETTLED",
  "QUOTA_SETTLED_RELEASED",
  "PROVIDER_STATUS_VIEWED",
  "APPROVAL_VIEWED_SENSITIVE",
] as const;

const RUN_STATUS_LABELS: Record<string, string> = {
  succeeded: "成功",
  partial: "部分失败",
  failed: "失败",
  skipped: "跳过",
  running: "运行中",
};

/** 自动化运行只取失败 / 部分失败，以及低频（最长正常间隔 ≥ 24 小时或按需）自动化的全部运行 */
export const TIMELINE_RUN_STATUSES = ["failed", "partial"] as const;
export const LOW_FREQUENCY_GAP_MINUTES = 24 * 60;

export function lowFrequencyAutomationKeys(): AutomationKey[] {
  return (Object.keys(AUTOMATION_SCHEDULES) as AutomationKey[]).filter((key) => {
    const gap = maxGapMinutes(AUTOMATION_SCHEDULES[key]);
    return gap === null || gap >= LOW_FREQUENCY_GAP_MINUTES;
  });
}

export function isTimelineAutomationRun(run: { automationKey: string; status: string }): boolean {
  return (
    (TIMELINE_RUN_STATUSES as readonly string[]).includes(run.status) ||
    (lowFrequencyAutomationKeys() as string[]).includes(run.automationKey)
  );
}

// ── 游标 ──────────────────────────────────────────────────────

export interface TimelineCursor {
  at: Date;
  /** 带来源前缀的条目 id */
  id: string;
}

const ID_PREFIX = { audit: "audit:", agent_event: "event:", automation_run: "run:" } as const;
const PREFIXES = Object.values(ID_PREFIX);

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.at.toISOString(), i: cursor.id }), "utf8").toString("base64url");
}

export function decodeTimelineCursor(raw: string): TimelineCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; i?: unknown };
    const { t, i: id } = parsed;
    if (typeof t !== "string" || typeof id !== "string") return null;
    const at = new Date(t);
    if (Number.isNaN(at.getTime()) || at.toISOString() !== t) return null;
    if (!PREFIXES.some((p) => id.startsWith(p) && id.length > p.length)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/**
 * 某一路来源相对游标的查询边界：createdAt < at，或 createdAt = at 且（同来源）原始 id < 游标原始 id。
 * 不同来源在同一时刻按前缀字典序比较：前缀小于游标前缀的整秒全部纳入，大于的全部排除。
 */
export function sourceCursorBound(
  prefix: (typeof PREFIXES)[number],
  cursor: TimelineCursor | null,
): { before: Date | null; sameInstant: "none" | "all" | { idLessThan: string } } {
  if (!cursor) return { before: null, sameInstant: "none" };
  if (cursor.id.startsWith(prefix)) return { before: cursor.at, sameInstant: { idLessThan: cursor.id.slice(prefix.length) } };
  const cursorPrefix = PREFIXES.find((p) => cursor.id.startsWith(p)) ?? "";
  return { before: cursor.at, sameInstant: prefix < cursorPrefix ? "all" : "none" };
}

export type TimelineParams = { limit: number; days: number; cursor: TimelineCursor | null };

function parseBoundedInt(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

export function parseTimelineParams(
  params: { get(name: string): string | null },
): { ok: true; value: TimelineParams } | { ok: false; error: string } {
  const limit = parseBoundedInt(params.get("limit"), TIMELINE_DEFAULT_LIMIT, TIMELINE_MAX_LIMIT);
  if (limit === null) return { ok: false, error: `limit 须为 1..${TIMELINE_MAX_LIMIT} 的整数` };
  const days = parseBoundedInt(params.get("days"), TIMELINE_DEFAULT_DAYS, TIMELINE_MAX_DAYS);
  if (days === null) return { ok: false, error: `days 须为 1..${TIMELINE_MAX_DAYS} 的整数` };
  const rawCursor = params.get("cursor");
  let cursor: TimelineCursor | null = null;
  if (rawCursor !== null) {
    cursor = decodeTimelineCursor(rawCursor);
    if (!cursor) return { ok: false, error: "cursor 无效" };
  }
  return { ok: true, value: { limit, days, cursor } };
}

// ── 信封 ──────────────────────────────────────────────────────

export type TimelineKind = keyof typeof ID_PREFIX;

export interface TimelineEntry {
  id: string;
  at: string;
  post: PostKey | null;
  /** 审计日志 = 操作人用户 id；AI 运行事件 = "ai"；自动化运行 = "system" */
  actor: string;
  actorName: string | null;
  kind: TimelineKind;
  /** 这条记录由人工、AI 还是系统产生（审计条目的 actor 仍是挂名的用户） */
  source: TimelineSource;
  summary: string;
  href: string | null;
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  userId: string;
  userName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  /** 只对商机阶段变更：白名单解析出的枚举值（读模型额外查询）；其它审计为空 */
  transition?: TransitionDetail | null;
}

export interface AgentEventRow {
  id: string;
  createdAt: Date;
  runId: string;
  eventType: string;
  title: string | null;
}

/** 不含错误信息：平台级运行流的错误文本可能带出其他组织的数据，company.log 只显示状态 */
export interface AutomationRunRow {
  id: string;
  startedAt: Date;
  automationKey: string;
  status: string;
}

export interface TimelineLookups {
  pendingActions: ReadonlyMap<string, PendingActionRow>;
  projectWorkDomains: ReadonlyMap<string, string>;
  /** runId → AgentRun 的 runType 与 metadata.workDomain */
  agentRuns: ReadonlyMap<string, { runType: string; workDomain: string | null }>;
}

function postForRun(run: { runType: string; workDomain: string | null } | undefined): PostKey | null {
  if (!run) return null;
  if (run.runType === "workforce_job") {
    const domain = run.workDomain?.trim().toLowerCase();
    return domain ? postForWorkDomain(domain) : null;
  }
  return postForAgentRunType(run.runType);
}

export function auditEntry(row: AuditRow, lookups: TimelineLookups): TimelineEntry {
  let post: PostKey | null = null;
  let principalActorType: string | null = null;
  if (row.targetType.trim().toLowerCase() === "pending_action" && row.targetId) {
    const pa = lookups.pendingActions.get(row.targetId);
    if (pa) {
      principalActorType = principalActorTypeOf(pa.payload);
      const projectId = projectIdOf(pa);
      const agentRunType = pa.agentRunId ? lookups.agentRuns.get(pa.agentRunId)?.runType ?? null : null;
      post = postForPendingAction({
        type: pa.type,
        projectWorkDomain: projectId ? lookups.projectWorkDomains.get(projectId) ?? null : null,
        targetType: targetTypeOf(pa.payload),
        agentRunType,
      });
    }
  }
  return {
    id: `${ID_PREFIX.audit}${row.id}`,
    at: row.createdAt.toISOString(),
    post,
    actor: row.userId,
    actorName: row.userName,
    kind: "audit",
    source: auditSource(row.action, row.transition, principalActorType),
    // 只用 action、目标类型与商机阶段变更的白名单枚举，不读其它变更前后数据
    summary: redactCockpitText(auditSummaryText(row.action, row.targetType, row.transition)),
    href: null,
  };
}

export function agentEventEntry(row: AgentEventRow, lookups: TimelineLookups): TimelineEntry {
  const run = lookups.agentRuns.get(row.runId);
  const label = (EVENT_LABELS as Record<string, string>)[row.eventType] ?? row.eventType;
  return {
    id: `${ID_PREFIX.agent_event}${row.id}`,
    at: row.createdAt.toISOString(),
    post: postForRun(run),
    actor: "ai",
    actorName: null,
    kind: "agent_event",
    source: "ai",
    summary: redactCockpitText(row.title?.trim() ? `${label}：${row.title}` : label),
    href: run?.runType === "workforce_job" ? `/workforce/${row.runId}` : null,
  };
}

export function automationRunEntry(row: AutomationRunRow): TimelineEntry {
  const name = AUTOMATION_REGISTRY.find((d) => d.key === row.automationKey)?.name ?? row.automationKey;
  const status = RUN_STATUS_LABELS[row.status] ?? row.status;
  return {
    id: `${ID_PREFIX.automation_run}${row.id}`,
    at: row.startedAt.toISOString(),
    post: postForAutomation(row.automationKey),
    actor: "system",
    actorName: null,
    kind: "automation_run",
    source: "system",
    summary: redactCockpitText(`${name}：${status}`),
    href: null,
  };
}

// ── 归并 ──────────────────────────────────────────────────────

function newerFirst(a: TimelineEntry, b: TimelineEntry): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function strictlyBefore(entry: TimelineEntry, cursor: TimelineCursor): boolean {
  const at = cursor.at.toISOString();
  return entry.at < at || (entry.at === at && entry.id < cursor.id);
}

/** 三路各自已按游标与窗口取了至多 limit + 1 条；归并后取前 limit 条，超出即有下一页 */
export function mergeTimeline(input: {
  sources: ReadonlyArray<readonly TimelineEntry[]>;
  limit: number;
  cursor: TimelineCursor | null;
  from: Date;
}): { items: TimelineEntry[]; nextCursor: string | null } {
  const fromIso = input.from.toISOString();
  const merged = input.sources
    .flat()
    .filter((e) => e.at >= fromIso && (!input.cursor || strictlyBefore(e, input.cursor)))
    .sort(newerFirst);
  const items = merged.slice(0, input.limit);
  const last = items[items.length - 1];
  const nextCursor = merged.length > input.limit && last ? encodeTimelineCursor({ at: new Date(last.at), id: last.id }) : null;
  return { items, nextCursor };
}
