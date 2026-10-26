/**
 * 主动提醒 — 定时任务为管理层补发（A-3b，openspec change org-cockpit-proactive-notify）
 *
 * 首页 `/` 换成只读的岗位视图后，没开自动化偏好的管理层不再因为打开首页而触发主动扫描。
 * `/api/cron/proactive-scan`（每小时）在自动化一轮之后，为管理层补一轮：只扫描、只写通知，不执行任何自动动作。
 * - 范围：在职成员里组织角色 org_owner / org_admin 或平台角色 boss / manager，账号在职、30 天内登录过；
 * - 排除：自动化一轮已处理的人；平台 admin / super_admin（项目可见性是全平台）；
 * - 上限：每轮 100 人，按 userId 排序、按小时轮转起点（无状态，几轮内覆盖全部），另有时间预算。
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const MANAGER_NOTIFY_CAP = 100;
export const MANAGER_ACTIVE_WINDOW_DAYS = 30;
export const MANAGER_ORG_ROLES = ["org_owner", "org_admin"] as const;
export const MANAGER_PLATFORM_ROLES = ["boss", "manager"] as const;
/** 平台管理员：项目可见性是全平台，不替他们补发 */
export const PLATFORM_ADMIN_ROLES = ["admin", "super_admin"] as const;

export interface ManagerCandidate {
  userId: string;
  /** 平台角色 User.role */
  platformRole: string;
}

/** OrganizationMember 查询条件：在职成员 + 账号在职、近期登录 + 管理层角色，排除平台管理员 */
export function managerCandidateWhere(now: Date) {
  return {
    status: "active",
    user: {
      status: "active",
      lastLoginAt: { gte: new Date(now.getTime() - MANAGER_ACTIVE_WINDOW_DAYS * DAY_MS) },
      role: { notIn: [...PLATFORM_ADMIN_ROLES] },
    },
    OR: [{ role: { in: [...MANAGER_ORG_ROLES] } }, { user: { role: { in: [...MANAGER_PLATFORM_ROLES] } } }],
  };
}

/**
 * 本轮要补发的人：按 userId 去重、去掉自动化一轮已处理的、再排除一次平台管理员（双保险），
 * 按 userId 排序后从"小时序号 × 上限"处轮转取上限人数。
 */
export function planManagerNotifyRun(input: {
  candidates: readonly ManagerCandidate[];
  alreadyScanned: ReadonlySet<string>;
  now: Date;
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
  if (sorted.length <= cap) return sorted;
  const start = (Math.floor(input.now.getTime() / HOUR_MS) * cap) % sorted.length;
  return [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, cap);
}

export interface ManagerNotifyResult {
  userId: string;
  mode: "notify_only";
  suggestions?: number;
  notifications?: number;
  error?: string;
}

export interface ManagerNotifyDeps {
  loadCandidates(now: Date): Promise<ManagerCandidate[]>;
  /** 只扫描、只写通知（runProactiveScanForUser(..., { autoActions: false })） */
  scanNotifyOnly(userId: string, platformRole: string): Promise<{ suggestions: number; notifications: number }>;
  nowMs(): number;
}

/** 逐个补发；时间预算用完就停（剩下的靠轮转在后面几轮补上）；单人失败不影响其他人 */
export async function runManagerNotify(
  input: { now: Date; alreadyScanned: ReadonlySet<string>; budgetMs: number },
  deps: ManagerNotifyDeps = defaultManagerNotifyDeps(),
): Promise<{ results: ManagerNotifyResult[]; planned: number; stoppedByBudget: boolean }> {
  const startedAt = deps.nowMs();
  const plan = planManagerNotifyRun({ candidates: await deps.loadCandidates(input.now), alreadyScanned: input.alreadyScanned, now: input.now });
  const results: ManagerNotifyResult[] = [];
  for (const c of plan) {
    if (deps.nowMs() - startedAt >= input.budgetMs) return { results, planned: plan.length, stoppedByBudget: true };
    try {
      const r = await deps.scanNotifyOnly(c.userId, c.platformRole);
      results.push({ userId: c.userId, mode: "notify_only", suggestions: r.suggestions, notifications: r.notifications });
    } catch (err) {
      results.push({ userId: c.userId, mode: "notify_only", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, planned: plan.length, stoppedByBudget: false };
}

export function defaultManagerNotifyDeps(): ManagerNotifyDeps {
  return {
    loadCandidates: async (now) => {
      const { db } = await import("@/lib/db");
      const rows = await db.organizationMember.findMany({
        where: managerCandidateWhere(now),
        select: { userId: true, user: { select: { role: true } } },
        take: 2000,
      });
      return rows.map((r) => ({ userId: r.userId, platformRole: r.user.role }));
    },
    scanNotifyOnly: async (userId, platformRole) => {
      const { runProactiveScanForUser } = await import("./run-scan");
      const r = await runProactiveScanForUser(userId, platformRole, { autoActions: false });
      return { suggestions: r.suggestions.length, notifications: r.notificationsCreated };
    },
    nowMs: () => Date.now(),
  };
}
