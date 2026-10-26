/**
 * 组织驾驶舱 — 岗位读模型与 company.log 读模型（A-2，openspec change org-cockpit-read-model）
 *
 * 业务规则全部在纯函数里（schedule / waiting / timeline / posts），本文件只做取数与拼装。
 * 依赖可注入；默认实现全部只读、按 orgId 限定——AutomationRun 是平台级运行流（写入时不带 orgId），
 * 是唯一不按组织过滤的表。不改活动组织，不写任何表。
 */

import type { AuthUser } from "@/lib/auth";
import { AUTOMATION_REGISTRY, type AutomationKey } from "@/lib/automation/registry";
import { isFinancialControlEnabled } from "@/lib/project-finance/flags";
import { canAccessManagementWorkspace } from "@/lib/rbac/workspace-policy";
import {
  POST_REGISTRY,
  pickKpiMetrics,
  type PostKey,
  type PostKpiFormat,
  type PostKpiSource,
  type PostKpiSourceResults,
  type PostKpiWindow,
  type PostRegistryEntry,
} from "./posts";
import {
  AUTOMATION_SCHEDULES,
  automationHealth,
  isAutomationConfigured,
  maxGapMinutes,
  nextDueAt,
  postHealth,
  type AutomationHealth,
  type LastRunSnapshot,
  type PostHealth,
} from "./schedule";
import {
  TIMELINE_AGENT_RUN_TYPES,
  TIMELINE_AUDIT_ACTION_DENYLIST,
  TIMELINE_EVENT_TYPES,
  TIMELINE_RUN_SCAN_LIMIT,
  TIMELINE_RUN_STATUSES,
  agentEventEntry,
  auditEntry,
  automationRunEntry,
  isTimelineAutomationRun,
  lowFrequencyAutomationKeys,
  mergeTimeline,
  sourceCursorBound,
  type AgentEventRow,
  type AuditRow,
  type AutomationRunRow,
  type TimelineEntry,
  type TimelineLookups,
  type TimelineParams,
} from "./timeline";
import {
  buildWaitingForYou,
  lookupIdsFor,
  type AttributionLookups,
  type NeedsYouJobInput,
  type PendingActionRow,
  type PendingMineInput,
  type WaitingForYou,
} from "./waiting";

const DAY_MS = 86_400_000;
const TENDER_KPI_SOURCE: PostKpiSource = "src/lib/project-finance/portfolio.ts#getTenderPortfolioSummary";
const AUTOMATION_KEYS = AUTOMATION_REGISTRY.map((d) => d.key as AutomationKey);

// ── 查看人与访问控制 ──────────────────────────────────────────

export interface CockpitViewer {
  user: AuthUser;
  orgId: string;
  orgRole: string | null;
}

export type CockpitViewerResolution =
  | { ok: true; viewer: CockpitViewer }
  | { ok: false; status: 403; body: Record<string, unknown> };

export const COCKPIT_FORBIDDEN_BODY = { error: "仅管理层可查看岗位视图" };

export interface CockpitViewerDeps {
  resolveOrg(user: { id: string; role: string }): Promise<
    { ok: true; orgId: string } | { ok: false; status: 403; body: Record<string, unknown> }
  >;
  /** OrganizationMember 的角色（仅 active）；非成员为 null */
  activeOrgRole(orgId: string, userId: string): Promise<string | null>;
  isManagement(ctx: { platformRole: string; orgRole: string | null; hasMembership: boolean }): boolean;
}

/** withAuth 之后：只读的 workforce 组织解析 → 组织角色 → 与首页 `/` 相同的管理层判定 */
export async function resolveCockpitViewer(
  user: AuthUser,
  deps: CockpitViewerDeps = defaultCockpitViewerDeps(),
): Promise<CockpitViewerResolution> {
  const resolution = await deps.resolveOrg({ id: user.id, role: user.role });
  if (!resolution.ok) return resolution;
  const orgRole = await deps.activeOrgRole(resolution.orgId, user.id);
  if (!deps.isManagement({ platformRole: user.role, orgRole, hasMembership: Boolean(orgRole) })) {
    return { ok: false, status: 403, body: COCKPIT_FORBIDDEN_BODY };
  }
  return { ok: true, viewer: { user, orgId: resolution.orgId, orgRole } };
}

