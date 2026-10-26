/**
 * 主动提醒 — 定时任务为管理层补发（A-3b，openspec change org-cockpit-proactive-notify）
 *
 * 首页 `/` 换成只读的岗位视图后，没开自动化偏好的管理层不再因为打开首页而触发主动扫描。
 * `/api/cron/proactive-scan`（每小时）在自动化一轮之后，为管理层补一轮：只扫描、只写通知，不执行任何自动动作。
 * - 范围：在职成员（组织在用）里组织角色 org_owner / org_admin 或平台角色 boss / manager，账号在职、30 天内登录过；
 * - 排除：自动化一轮已处理的人；平台 admin / super_admin（项目可见性是全平台）；
 * - 上限：每轮 100 人，另有时间预算。按 userId 排序，从上一轮最后处理的人之后接着排（游标记在本定时任务自己的运行记录
 *   metadata.notifyOnlyResumeAfter）；人数超上限或预算截断时，后面几轮接着处理，不会固定漏掉一批人。
 *   候选查询本身也从游标之后读（再从头补一段用于循环），所以候选行数上限不会让排在后面的人永远轮不到。
 */

import type { AutomationOutcome } from "@/lib/automation/runner";

const DAY_MS = 86_400_000;

export const MANAGER_NOTIFY_CAP = 100;
export const MANAGER_ACTIVE_WINDOW_DAYS = 30;
/** 每段候选成员行读取上限（游标之后一段 + 从头一段）；读满即在 metadata 标 notifyOnlyCandidatesTruncated */
export const MANAGER_CANDIDATE_LIMIT = 2000;
export const MANAGER_ORG_ROLES = ["org_owner", "org_admin"] as const;
export const MANAGER_PLATFORM_ROLES = ["boss", "manager"] as const;
/** 平台管理员：项目可见性是全平台，不替他们补发 */
export const PLATFORM_ADMIN_ROLES = ["admin", "super_admin"] as const;
/** 两轮合计的时间预算（maxDuration 300 秒，留余量给 runTrackedAutomation 收尾） */
export const PROACTIVE_RUN_BUDGET_MS = 240_000;
export const PROACTIVE_SCAN_AUTOMATION_KEY = "proactive-scan";

export interface ManagerCandidate {
  userId: string;
  /** 平台角色 User.role */
  platformRole: string;
}

/** OrganizationMember 查询条件：在职成员（组织在用）+ 账号在职、近期登录 + 管理层角色，排除平台管理员 */
export function managerCandidateWhere(now: Date) {
  return {
    status: "active",
    org: { status: "active" },
    user: {
      status: "active",
      lastLoginAt: { gte: new Date(now.getTime() - MANAGER_ACTIVE_WINDOW_DAYS * DAY_MS) },
      role: { notIn: [...PLATFORM_ADMIN_ROLES] },
    },
    OR: [{ role: { in: [...MANAGER_ORG_ROLES] } }, { user: { role: { in: [...MANAGER_PLATFORM_ROLES] } } }],
  };
}

/** 候选分段：游标之后（gt）/ 从头到游标（lte）/ 不分段（null） */
export function candidateSegmentWhere(now: Date, userId: { gt: string } | { lte: string } | null) {
  return userId ? { ...managerCandidateWhere(now), userId } : managerCandidateWhere(now);
}

/** 上一轮游标所在的运行记录：本定时任务最近一次完成（成功 / 部分成功）的运行；正在跑的这一轮是 running，不会读到自己 */
export function resumeRunWhere() {
  return { automationKey: PROACTIVE_SCAN_AUTOMATION_KEY, status: { in: ["succeeded", "partial"] } };
}

/** 从运行记录 metadata 读游标；没有或格式不对 → null（从头开始） */
export function resumeAfterOf(metadata: unknown): string | null {
  const v = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).notifyOnlyResumeAfter : null;
  return typeof v === "string" && v ? v : null;
}

/**
 * 本轮要补发的人：按 userId 去重、去掉自动化一轮已处理的、再排除一次平台管理员（双保险），
 * 按 userId 排序后从游标之后（第一个 userId > resumeAfter 的人）循环取上限人数；没有游标或游标在末尾 → 从头开始。
 */
export function planManagerNotifyRun(input: {
  candidates: readonly ManagerCandidate[];
  alreadyScanned: ReadonlySet<string>;
  resumeAfter: string | null;
  cap?: number;
}): ManagerCandidate[] {
  const cap = input.cap ?? MANAGER_NOTIFY_CAP;
  const byId = new Map<string, ManagerCandidate>();
  for (const c of input.candidates) {
    if (input.alreadyScanned.has(c.userId)) continue;
    if ((PLATFORM_ADMIN_ROLES as readonly string[]).includes(c.platformRole)) continue;
    if (!byId.has(c.userId)) byId.set(c.userId, c);
  }
  const sorted = [...byId.values()].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const after = input.resumeAfter;
  const found = after === null ? 0 : sorted.findIndex((c) => c.userId > after);
  const start = found < 0 ? 0 : found;
  return [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, cap);
}

