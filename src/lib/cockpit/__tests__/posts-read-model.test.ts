/**
 * A-2 岗位读模型 / company.log 读模型 / 两个路由（openspec change org-cockpit-read-model）
 * 运行：npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts
 *
 * 注入假依赖装配整份响应；静态断言读模型与路由源码只读、按 orgId 限定、走三段式访问控制。纯逻辑，无 DB。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthUser } from "@/lib/auth";
import { canAccessManagementWorkspace } from "@/lib/rbac/workspace-policy";
import {
  COCKPIT_FORBIDDEN_BODY,
  agentEventTimelineWhere,
  agentRunTypeCountWhere,
  auditTimelineWhere,
  automationRunTimelineWhere,
  cursorWhere,
  quotaAuditWhere,
  quotaNotificationWhere,
  timelineRunScopeWhere,
  workforceDomainCountWhere,
  getOrgCompanyLog,
  getOrgPostsCockpit,
  resolveCockpitViewer,
  type CockpitViewer,
  type CockpitViewerDeps,
  type CompanyLogDeps,
  type KpiLoaders,
  type PostsCockpitDeps,
} from "../posts-read-model";
import type { LastRunSnapshot } from "../schedule";
import {
  TIMELINE_AUDIT_ACTION_DENYLIST,
  TIMELINE_EVENT_TYPES,
  decodeTimelineCursor,
  encodeTimelineCursor,
  isTimelineAutomationRun,
  lowFrequencyAutomationKeys,
  sourceCursorBound,
} from "../timeline";
import { COCKPIT_REDACTED } from "../waiting";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T12:00:00Z");
const MIN = 60_000;
const user: AuthUser = { id: "u1", email: "boss@example.com", name: "Boss", nickname: null, avatar: null, role: "user", status: "active", canEditCustomers: true } as AuthUser;
const viewer: CockpitViewer = { user, orgId: "org-1", orgRole: "org_admin" };

async function main() {
  // ── 访问控制 ────────────────────────────────────────────────
  console.log("访问控制");
  const viewerDeps = (o: Partial<CockpitViewerDeps> & { role?: string | null }): CockpitViewerDeps => ({
    resolveOrg: async () => ({ ok: true, orgId: "org-1" }),
    activeOrgRole: async () => (o.role === undefined ? "org_admin" : o.role),
    isManagement: (ctx) => ctx.orgRole === "org_admin" || ctx.orgRole === "org_owner" || ctx.platformRole === "super_admin",
    ...o,
  });
  {
    const r = await resolveCockpitViewer(user, viewerDeps({ role: "org_member" }));
    ok(!r.ok && r.status === 403 && JSON.stringify(r.body) === JSON.stringify(COCKPIT_FORBIDDEN_BODY), "组织普通成员 → 403，响应体不含岗位数据");
  }
  {
    const r = await resolveCockpitViewer(user, viewerDeps({ role: null }));
    ok(!r.ok && r.status === 403, "非成员 → 403");
  }
  {
    const r = await resolveCockpitViewer(
      user,
      viewerDeps({ resolveOrg: async () => ({ ok: false, status: 403, body: { error: "请先选择工作组织", needsSelection: true } }) }),
    );
    ok(!r.ok && r.status === 403 && (r.body as { needsSelection?: boolean }).needsSelection === true, "多组织未选择 → 403 needsSelection");
  }
  {
    const r = await resolveCockpitViewer(user, viewerDeps({ role: "org_owner" }));
    ok(r.ok && r.viewer.orgId === "org-1" && r.viewer.orgRole === "org_owner", "org_owner → 放行，带组织与角色");
  }
  {
    const seen: unknown[] = [];
    await resolveCockpitViewer(user, viewerDeps({ isManagement: (ctx) => (seen.push(ctx), true) }));
    ok(JSON.stringify(seen[0]) === JSON.stringify({ platformRole: "user", orgRole: "org_admin", hasMembership: true }), "管理层判定拿到平台角色 + 组织角色 + 成员身份");
  }
  {
    // 合并 PERM-4c2 后：岗位模式企业与首页 `/` 同一判定（真实 canAccessManagementWorkspace），按岗位键而不是组织角色
    const posDeps = (role: string, permissionKeys: string[] | null, positionMode: boolean) =>
      viewerDeps({ role, positionContext: async () => ({ permissionKeys, positionMode }), isManagement: canAccessManagementWorkspace });
    const owner = await resolveCockpitViewer(user, posDeps("org_member", ["organization.dashboard.read"], true));
    ok(owner.ok, "岗位模式：组织普通成员持 organization.dashboard.read（老板岗位）→ 放行");
    const orgOwnerNoPost = await resolveCockpitViewer(user, posDeps("org_owner", ["sales.quote.create"], true));
    ok(!orgOwnerNoPost.ok && orgOwnerNoPost.status === 403, "岗位模式：org_owner 但没有管理层岗位键 → 403（与首页一致）");
    const legacy = await resolveCockpitViewer(user, posDeps("org_owner", null, false));
    ok(legacy.ok, "非岗位模式：org_owner 照旧放行");
  }

  // ── 岗位总览：假依赖装配 ────────────────────────────────────
  console.log("岗位总览装配");
  const calls: Record<string, unknown[]> = {};
  const track = (name: string, args: unknown) => (calls[name] ??= []).push(args);
  const run = (minutesAgo: number, status = "succeeded"): LastRunSnapshot => ({
    status,
    startedAt: new Date(NOW.getTime() - minutesAgo * MIN),
    completedAt: new Date(NOW.getTime() - minutesAgo * MIN + 1000),
  });
  const kpiLoaders = (overrides: Partial<Record<string, () => Promise<unknown>>> = {}): KpiLoaders =>
    ({
      "src/lib/revenue-spine/sla-metrics.ts#loadSlaMetrics": async (ctx: unknown) => (track("kpi:sla", ctx), overrides.sla ? overrides.sla() : { inquiries: { medianFirstResponseMinutes: 42, answeredWithin24hRate: 0.8 }, guardrail: { total: 3 } }),
      "src/lib/project-finance/portfolio.ts#getTenderPortfolioSummary": async (ctx: unknown) => (
        track("kpi:tender", ctx),
        { tenderSubmittedCount: 12, wonCount: 3, winRatePercentage: "25.0", awardedValueCad: 880000, wonProjects: { finalizedMarginPercentage: "31.2", finalizedProfitCad: 120000 } }
      ),
      "src/lib/marketing/query-dashboard.ts#getMarketingDashboard": async () => {
        if (overrides.marketing) return overrides.marketing();
        return { summary: { effectiveLeads: 9, growthExecution: 61, highPriorityIssues: 1 }, funnel: { economics: { grossMarginRate: 0.4, attributedGrossProfit: 5000 } } };
      },
      "src/lib/operations/projects/query.ts#listDeliveryProjects": async (ctx: unknown) => (track("kpi:projects", ctx), { sections: { needsAttention: 2, active: 5, onHold: 1 } }),
      "src/lib/employee-ai/metrics.ts#getTeamLearningMetrics": async () => ({ candidatePracticeCount: 4, activePlaybookCount: 2, acceptRate: 0.5 }),
    }) as unknown as KpiLoaders;

  const deps = (o: Partial<PostsCockpitDeps> = {}): PostsCockpitDeps => ({
    now: () => NOW,
    env: { EMPLOYEE_AI_LEARNING_ENABLED: "1" },
    orgTimezone: async (orgId) => (track("orgTimezone", orgId), "America/Toronto"),
    latestAutomationRuns: async () =>
      new Map<string, LastRunSnapshot>([
        ["inquiry-sla", run(3)],
        ["revenue-spine-sync", run(5)],
        ["daily-brief", run(5 * 60)],
        ["tender-watch", run(30, "failed")],
        ["release-drift", run(3 * 60)],
      ]),
    automationRunCounts: async () => new Map([["inquiry-sla", 2000], ["revenue-spine-sync", 600], ["tender-watch", 160]]),
    agentRunCounts: async (orgId, _since, runTypes, workDomains) => (
      track("agentRunCounts", { orgId, runTypes, workDomains }),
      { byRunType: new Map([["fde_inbound_sales", 3], ["runtime_v2", 1]]), byWorkDomain: new Map([["sales", 2], ["tender", 4]]) }
    ),
    quotaHitToday: async (orgId, userId, dayStart) => (track("quota", { orgId, userId, dayStart: dayStart.toISOString() }), false),
    pendingMine: async () => ({
      items: [
        { sourceType: "PENDING_ACTION", sourceId: "pa1", actionType: "sales.send_inquiry_reply", title: "回复 ACME 询盘", createdAt: "2026-10-26T11:00:00.000Z", projectId: null },
        { sourceType: "PENDING_ACTION", sourceId: "pa2", actionType: "grader.email_draft", title: "本单毛利偏低", createdAt: "2026-10-26T10:00:00.000Z", projectId: null },
        { sourceType: "APPROVAL_REQUEST", sourceId: "ar1", actionType: "send_email", title: "巡检任务审批", createdAt: "2026-10-26T09:00:00.000Z", projectId: "proj-t" },
        { sourceType: "PRODUCT_CONTENT", sourceId: "pc1", actionType: "publish", title: "产品文案", createdAt: "2026-10-26T08:00:00.000Z", projectId: null },
      ],
      total: 4,
      truncated: false,
    }),
    needsYouJobs: async (orgId) => (
      track("needsYou", orgId),
      {
        items: [
          { jobId: "job-1", title: "处理询盘", needsYouTitle: "需要你审批", pendingActionIds: ["pa1"], lastActivityAt: "2026-10-26T11:30:00.000Z", workDomain: "sales" },
          { jobId: "job-2", title: null, needsYouTitle: "需要澄清", pendingActionIds: [], lastActivityAt: "2026-10-26T07:00:00.000Z", workDomain: "tender" },
        ],
        truncated: false,
      }
    ),
    attributionLookups: async (orgId, paIds, projectIds) => (
      track("lookups", { orgId, paIds, projectIds }),
      {
        pendingActions: new Map([
          ["pa1", { type: "sales.send_inquiry_reply", projectId: null, agentRunId: null, payload: {} }],
          ["pa2", { type: "grader.email_draft", projectId: null, agentRunId: null, payload: { targetType: "CUSTOMER" } }],
        ]),
        projectWorkDomains: new Map([["proj-t", "tender"]]),
        agentRunTypes: new Map(),
      }
    ),
    financialControlEnabled: () => true,
    kpiLoaders: kpiLoaders(),
    ...o,
  });

  {
    for (const k of Object.keys(calls)) delete calls[k];
    const res = await getOrgPostsCockpit(viewer, deps());
    ok(JSON.stringify(res.posts.map((p) => p.key)) === JSON.stringify(["inbound_sales", "tender", "marketing", "service", "projects", "ops_knowledge", "content"]), "七个岗位，顺序同注册表");
    ok(res.orgId === "org-1" && res.heartbeatScope === "platform" && res.timezone === "America/Toronto" && res.generatedAt === NOW.toISOString(), "顶层字段");
    ok(res.posts.every((p) => ["key", "name", "nav", "health", "heartbeat", "nextDueAt", "automations", "pendingApprovals", "needsYou", "actions7d", "kpi"].every((f) => f in p)), "每个岗位含全部字段");
    const sales = res.posts[0];
    ok(sales.automations.length === 9 && sales.automations.some((a) => a.key === "trade-daily") && sales.automations.some((a) => a.key === "calendar-watch"), "automations 恰好是注册表里的自动化");
    ok(sales.heartbeat?.automationKey === "inquiry-sla", "心跳取开始最晚的一次运行", sales.heartbeat);
    ok(sales.health === "never_ran", "询盘销售：trade-followup 等从未运行 → never_ran", sales.automations.map((a) => `${a.key}:${a.health}`));
    ok(sales.nextDueAt === "2026-10-26T12:05:00.000Z", "岗位 nextDueAt 取最早（inquiry-sla 每 5 分钟）", sales.nextDueAt);
    ok(sales.pendingApprovals === 2 && sales.needsYou === 1, "询盘销售：待审批 2（含按上下文归属的 grader.email_draft），需要你 1", { p: sales.pendingApprovals, n: sales.needsYou });
    ok(sales.actions7d.automationRuns === 2600 && sales.actions7d.agentRuns === 6, "近 7 天：自动化 2000 + 600；AgentRun fde 3 + runtime_v2 1 + sales 作业 2", sales.actions7d);
    const tender = res.posts[1];
    ok(tender.health === "failed", "投标：tender-watch 最近一次失败 → failed");
    ok(tender.pendingApprovals === 1 && tender.needsYou === 1 && tender.actions7d.agentRuns === 4, "投标：ApprovalRequest 按项目工作域归属；需要你 1；tender 作业 4");
    ok(res.posts.find((p) => p.key === "content")?.pendingApprovals === 1, "产品内容审批归 content");
    ok(res.posts.find((p) => p.key === "ops_knowledge")?.automations.find((a) => a.key === "release-drift")?.health === "on_time", "release-drift 3 小时前（每日）→ on_time");
    ok(res.posts.find((p) => p.key === "marketing")?.automations.find((a) => a.key === "marketing-mmm")?.health === "n/a", "按需自动化 n/a");
    const aivora = res.posts.find((p) => p.key === "content")?.automations.find((a) => a.key === "aivora-sync");
    ok(aivora?.health === "not_configured" && aivora.nextDueAt === null, "未配置的自动化：not_configured 且不给下次应跑时间", aivora);
    ok(res.waitingForYou.items.every((i) => typeof i.at === "string"), "等你 N 件条目带 at");

    // 等你 N 件
    ok(res.waitingForYou.total === 5, "等你 N 件：4 条待我审批 + 1 个未被覆盖的需要你作业（job-1 的审批已在列表里）", res.waitingForYou);
    ok(res.waitingForYou.items[0].id === "pa1" && res.waitingForYou.items.some((i) => i.id === "job-2") && !res.waitingForYou.items.some((i) => i.id === "job-1"), "去重后的条目");
    ok(res.waitingForYou.items.find((i) => i.id === "pa2")?.title === COCKPIT_REDACTED, "标题含毛利 → 整段替换");
    ok(res.waitingForYou.href === "/capabilities/approvals", "等你 N 件跳 /capabilities/approvals");
    const lookupsCall = calls.lookups?.[0] as { orgId: string; paIds: string[]; projectIds: string[] };
    ok(lookupsCall.orgId === "org-1" && JSON.stringify(lookupsCall.paIds) === '["pa1","pa2"]' && JSON.stringify(lookupsCall.projectIds) === '["proj-t"]', "归属查询只带待我审批里的 PendingAction 与 ApprovalRequest 项目", lookupsCall);
    const agentCall = calls.agentRunCounts?.[0] as { orgId: string; runTypes: string[]; workDomains: string[] };
    ok(agentCall.orgId === "org-1" && agentCall.runTypes.includes("runtime_v2") && agentCall.workDomains.length === 4, "AgentRun 计数按组织 + 已归属的 runType / 工作域");
    ok((calls.quota?.[0] as { dayStart: string }).dayStart === "2026-10-26T00:00:00.000Z", "配额按 UTC 日起点");

    // KPI
    ok(sales.kpi.status === "ok" && JSON.stringify(sales.kpi.status === "ok" ? sales.kpi.metrics.map((m) => m.value) : null) === "[42,0.8,3]", "询盘销售 KPI 取三个声明值", sales.kpi);
    ok(tender.kpi.status === "ok" && JSON.stringify(tender.kpi.status === "ok" ? tender.kpi.metrics.map((m) => m.value) : null) === '[12,3,"25.0"]', "投标 KPI 只取三个计数字段");
    const serialized = JSON.stringify(res);
    ok(!/Margin|finalizedProfit|awardedValue|grossMargin|attributedGrossProfit|31\.2|120000|880000/.test(serialized), "整份响应里没有毛利率 / 利润 / 中标金额的字段名与数值");
    ok(res.posts.find((p) => p.key === "service")?.kpi.status === "unavailable" && res.posts.find((p) => p.key === "content")?.kpi.status === "unavailable", "service / content KPI 未接入");
    const projCtx = (calls["kpi:projects"]?.[0] as { viewer: CockpitViewer; orgId: string } | undefined);
    ok(projCtx?.orgId === "org-1" && projCtx.viewer.orgRole === "org_admin", "项目 KPI 按查看人上下文取数");
    const slaCtx = calls["kpi:sla"]?.[0] as { window: { kind: string; days?: number } };
    ok(slaCtx.window.kind === "rolling_days" && slaCtx.window.days === 30, "KPI 加载器拿到注册表声明的窗口");
  }
  {
    for (const k of Object.keys(calls)) delete calls[k];
    const res = await getOrgPostsCockpit(viewer, deps({ financialControlEnabled: () => false }));
    const tender = res.posts[1];
    ok(tender.kpi.status === "disabled" && !calls["kpi:tender"], "财务控制未开启 → 投标 KPI disabled，读函数未被调用");
  }
  {
    const res = await getOrgPostsCockpit(viewer, deps({ kpiLoaders: kpiLoaders({ marketing: async () => { throw new Error("boom"); } }) }));
    ok(res.posts[2].kpi.status === "error" && res.posts[0].kpi.status === "ok" && res.posts[1].kpi.status === "ok", "营销读函数抛错 → 只有 marketing.kpi 为 error，其余照常");
  }
  {
    const started = Date.now();
    const res = await getOrgPostsCockpit(viewer, deps({ kpiTimeoutMs: 30, kpiLoaders: kpiLoaders({ sla: () => new Promise(() => {}) }) }));
    ok(res.posts[0].kpi.status === "error" && res.posts[2].kpi.status === "ok" && Date.now() - started < 2000, "KPI 读函数超时 → 该岗位 error，接口不被拖住");
  }
  {
    const res = await getOrgPostsCockpit(viewer, deps({ quotaHitToday: async () => true, latestAutomationRuns: async () => new Map() }));
    const byKey = Object.fromEntries(res.posts.map((p) => [p.key, p.health]));
    ok(res.quotaHit === true && byKey.inbound_sales === "quota_hit" && byKey.ops_knowledge === "quota_hit", "配额命中：有 AgentRun 工作的岗位 → quota_hit", byKey);
    ok(byKey.marketing !== "quota_hit" && byKey.service !== "quota_hit" && byKey.content !== "quota_hit", "没有 AgentRun 工作的岗位不受配额影响", byKey);
  }
  {
    const res = await getOrgPostsCockpit(viewer, deps({ quotaHitToday: async () => true }));
    ok(res.posts[1].health === "failed", "失败优先于配额命中");
  }
  {
    const res = await getOrgPostsCockpit(viewer, deps({ latestAutomationRuns: async () => new Map() }));
    ok(res.posts.every((p) => p.heartbeat === null), "无运行记录 → heartbeat 为 null");
  }

  // ── company.log ────────────────────────────────────────────
  console.log("company.log 装配");
  {
    const seen: Record<string, unknown> = {};
    const logDeps: CompanyLogDeps = {
      now: () => NOW,
      auditRows: async (orgId, window, take) => (
        (seen.audit = { orgId, window, take }),
        [{ id: "a1", createdAt: new Date("2026-10-26T11:00:00Z"), userId: "u9", userName: "Ann", action: "PENDING_ACTION_APPROVED", targetType: "pending_action", targetId: "pa1" }]
      ),
      agentEventRows: async (orgId, window, take) => (
        (seen.event = { orgId, window, take }),
        [{ id: "e1", createdAt: new Date("2026-10-26T10:00:00Z"), runId: "run-1", eventType: "job.waiting_human", title: null }]
      ),
      automationRunRows: async (window, take, lowFreq) => (
        (seen.run = { window, take, lowFreq }),
        [{ id: "r1", startedAt: new Date("2026-10-26T09:00:00Z"), automationKey: "release-drift", status: "succeeded", error: null }]
      ),
      timelineLookups: async (orgId, paIds, runIds) => (
        (seen.lookups = { orgId, paIds, runIds }),
        {
          pendingActions: new Map([["pa1", { type: "tender.send_rfq", projectId: null, agentRunId: null, payload: {} }]]),
          projectWorkDomains: new Map(),
          agentRuns: new Map([["run-1", { runType: "workforce_job", workDomain: "sales" }]]),
        }
      ),
    };
    const cursor = { at: new Date("2026-10-26T11:30:00.000Z"), id: "event:e9" };
    const res = await getOrgCompanyLog(viewer, { limit: 2, days: 7, cursor }, logDeps);
    const audit = seen.audit as { orgId: string; take: number; window: { from: Date; bound: unknown } };
    ok(audit.orgId === "org-1" && audit.take === 3, "每路按组织取 limit + 1 条");
    ok(audit.window.from.toISOString() === "2026-10-19T12:00:00.000Z", "窗口起点 = now - days");
    ok(JSON.stringify(audit.window.bound) === JSON.stringify(sourceCursorBound("audit:", cursor)), "每路拿到各自的游标边界");
    ok(JSON.stringify((seen.run as { lowFreq: string[] }).lowFreq).includes("release-drift"), "自动化运行带低频清单");
    ok(JSON.stringify(seen.lookups) === JSON.stringify({ orgId: "org-1", paIds: ["pa1"], runIds: ["run-1"] }), "归属查询带审计里的待审批动作与事件的 run");
    ok(JSON.stringify(res.items.map((i) => i.id)) === '["audit:a1","event:e1"]' && res.nextCursor !== null, "归并取前 limit 条并给出下一页游标", res.items.map((i) => i.id));
    ok(decodeTimelineCursor(res.nextCursor ?? "")?.id === "event:e1", "下一页游标指向本页最后一条");
    ok(res.items[0].post === "tender" && res.items[1].post === "inbound_sales" && res.items[1].href === "/workforce/run-1", "条目归属与 href");
    ok(res.window.from === "2026-10-19T12:00:00.000Z" && res.window.to === NOW.toISOString(), "响应含 window");
    ok(typeof encodeTimelineCursor === "function", "游标编码可用");
  }

  // ── 游标查询条件 ──────────────────────────────────────────
  console.log("游标查询条件");
  {
    const from = new Date("2026-10-19T12:00:00Z");
    const at = new Date("2026-10-26T11:00:00Z");
    ok(JSON.stringify(cursorWhere("createdAt", { from, bound: sourceCursorBound("audit:", null) })) === JSON.stringify({ createdAt: { gte: from } }), "无游标：只有窗口下界");
    ok(JSON.stringify(cursorWhere("createdAt", { from, bound: sourceCursorBound("audit:", { at, id: "run:x" }) })) === JSON.stringify({ createdAt: { gte: from, lte: at } }), "前缀小于游标前缀：同一时刻含");
    ok(JSON.stringify(cursorWhere("startedAt", { from, bound: sourceCursorBound("run:", { at, id: "audit:x" }) })) === JSON.stringify({ startedAt: { gte: from, lt: at } }), "前缀大于游标前缀：同一时刻不含");
    ok(
      JSON.stringify(cursorWhere("createdAt", { from, bound: sourceCursorBound("event:", { at, id: "event:e5" }) })) ===
        JSON.stringify({ AND: [{ createdAt: { gte: from } }, { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "e5" } }] }] }),
      "同来源：同一时刻按 id 严格小于",
    );
  }

  // ── 生产查询条件（纯函数） ──────────────────────────────────
  console.log("生产查询条件");
  {
    const since = new Date("2026-10-19T12:00:00Z");
    const from = since;
    const window = { from, bound: sourceCursorBound("audit:", null) };
    ok(JSON.stringify(agentRunTypeCountWhere("org-1", since, ["fde_inbound_sales", "runtime_v2"])) === JSON.stringify({ orgId: "org-1", createdAt: { gte: since }, runType: { in: ["fde_inbound_sales", "runtime_v2"] } }), "AgentRun 计数：按组织 + 窗口 + 已归属 runType");
    ok(
      JSON.stringify(workforceDomainCountWhere("org-1", since, "sales")) ===
        JSON.stringify({ orgId: "org-1", runType: "workforce_job", createdAt: { gte: since }, metadata: { path: ["workDomain"], equals: "sales" } }),
      "workforce 作业计数：按 metadata.workDomain JSON 路径",
    );
    ok(JSON.stringify(quotaAuditWhere("org-1", since)) === JSON.stringify({ orgId: "org-1", action: "QUOTA_HARD_LIMIT_BLOCKED", targetType: "quota", targetId: "DAILY_AGENT_RUNS", createdAt: { gte: since } }), "配额审计条件");
    ok(JSON.stringify(quotaNotificationWhere("org-1", "u1", since)) === JSON.stringify({ orgId: "org-1", userId: "u1", type: "quota_hard_limit", entityId: "DAILY_AGENT_RUNS", createdAt: { gte: since } }), "配额通知条件（查看人自己的通知）");
    const audit = auditTimelineWhere("org-1", window);
    ok(audit.orgId === "org-1" && JSON.stringify(audit.action) === JSON.stringify({ notIn: [...TIMELINE_AUDIT_ACTION_DENYLIST] }), "审计日志：按组织且排除记账类动作");
    const scope = timelineRunScopeWhere("org-1", from);
    ok(scope.orgId === "org-1" && !scope.runType.in.includes("conversation") && scope.runType.in.includes("workforce_job") && scope.updatedAt.gte === from, "事件来源 run：按组织 + 有归属的 runType + 窗口内更新过");
    const events = agentEventTimelineWhere("org-1", ["r1", "r2"], window);
    ok(
      events.orgId === "org-1" && JSON.stringify(events.runId) === '{"in":["r1","r2"]}' && events.visibleToUser === true && JSON.stringify(events.eventType) === JSON.stringify({ in: [...TIMELINE_EVENT_TYPES] }),
      "AI 事件：按组织 + runId 走索引 + 可见 + 事件白名单",
    );
    const runs = automationRunTimelineWhere({ from, bound: sourceCursorBound("run:", null) }, lowFrequencyAutomationKeys());
    ok(JSON.stringify(runs.AND[1]) === JSON.stringify({ OR: [{ status: { in: ["failed", "partial"] } }, { automationKey: { in: lowFrequencyAutomationKeys() } }] }), "自动化运行：失败 / 部分失败或低频");
    ok(!isTimelineAutomationRun({ automationKey: "agent-runs", status: "succeeded" }) && isTimelineAutomationRun({ automationKey: "agent-runs", status: "failed" }), "取回后再按同一规则过滤一次");
  }

  // ── 静态断言：只读 / 按 orgId / 访问控制 ─────────────────────
  console.log("静态断言");
  const modelSrc = stripComments(read("src/lib/cockpit/posts-read-model.ts"));
  const postsRoute = stripComments(read("src/app/api/cockpit/posts/route.ts"));
  const timelineRoute = stripComments(read("src/app/api/cockpit/timeline/route.ts"));
  for (const [name, src] of [["读模型", modelSrc], ["posts 路由", postsRoute], ["timeline 路由", timelineRoute]] as const) {
    const writes = src.match(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw|\$queryRaw/g);
    ok(!writes, `${name}：没有写操作 / 原生 SQL`, writes);
    ok(!src.includes("resolvePreferredOrgId") && !src.includes("setUserActiveOrgId"), `${name}：不用会改活动组织的解析`);
  }
  const calls2 = [...modelSrc.matchAll(/\bdb\.(\w+)\.(\w+)\(/g)];
  ok(calls2.length >= 12, `读模型里有 ${calls2.length} 处 db 查询`);
  for (const m of calls2) {
    const [, model, method] = m;
    ok(["findFirst", "findMany", "findUnique", "count", "groupBy"].includes(method), `db.${model}.${method} 是读方法`);
    let depth = 0;
    let end = m.index! + m[0].length - 1;
    for (let i = end; i < modelSrc.length; i++) {
      if (modelSrc[i] === "(") depth++;
      if (modelSrc[i] === ")") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    const args = modelSrc.slice(m.index!, end);
    if (model === "automationRun") {
      ok(!args.includes("orgId"), `db.automationRun.${method}：平台级运行流，不按 orgId 过滤（显式例外）`);
    } else {
      ok(/\borgId\b/.test(args), `db.${model}.${method} 的查询条件带 orgId`);
    }
  }
  ok(/withAuth\(/.test(postsRoute) && /resolveCockpitViewer\(user\)/.test(postsRoute) && /getOrgPostsCockpit\(resolved\.viewer\)/.test(postsRoute), "posts 路由：withAuth → resolveCockpitViewer → 读模型");
  ok(
    /withAuth\(/.test(timelineRoute) && /resolveCockpitViewer\(user\)/.test(timelineRoute) && /parseTimelineParams\(/.test(timelineRoute) && /status: 400/.test(timelineRoute),
    "timeline 路由：withAuth → resolveCockpitViewer → 参数校验 400 → 读模型",
  );
  ok(/resolveWorkforceApiOrgForUser\(/.test(modelSrc) && /canAccessManagementWorkspace\(/.test(modelSrc), "查看人解析：只读的 workforce 组织解析 + 首页同口径管理层判定");
  ok(/listCapabilityApprovals\(access, \{ tab: "pending_mine"/.test(modelSrc), "等你 N 件复用待我审批（pending_mine）");
  ok(/financialControlEnabled: isFinancialControlEnabled/.test(modelSrc), "投标 KPI 与 tender-portfolio 路由同一财务开关");
  ok(/pickKpiMetrics\(kpi, result\)/.test(modelSrc) && !/kpi: result|\.\.\.result/.test(modelSrc), "KPI 结果只经 pickKpiMetrics 取值，不整体透出");
  ok(!/beforeData|afterData/.test(modelSrc), "审计日志不读变更前后数据");
  for (const builder of ["agentRunTypeCountWhere(", "workforceDomainCountWhere(", "quotaAuditWhere(", "quotaNotificationWhere(", "auditTimelineWhere(", "timelineRunScopeWhere(", "agentEventTimelineWhere(", "automationRunTimelineWhere("]) {
    ok(modelSrc.split(builder).length >= 3, `默认依赖实际使用 ${builder.slice(0, -1)}（定义 + 调用）`);
  }
  ok(!/select: \{ id: true, startedAt: true, automationKey: true, status: true, error: true/.test(modelSrc) && !/error: true/.test(modelSrc), "自动化运行不取 error 列");
  ok(/rows\.filter\(isTimelineAutomationRun\)/.test(modelSrc), "自动化运行取回后按同一规则过滤");
  ok(/instanceof CapabilitiesAccessError\)\) throw err/.test(modelSrc), "待我审批只吞访问类错误，其余照常抛出");
  ok(/withTimeout\(loader\(/.test(modelSrc), "KPI 读函数带超时");
}

main().then(
  () => {
    console.log(`\n组织驾驶舱读模型: ${pass}/${pass + fail} passed`);
    if (fail > 0) process.exit(1);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