export function defaultCockpitViewerDeps(): CockpitViewerDeps {
  return {
    resolveOrg: async (user) => {
      const { resolveWorkforceApiOrgForUser, workforceOrgFailureHttp } = await import("@/lib/workforce-runtime/read-model");
      const resolution = await resolveWorkforceApiOrgForUser(user);
      if (resolution.ok) return { ok: true, orgId: resolution.orgId };
      return { ok: false, ...workforceOrgFailureHttp(resolution.reason) };
    },
    activeOrgRole: async (orgId, userId) => {
      const { db } = await import("@/lib/db");
      const member = await db.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId } },
        select: { role: true, status: true },
      });
      return member?.status === "active" ? member.role : null;
    },
    isManagement: (ctx) => canAccessManagementWorkspace(ctx),
  };
}

// ── 岗位总览：响应形状 ────────────────────────────────────────

export interface AutomationStatusView {
  key: AutomationKey;
  name: string;
  health: AutomationHealth;
  lastRun: { status: string; startedAt: string; completedAt: string | null } | null;
  nextDueAt: string | null;
  maxGapMinutes: number | null;
}

export type PostKpiView =
  | { status: "ok"; window: PostKpiWindow; metrics: Array<{ label: string; format: PostKpiFormat; value: number | string | null }> }
  | { status: "unavailable"; reason: string }
  | { status: "disabled"; reason: string }
  | { status: "error" };

export interface PostCardView {
  key: PostKey;
  name: string;
  nav: string;
  health: PostHealth;
  heartbeat: { automationKey: AutomationKey; status: string; startedAt: string; completedAt: string | null } | null;
  nextDueAt: string | null;
  automations: AutomationStatusView[];
  pendingApprovals: number;
  needsYou: number;
  actions7d: { automationRuns: number; agentRuns: number };
  kpi: PostKpiView;
}

export interface PostsCockpitResponse {
  orgId: string;
  generatedAt: string;
  timezone: string;
  heartbeatScope: "platform";
  quotaHit: boolean;
  waitingForYou: WaitingForYou;
  posts: PostCardView[];
}

// ── 岗位总览：依赖 ────────────────────────────────────────────

export interface KpiLoadContext {
  orgId: string;
  viewer: CockpitViewer;
  now: Date;
  window: PostKpiWindow;
}

/** 每个 KPI 来源一个加载器；漏配一个来源 tsc 报错 */
export type KpiLoaders = { [S in PostKpiSource]: (ctx: KpiLoadContext) => Promise<PostKpiSourceResults[S]> };

export interface AgentRunCounts {
  byRunType: ReadonlyMap<string, number>;
  byWorkDomain: ReadonlyMap<string, number>;
}

export interface PostsCockpitDeps {
  now(): Date;
  env: Readonly<Record<string, string | undefined>>;
  orgTimezone(orgId: string): Promise<string>;
  latestAutomationRuns(keys: readonly AutomationKey[]): Promise<ReadonlyMap<string, LastRunSnapshot>>;
  automationRunCounts(keys: readonly AutomationKey[], since: Date): Promise<ReadonlyMap<string, number>>;
  agentRunCounts(orgId: string, since: Date, runTypes: readonly string[], workDomains: readonly string[]): Promise<AgentRunCounts>;
  quotaHitToday(orgId: string, userId: string, dayStart: Date): Promise<boolean>;
  pendingMine(viewer: CockpitViewer): Promise<{ items: PendingMineInput[]; total: number; truncated: boolean }>;
  needsYouJobs(orgId: string): Promise<{ items: NeedsYouJobInput[]; truncated: boolean }>;
  attributionLookups(orgId: string, pendingActionIds: readonly string[], extraProjectIds: readonly string[]): Promise<AttributionLookups>;
  financialControlEnabled(): boolean;
  kpiLoaders: KpiLoaders;
  /** 单个 KPI 读函数的超时（毫秒），超时记为 error，不拖住整个接口；缺省 KPI_TIMEOUT_MS */
  kpiTimeoutMs?: number;
}

export const KPI_TIMEOUT_MS = 5000;