export interface ManagerNotifyResult {
  userId: string;
  mode: "notify_only";
  suggestions?: number;
  notifications?: number;
  error?: string;
}

export interface ManagerNotifyRun {
  results: ManagerNotifyResult[];
  planned: number;
  stoppedByBudget: boolean;
  candidatesTruncated: boolean;
  /** 本轮最后处理（含失败）的人；一个都没处理时为 null */
  lastUserId: string | null;
}

export interface ManagerNotifyDeps {
  /** 候选：游标之后的一段 + 从头的一段（循环用）；没有游标时只读从头的一段 */
  loadCandidates(now: Date, resumeAfter: string | null): Promise<{ candidates: ManagerCandidate[]; truncated: boolean }>;
  /** 只扫描、只写通知（runProactiveScanForUser(..., { autoActions: false })） */
  scanNotifyOnly(userId: string, platformRole: string): Promise<{ suggestions: number; notifications: number }>;
  nowMs(): number;
}

/** 逐个补发；时间预算用完就停（剩下的由游标留给后面几轮）；单人失败不影响其他人 */
export async function runManagerNotify(
  input: { now: Date; alreadyScanned: ReadonlySet<string>; budgetMs: number; resumeAfter: string | null },
  deps: ManagerNotifyDeps = defaultManagerNotifyDeps(),
): Promise<ManagerNotifyRun> {
  const startedAt = deps.nowMs();
  const loaded = await deps.loadCandidates(input.now, input.resumeAfter);
  const plan = planManagerNotifyRun({ candidates: loaded.candidates, alreadyScanned: input.alreadyScanned, resumeAfter: input.resumeAfter });
  const results: ManagerNotifyResult[] = [];
  const done = (stoppedByBudget: boolean): ManagerNotifyRun => ({
    results,
    planned: plan.length,
    stoppedByBudget,
    candidatesTruncated: loaded.truncated,
    lastUserId: results.length ? results[results.length - 1].userId : null,
  });
  for (const c of plan) {
    if (deps.nowMs() - startedAt >= input.budgetMs) return done(true);
    try {
      const r = await deps.scanNotifyOnly(c.userId, c.platformRole);
      results.push({ userId: c.userId, mode: "notify_only", suggestions: r.suggestions, notifications: r.notifications });
    } catch (err) {
      results.push({ userId: c.userId, mode: "notify_only", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return done(false);
}

export function defaultManagerNotifyDeps(): ManagerNotifyDeps {
  return {
    loadCandidates: async (now, resumeAfter) => {
      const { db } = await import("@/lib/db");
      const segment = (where: ReturnType<typeof candidateSegmentWhere>) =>
        db.organizationMember.findMany({
          where,
          select: { userId: true, user: { select: { role: true } } },
          orderBy: [{ userId: "asc" }, { id: "asc" }],
          take: MANAGER_CANDIDATE_LIMIT,
        });
      const [after, head] = await Promise.all([
        resumeAfter ? segment(candidateSegmentWhere(now, { gt: resumeAfter })) : Promise.resolve([]),
        segment(candidateSegmentWhere(now, resumeAfter ? { lte: resumeAfter } : null)),
      ]);
      const rows = [...after, ...head];
      return {
        candidates: rows.map((r) => ({ userId: r.userId, platformRole: r.user.role })),
        truncated: after.length >= MANAGER_CANDIDATE_LIMIT || head.length >= MANAGER_CANDIDATE_LIMIT,
      };
    },
    scanNotifyOnly: async (userId, platformRole) => {
      const { runProactiveScanForUser } = await import("./run-scan");
      const r = await runProactiveScanForUser(userId, platformRole, { autoActions: false });
      return { suggestions: r.suggestions.length, notifications: r.notificationsCreated };
    },
    nowMs: () => Date.now(),
  };
}

// ── 定时任务主体（/api/cron/proactive-scan 调用；依赖可注入） ──────────────

export interface ProactiveCronResult {
  userId: string;
  mode: "automation" | "notify_only";
  suggestions?: number;
  actions?: number;
  notifications?: number;
  error?: string;
}

export interface ProactiveCronDeps {
  nowMs(): number;
  /** 自动化一轮的候选（UserNotificationPreference.metadata 非空、账号在职，最多 100 人） */
  loadAutomationUsers(): Promise<Array<{ userId: string; role: string }>>;
  automationEnabled(userId: string): Promise<boolean>;
  /** 扫描 + 写通知 + 执行低风险自动动作（runProactiveScanForUser 不传 options） */
  scanWithAutomation(userId: string, role: string): Promise<{ suggestions: number; actions: number; notifications: number }>;
  /** 上一轮补发的游标；读不到 → null */
  loadResumeAfter(): Promise<string | null>;
  notifyManagers(input: { now: Date; alreadyScanned: ReadonlySet<string>; budgetMs: number; resumeAfter: string | null }): Promise<ManagerNotifyRun>;
}

/**
 * 两轮：
 * 1. 自动化一轮：开了自动化偏好的用户，结果标 automation；
 * 2. 管理层补发：排除第 1 轮处理过的人，用剩余预算，结果标 notify_only；整轮出错单独兜住、计 1 次失败（运行记 partial），不影响第 1 轮。
 */
export async function runProactiveScanCron(
  deps: ProactiveCronDeps = defaultProactiveCronDeps(),
): Promise<AutomationOutcome<{ scannedAt: string; users: ProactiveCronResult[] }>> {
  const startedAt = deps.nowMs();
  const results: ProactiveCronResult[] = [];

  for (const u of await deps.loadAutomationUsers()) {
    if (!(await deps.automationEnabled(u.userId))) continue;
    try {
      const r = await deps.scanWithAutomation(u.userId, u.role);
      results.push({ userId: u.userId, mode: "automation", suggestions: r.suggestions, actions: r.actions, notifications: r.notifications });
    } catch (error) {
      results.push({ userId: u.userId, mode: "automation", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const automationUsers = results.length;

  let resumeError: string | null = null;
  const resumeAfter = await deps.loadResumeAfter().catch((error: unknown) => {
    resumeError = error instanceof Error ? error.message : String(error);
    return null;
  });
  let managers: ManagerNotifyRun = { results: [], planned: 0, stoppedByBudget: false, candidatesTruncated: false, lastUserId: null };
  let notifyOnlyError: string | null = null;
  try {
    managers = await deps.notifyManagers({
      now: new Date(deps.nowMs()),
      alreadyScanned: new Set(results.map((r) => r.userId)),
      budgetMs: Math.max(0, PROACTIVE_RUN_BUDGET_MS - (deps.nowMs() - startedAt)),
      resumeAfter,
    });
  } catch (error) {
    notifyOnlyError = error instanceof Error ? error.message : String(error);
  }
  results.push(...managers.results);

  const failedCount = results.filter((r) => r.error).length;
  // 这一轮一个都没补发（出错 / 预算为 0 / 没人）时沿用上一轮游标，不回到开头
  const nextResumeAfter = managers.lastUserId ?? resumeAfter;
  return {
    data: { scannedAt: new Date(deps.nowMs()).toISOString(), users: results },
    // 补发整轮出错：运行记部分成功（计数仍按人，加得起来）
    ...(notifyOnlyError ? { status: "partial" as const } : {}),
    processedCount: results.length,
    succeededCount: results.length - failedCount,
    failedCount,
    metadata: {
      enabledUsers: automationUsers,
      notifyOnlyUsers: managers.results.length,
      notifyOnlyPlanned: managers.planned,
      notifyOnlyStoppedByBudget: managers.stoppedByBudget,
      notifyOnlyCandidatesTruncated: managers.candidatesTruncated,
      ...(nextResumeAfter ? { notifyOnlyResumeAfter: nextResumeAfter } : {}),
      ...(notifyOnlyError ? { notifyOnlyError } : {}),
      ...(resumeError ? { notifyOnlyResumeError: resumeError } : {}),
    },
  };
}

export function defaultProactiveCronDeps(): ProactiveCronDeps {
  return {
    nowMs: () => Date.now(),
    loadAutomationUsers: async () => {
      const { db } = await import("@/lib/db");
      const rows = await db.userNotificationPreference.findMany({
        where: { metadata: { not: null }, user: { status: "active" } },
        select: { userId: true, user: { select: { role: true } } },
        orderBy: { updatedAt: "asc" },
        take: 100,
      });
      return rows.map((r) => ({ userId: r.userId, role: r.user.role }));
    },
    automationEnabled: async (userId) => {
      const { getUserAutomationPrefs } = await import("./automation-prefs");
      return (await getUserAutomationPrefs(userId)).enabled;
    },
    scanWithAutomation: async (userId, role) => {
      const { runProactiveScanForUser } = await import("./run-scan");
      const r = await runProactiveScanForUser(userId, role);
      return { suggestions: r.suggestions.length, actions: r.autoActions.filter((a) => a.success).length, notifications: r.notificationsCreated };
    },
    loadResumeAfter: async () => {
      const { db } = await import("@/lib/db");
      const run = await db.automationRun.findFirst({ where: resumeRunWhere(), orderBy: { startedAt: "desc" }, select: { metadataJson: true } });
      return resumeAfterOf(run?.metadataJson);
    },
    notifyManagers: (input) => runManagerNotify(input),
  };
}