class KpiTimeoutError extends Error {
  constructor() {
    super("KPI 读取超时");
    this.name = "KpiTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new KpiTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── 岗位总览：拼装（纯） ──────────────────────────────────────

function ownsAgentRunWork(post: PostRegistryEntry): boolean {
  return post.agentRunTypes.length > 0 || post.workDomains.length > 0;
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function assemblePostsCockpit(input: {
  orgId: string;
  now: Date;
  timezone: string;
  env: Readonly<Record<string, string | undefined>>;
  latestRuns: ReadonlyMap<string, LastRunSnapshot>;
  runCounts: ReadonlyMap<string, number>;
  agentRunCounts: AgentRunCounts;
  quotaHit: boolean;
  waiting: ReturnType<typeof buildWaitingForYou>;
  kpis: Readonly<Record<PostKey, PostKpiView>>;
}): PostsCockpitResponse {
  const posts = POST_REGISTRY.map((post): PostCardView => {
    const automations = post.automationKeys.map((key): AutomationStatusView => {
      const schedule = AUTOMATION_SCHEDULES[key];
      const lastRun = input.latestRuns.get(key) ?? null;
      const configured = isAutomationConfigured(key, input.env);
      // 未配置 / 开关未开的自动化不会按计划跑，不给下次应跑时间
      const due = configured ? nextDueAt(schedule, input.now, input.timezone) : null;
      return {
        key,
        name: AUTOMATION_REGISTRY.find((d) => d.key === key)?.name ?? key,
        health: automationHealth({ schedule, configured, lastRun, now: input.now }),
        lastRun: lastRun
          ? { status: lastRun.status, startedAt: lastRun.startedAt.toISOString(), completedAt: lastRun.completedAt?.toISOString() ?? null }
          : null,
        nextDueAt: due?.toISOString() ?? null,
        maxGapMinutes: maxGapMinutes(schedule),
      };
    });

    let heartbeat: PostCardView["heartbeat"] = null;
    for (const a of automations) {
      if (a.lastRun && (!heartbeat || a.lastRun.startedAt > heartbeat.startedAt)) heartbeat = { automationKey: a.key, ...a.lastRun };
    }
    const dues = automations.map((a) => a.nextDueAt).filter((d): d is string => d !== null).sort();
    const sum = (values: Iterable<number>) => [...values].reduce((s, v) => s + v, 0);

    return {
      key: post.key,
      name: post.name,
      nav: post.nav,
      health: postHealth(
        automations.map((a) => a.health),
        input.quotaHit && ownsAgentRunWork(post),
      ),
      heartbeat,
      nextDueAt: dues[0] ?? null,
      automations,
      pendingApprovals: input.waiting.perPost[post.key].pendingApprovals,
      needsYou: input.waiting.perPost[post.key].needsYou,
      actions7d: {
        automationRuns: sum(post.automationKeys.map((k) => input.runCounts.get(k) ?? 0)),
        agentRuns:
          sum((post.agentRunTypes as readonly string[]).map((t) => input.agentRunCounts.byRunType.get(t) ?? 0)) +
          sum((post.workDomains as readonly string[]).map((d) => input.agentRunCounts.byWorkDomain.get(d) ?? 0)),
      },
      kpi: input.kpis[post.key],
    };
  });

  return {
    orgId: input.orgId,
    generatedAt: input.now.toISOString(),
    timezone: input.timezone,
    heartbeatScope: "platform",
    quotaHit: input.quotaHit,
    waitingForYou: input.waiting.waitingForYou,
    posts,
  };
}

// ── 岗位总览：KPI ─────────────────────────────────────────────

async function loadPostKpi(post: PostRegistryEntry, viewer: CockpitViewer, now: Date, deps: PostsCockpitDeps): Promise<PostKpiView> {
  const kpi = post.kpi;
  if (kpi.kind === "unavailable") return { status: "unavailable", reason: kpi.reason };
  if (kpi.source === TENDER_KPI_SOURCE && !deps.financialControlEnabled()) {
    return { status: "disabled", reason: "财务控制功能未启用（TENDER_FINANCIAL_CONTROL_ENABLED）" };
  }
  try {
    const loader = deps.kpiLoaders[kpi.source] as (ctx: KpiLoadContext) => Promise<unknown>;
    const result = await withTimeout(loader({ orgId: viewer.orgId, viewer, now, window: kpi.window }), deps.kpiTimeoutMs ?? KPI_TIMEOUT_MS);
    const metrics = (pickKpiMetrics(kpi, result) ?? []).map(({ label, format, value }) => ({ label, format, value }));
    return { status: "ok", window: kpi.window, metrics };
  } catch (err) {
    // 只记错误类型，不记读函数结果
    console.error("[cockpit] KPI 读取失败", post.key, err instanceof Error ? err.name : typeof err);
    return { status: "error" };
  }
}

export async function loadPostKpis(viewer: CockpitViewer, now: Date, deps: PostsCockpitDeps): Promise<Record<PostKey, PostKpiView>> {
  const entries = await Promise.all(POST_REGISTRY.map(async (post) => [post.key, await loadPostKpi(post, viewer, now, deps)] as const));
  return Object.fromEntries(entries) as Record<PostKey, PostKpiView>;
}

// ── 岗位总览：入口 ────────────────────────────────────────────

export async function getOrgPostsCockpit(
  viewer: CockpitViewer,
  deps: PostsCockpitDeps = defaultPostsCockpitDeps(),
): Promise<PostsCockpitResponse> {
  const now = deps.now();
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const runTypes = [...new Set(POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]))];
  const workDomains = [...new Set(POST_REGISTRY.flatMap((p) => p.workDomains as readonly string[]))];

  const [timezone, latestRuns, runCounts, agentRunCounts, quotaHit, pendingMine, jobs, kpis] = await Promise.all([
    deps.orgTimezone(viewer.orgId),
    deps.latestAutomationRuns(AUTOMATION_KEYS),
    deps.automationRunCounts(AUTOMATION_KEYS, since),
    deps.agentRunCounts(viewer.orgId, since, runTypes, workDomains),
    deps.quotaHitToday(viewer.orgId, viewer.user.id, utcDayStart(now)),
    deps.pendingMine(viewer),
    deps.needsYouJobs(viewer.orgId),
    loadPostKpis(viewer, now, deps),
  ]);

  const lookups = await deps.attributionLookups(
    viewer.orgId,
    pendingMine.items.filter((i) => i.sourceType === "PENDING_ACTION").map((i) => i.sourceId),
    pendingMine.items.filter((i) => i.sourceType === "APPROVAL_REQUEST").map((i) => i.projectId).filter((id): id is string => !!id),
  );
  const waiting = buildWaitingForYou({
    pendingMine: pendingMine.items,
    pendingMineTotal: pendingMine.total,
    pendingMineTruncated: pendingMine.truncated,
    jobs: jobs.items,
    jobsTruncated: jobs.truncated,
    lookups,
  });

  return assemblePostsCockpit({ orgId: viewer.orgId, now, timezone, env: deps.env, latestRuns, runCounts, agentRunCounts, quotaHit, waiting, kpis });
}

// ── 查询条件（纯函数，测试直接对其断言） ──────────────────────

export function agentRunTypeCountWhere(orgId: string, since: Date, runTypes: readonly string[]) {
  return { orgId, createdAt: { gte: since }, runType: { in: [...runTypes] } };
}

export function workforceDomainCountWhere(orgId: string, since: Date, workDomain: string) {
  return { orgId, runType: "workforce_job", createdAt: { gte: since }, metadata: { path: ["workDomain"], equals: workDomain } };
}

export function quotaAuditWhere(orgId: string, dayStart: Date) {
  return { orgId, action: "QUOTA_HARD_LIMIT_BLOCKED", targetType: "quota", targetId: "DAILY_AGENT_RUNS", createdAt: { gte: dayStart } };
}

export function quotaNotificationWhere(orgId: string, userId: string, dayStart: Date) {
  return { orgId, userId, type: "quota_hard_limit", entityId: "DAILY_AGENT_RUNS", createdAt: { gte: dayStart } };
}

// ── 岗位总览：默认依赖（Prisma，只读） ────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function defaultPostsCockpitDeps(): PostsCockpitDeps {
  return {
    now: () => new Date(),
    env: process.env,
    orgTimezone: async (orgId) => (await import("@/lib/automation/registry")).loadOrgTimezone(orgId),

    // AutomationRun 是平台级运行流：按 automationKey 取最近一条（走 (automationKey, startedAt) 索引）
    latestAutomationRuns: async (keys) => {
      const { db } = await import("@/lib/db");
      const rows = await Promise.all(
        keys.map((key) =>
          db.automationRun.findFirst({
            where: { automationKey: key },
            orderBy: { startedAt: "desc" },
            select: { status: true, startedAt: true, completedAt: true },
          }),
        ),
      );
      const out = new Map<string, LastRunSnapshot>();
      keys.forEach((key, i) => {
        const row = rows[i];
        if (row) out.set(key, row);
      });
      return out;
    },

    automationRunCounts: async (keys, since) => {
      const { db } = await import("@/lib/db");
      const groups = await db.automationRun.groupBy({
        by: ["automationKey"],
        where: { automationKey: { in: [...keys] }, startedAt: { gte: since } },
        _count: { _all: true },
      });
      return new Map(groups.map((g) => [g.automationKey, g._count._all]));
    },

    agentRunCounts: async (orgId, since, runTypes, workDomains) => {
      const { db } = await import("@/lib/db");
      const [byType, ...domainCounts] = await Promise.all([
        runTypes.length
          ? db.agentRun.groupBy({
              by: ["runType"],
              where: agentRunTypeCountWhere(orgId, since, runTypes),
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ runType: string; _count: { _all: number } }>),
        ...workDomains.map((domain) => db.agentRun.count({ where: workforceDomainCountWhere(orgId, since, domain) })),
      ]);
      return {
        byRunType: new Map(byType.map((g) => [g.runType, g._count._all])),
        byWorkDomain: new Map(workDomains.map((d, i) => [d, domainCounts[i] ?? 0])),
      };
    },

    // 系统发起的 run 命中配额时审计写入会失败（AuditLog.userId 外键），所以同时看查看人收到的通知
    quotaHitToday: async (orgId, userId, dayStart) => {
      const { db } = await import("@/lib/db");
      const [audit, notification] = await Promise.all([
        db.auditLog.findFirst({ where: quotaAuditWhere(orgId, dayStart), select: { id: true } }),
        db.notification.findFirst({ where: quotaNotificationWhere(orgId, userId, dayStart), select: { id: true } }),
      ]);
      return Boolean(audit || notification);
    },

    // 与 /capabilities/approvals 的"待我审批"同一口径
    pendingMine: async (viewer) => {
      const [{ buildCapabilitiesAccess, CapabilitiesAccessError }, { listCapabilityApprovals }, { isSuperAdmin }] = await Promise.all([
        import("@/lib/capabilities/access"),
        import("@/lib/capabilities/approvals/query"),
        import("@/lib/rbac/roles"),
      ]);
      try {
        const access = await buildCapabilitiesAccess({
          userId: viewer.user.id,
          orgId: viewer.orgId,
          orgRole: viewer.orgRole ?? "",
          isPlatformAdmin: isSuperAdmin(viewer.user.role),
          user: viewer.user,
        });
        const result = await listCapabilityApprovals(access, { tab: "pending_mine", pageSize: 100 });
        return {
          items: result.items.map((i) => ({
            sourceType: i.sourceType,
            sourceId: i.sourceId,
            actionType: i.actionType,
            title: i.title ?? null,
            createdAt: i.createdAt,
            projectId: i.projectId ?? null,
          })),
          total: result.total,
          truncated: result.hasMore,
        };
      } catch (err) {
        // 只吞访问类错误（如平台管理员无成员身份）：这一块记为截断的空集；数据库故障等照常抛出
        if (!(err instanceof CapabilitiesAccessError)) throw err;
        return { items: [], total: 0, truncated: true };
      }
    },

    needsYouJobs: async (orgId) => {
      const [{ listWorkforceJobViews }, { normalizeWorkDomain, resolveEffectiveWorkDomain }, { db }] = await Promise.all([
        import("@/lib/workforce-runtime/read-model"),
        import("@/lib/workforce-runtime/work-domain"),
        import("@/lib/db"),
      ]);
      const page = await listWorkforceJobViews({ orgId, status: "needs_you", limit: 50 });
      const ids = page.items.map((i) => i.jobId);
      const runs = ids.length
        ? await db.agentRun.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, metadata: true } })
        : [];
      const metadataById = new Map(runs.map((r) => [r.id, record(r.metadata)]));
      const items = await Promise.all(
        page.items.map(async (item): Promise<NeedsYouJobInput> => {
          const metadata = metadataById.get(item.jobId) ?? null;
          let workDomain: string | null = normalizeWorkDomain(metadata?.workDomain);
          if (!workDomain) {
            // 旧作业没有显式工作域：走既有的有效工作域解析（只读），判定不出就不归属
            const resolved = await resolveEffectiveWorkDomain({ orgId, runId: item.jobId, runMetadata: metadata });
            workDomain = resolved.ok ? resolved.workDomain : null;
          }
          return {
            jobId: item.jobId,
            title: item.title ?? null,
            needsYouTitle: item.needsYou?.title ?? "需要你处理",
            pendingActionIds: item.needsYou?.pendingActionIds ?? [],
            lastActivityAt: item.lastActivityAt,
            workDomain,
          };
        }),
      );
      return { items, truncated: page.nextCursor !== null };
    },

    attributionLookups: async (orgId, pendingActionIds, extraProjectIds) => {
      const { db } = await import("@/lib/db");
      const pendingActions = pendingActionIds.length
        ? await db.pendingAction.findMany({
            where: { id: { in: [...pendingActionIds] }, orgId },
            select: { id: true, type: true, projectId: true, agentRunId: true, payload: true },
          })
        : [];
      const rows = new Map<string, PendingActionRow>(
        pendingActions.map((p) => [p.id, { type: p.type, projectId: p.projectId, agentRunId: p.agentRunId, payload: p.payload }]),
      );
      const { projectIds, agentRunIds } = lookupIdsFor(rows.values(), extraProjectIds);
      const [projects, runs] = await Promise.all([
        projectIds.length
          ? db.project.findMany({ where: { id: { in: projectIds }, orgId }, select: { id: true, workDomain: true } })
          : Promise.resolve([] as Array<{ id: string; workDomain: string }>),
        agentRunIds.length
          ? db.agentRun.findMany({ where: { id: { in: agentRunIds }, orgId }, select: { id: true, runType: true } })
          : Promise.resolve([] as Array<{ id: string; runType: string }>),
      ]);
      return {
        pendingActions: rows,
        projectWorkDomains: new Map(projects.map((p) => [p.id, p.workDomain])),
        agentRunTypes: new Map(runs.map((r) => [r.id, r.runType])),
      };
    },

    // 与 /api/org/tender-portfolio 的 financeDisabledResponse() 同一开关（getTenderPortfolioSummary 内部不检查）
    financialControlEnabled: isFinancialControlEnabled,

    kpiLoaders: {
      "src/lib/revenue-spine/sla-metrics.ts#loadSlaMetrics": async ({ orgId, now, window }) =>
        (await import("@/lib/revenue-spine/sla-metrics")).loadSlaMetrics(orgId, {
          now,
          windowDays: window.kind === "rolling_days" ? window.days : undefined,
        }),
      "src/lib/project-finance/portfolio.ts#getTenderPortfolioSummary": async ({ orgId, now, window }) =>
        (await import("@/lib/project-finance/portfolio")).getTenderPortfolioSummary(orgId, {
          from: new Date(now.getTime() - (window.kind === "rolling_days" ? window.days : 365) * DAY_MS),
          to: now,
        }),
      "src/lib/marketing/query-dashboard.ts#getMarketingDashboard": async ({ orgId }) =>
        (await import("@/lib/marketing/query-dashboard")).getMarketingDashboard(orgId),
      "src/lib/operations/projects/query.ts#listDeliveryProjects": async ({ orgId, viewer }) =>
        (await import("@/lib/operations/projects/query")).listDeliveryProjects({
          orgId,
          ctx: { platformRole: viewer.user.role, orgRole: viewer.orgRole, hasMembership: Boolean(viewer.orgRole), userId: viewer.user.id },
          // sections 在分页前统计，pageSize 1 即可拿到全部计数
          filters: { view: "team", pageSize: 1 },
        }),
      "src/lib/employee-ai/metrics.ts#getTeamLearningMetrics": async ({ orgId }) =>
        (await import("@/lib/employee-ai/metrics")).getTeamLearningMetrics({ orgId }),
    },
  };
}

// ── company.log ───────────────────────────────────────────────

export interface SourceWindow {
  from: Date;
  bound: ReturnType<typeof sourceCursorBound>;
}

type DateRange = { gte: Date; lt?: Date; lte?: Date };
export type CursorWhere<F extends string> =
  | { [K in F]: DateRange }
  | { AND: [{ [K in F]: { gte: Date } }, { OR: [{ [K in F]: { lt: Date } }, { [K in F]: Date } & { id: { lt: string } }] }] };

/** 窗口起点 + 严格早于游标（同一时刻按来源规则比较 id）的查询条件；纯函数 */
export function cursorWhere<F extends "createdAt" | "startedAt">(field: F, window: SourceWindow): CursorWhere<F> {
  const { from, bound } = window;
  const range = (r: DateRange) => ({ [field]: r }) as { [K in F]: DateRange };
  if (!bound.before) return range({ gte: from });
  if (bound.sameInstant === "all") return range({ gte: from, lte: bound.before });
  if (bound.sameInstant === "none") return range({ gte: from, lt: bound.before });
  return {
    AND: [
      { [field]: { gte: from } } as { [K in F]: { gte: Date } },
      {
        OR: [
          { [field]: { lt: bound.before } } as { [K in F]: { lt: Date } },
          { [field]: bound.before, id: { lt: bound.sameInstant.idLessThan } } as { [K in F]: Date } & { id: { lt: string } },
        ],
      },
    ],
  };
}

export function auditTimelineWhere(orgId: string, window: SourceWindow) {
  return { orgId, action: { notIn: [...TIMELINE_AUDIT_ACTION_DENYLIST] }, ...cursorWhere("createdAt", window) };
}

/** 窗口内更新过、且有岗位归属的 run（取它们的事件；对话类 run 不进） */
export function timelineRunScopeWhere(orgId: string, from: Date) {
  return { orgId, runType: { in: [...TIMELINE_AGENT_RUN_TYPES] }, updatedAt: { gte: from } };
}

export function agentEventTimelineWhere(orgId: string, runIds: readonly string[], window: SourceWindow) {
  return {
    orgId,
    runId: { in: [...runIds] },
    visibleToUser: true,
    eventType: { in: [...TIMELINE_EVENT_TYPES] },
    ...cursorWhere("createdAt", window),
  };
}

/** 平台级运行流：只取失败 / 部分失败，以及低频自动化的运行 */
export function automationRunTimelineWhere(window: SourceWindow, lowFrequencyKeys: readonly string[]) {
  return {
    AND: [
      cursorWhere("startedAt", window),
      { OR: [{ status: { in: [...TIMELINE_RUN_STATUSES] } }, { automationKey: { in: [...lowFrequencyKeys] } }] },
    ],
  };
}

export interface CompanyLogResponse {
  items: TimelineEntry[];
  nextCursor: string | null;
  window: { from: string; to: string };
}

export interface CompanyLogDeps {
  now(): Date;
  auditRows(orgId: string, window: SourceWindow, take: number): Promise<AuditRow[]>;
  agentEventRows(orgId: string, window: SourceWindow, take: number): Promise<AgentEventRow[]>;
  automationRunRows(window: SourceWindow, take: number, lowFrequencyKeys: readonly AutomationKey[]): Promise<AutomationRunRow[]>;
  timelineLookups(orgId: string, pendingActionIds: readonly string[], runIds: readonly string[]): Promise<TimelineLookups>;
}

export async function getOrgCompanyLog(
  viewer: CockpitViewer,
  params: TimelineParams,
  deps: CompanyLogDeps = defaultCompanyLogDeps(),
): Promise<CompanyLogResponse> {
  const now = deps.now();
  const from = new Date(now.getTime() - params.days * DAY_MS);
  const take = params.limit + 1;
  const [audits, events, runs] = await Promise.all([
    deps.auditRows(viewer.orgId, { from, bound: sourceCursorBound("audit:", params.cursor) }, take),
    deps.agentEventRows(viewer.orgId, { from, bound: sourceCursorBound("event:", params.cursor) }, take),
    deps.automationRunRows({ from, bound: sourceCursorBound("run:", params.cursor) }, take, lowFrequencyAutomationKeys()),
  ]);
  const pendingActionIds = audits
    .filter((a) => a.targetType.trim().toLowerCase() === "pending_action" && a.targetId)
    .map((a) => a.targetId as string);
  const lookups = await deps.timelineLookups(viewer.orgId, pendingActionIds, events.map((e) => e.runId));
  const merged = mergeTimeline({
    sources: [audits.map((a) => auditEntry(a, lookups)), events.map((e) => agentEventEntry(e, lookups)), runs.map(automationRunEntry)],
    limit: params.limit,
    cursor: params.cursor,
    from,
  });
  return { items: merged.items, nextCursor: merged.nextCursor, window: { from: from.toISOString(), to: now.toISOString() } };
}

export function defaultCompanyLogDeps(): CompanyLogDeps {
  return {
    now: () => new Date(),

    // 审计日志只取 action / 目标类型 / 操作人，不读 beforeData / afterData
    auditRows: async (orgId, window, take) => {
      const { db } = await import("@/lib/db");
      const rows = await db.auditLog.findMany({
        where: auditTimelineWhere(orgId, window),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        select: { id: true, createdAt: true, userId: true, action: true, targetType: true, targetId: true, user: { select: { name: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        userId: r.userId,
        userName: r.user?.name ?? null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
      }));
    },

    // AgentRunEvent 只有 (orgId, runId) 索引：先取窗口内最近更新的有归属 run，再按 runId 查事件
    agentEventRows: async (orgId, window, take) => {
      const { db } = await import("@/lib/db");
      const runs = await db.agentRun.findMany({
        where: timelineRunScopeWhere(orgId, window.from),
        orderBy: { updatedAt: "desc" },
        take: TIMELINE_RUN_SCAN_LIMIT,
        select: { id: true },
      });
      if (runs.length === 0) return [];
      return db.agentRunEvent.findMany({
        where: agentEventTimelineWhere(orgId, runs.map((r) => r.id), window),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        select: { id: true, createdAt: true, runId: true, eventType: true, title: true },
      });
    },

    // 不取 error：平台级运行流的错误文本可能带出其他组织的数据
    automationRunRows: async (window, take, lowFrequencyKeys) => {
      const { db } = await import("@/lib/db");
      const rows = await db.automationRun.findMany({
        where: automationRunTimelineWhere(window, lowFrequencyKeys),
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take,
        select: { id: true, startedAt: true, automationKey: true, status: true },
      });
      return rows.filter(isTimelineAutomationRun);
    },

    timelineLookups: async (orgId, pendingActionIds, runIds) => {
      const [{ db }, { normalizeWorkDomain }] = await Promise.all([import("@/lib/db"), import("@/lib/workforce-runtime/work-domain")]);
      const pendingActions = pendingActionIds.length
        ? await db.pendingAction.findMany({
            where: { id: { in: [...new Set(pendingActionIds)] }, orgId },
            select: { id: true, type: true, projectId: true, agentRunId: true, payload: true },
          })
        : [];
      const rows = new Map<string, PendingActionRow>(
        pendingActions.map((p) => [p.id, { type: p.type, projectId: p.projectId, agentRunId: p.agentRunId, payload: p.payload }]),
      );
      const ids = lookupIdsFor(rows.values());
      const allRunIds = [...new Set([...runIds, ...ids.agentRunIds])];
      const [projects, runs] = await Promise.all([
        ids.projectIds.length
          ? db.project.findMany({ where: { id: { in: ids.projectIds }, orgId }, select: { id: true, workDomain: true } })
          : Promise.resolve([] as Array<{ id: string; workDomain: string }>),
        allRunIds.length
          ? db.agentRun.findMany({ where: { id: { in: allRunIds }, orgId }, select: { id: true, runType: true, metadata: true } })
          : Promise.resolve([] as Array<{ id: string; runType: string; metadata: unknown }>),
      ]);
      return {
        pendingActions: rows,
        projectWorkDomains: new Map(projects.map((p) => [p.id, p.workDomain])),
        agentRuns: new Map(runs.map((r) => [r.id, { runType: r.runType, workDomain: normalizeWorkDomain(record(r.metadata)?.workDomain) }])),
      };
    },
  };
}
