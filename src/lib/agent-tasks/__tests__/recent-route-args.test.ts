/**
 * FIX-23 最近任务接口与项目任务列表的查询参数 — 截获 db.agentTask.findMany 实际收到的参数（不连库，进 CI 子集）
 *
 * 运行：npx tsx src/lib/agent-tasks/__tests__/recent-route-args.test.ts
 *
 * 在导入任何用到 @/lib/db 的模块之前，把 globalThis.prisma 换成假的 db（src/lib/db.ts 优先用它），
 * 再直接调路由导出的 GET（带 createSession 签的会话 cookie）。断言的是路由运行时交给 Prisma 的参数，
 * 所以不论源码怎么写（展开常量、引号键、计算键、简写、注释里放假的 select），多选了字段都会失败：
 *   - 最近任务：任务层 select 的键集合、项目 select、步骤 select 的键集合恰好等于允许的集合；
 *     不是 super_admin 时 where 带与项目读权限守卫同口径的范围条件，super_admin 不带；take 按 limit 规则、不超过 20；
 *     不是平台管理员时步骤的 checkReportJson 为 null，平台管理员原样；
 *   - 项目任务列表：take 按 limit 规则（缺省 20、封顶 100）。
 * 对应 openspec/changes/agent-tasks-recent-safe-view/specs/agents/agent-tasks-recent-view。
 */

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 800)}` : ""}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o: unknown) => (o && typeof o === "object" ? Object.keys(o as object).sort() : null);

type Json = Record<string, unknown>;

// ───────────────────────── 假的 db ─────────────────────────
const SECRET_CHECK = "SECRET_CHECK_REPORT_f23";
const USERS: Record<string, Json> = {
  u_member: { id: "u_member", email: "member@example.invalid", name: "member", role: "user", status: "active" },
  u_admin: { id: "u_admin", email: "admin@example.invalid", name: "admin", role: "user", status: "active" },
  u_super: { id: "u_super", email: "super@example.invalid", name: "super", role: "super_admin", status: "active" },
};
const MEMBERSHIPS: Record<string, Array<{ orgId: string; role: string }>> = {
  u_member: [{ orgId: "org_m", role: "org_member" }],
  u_admin: [
    { orgId: "org_a", role: "org_admin" },
    { orgId: "org_o", role: "org_owner" },
    { orgId: "org_v", role: "org_viewer" },
    { orgId: "org_m", role: "org_member" },
  ],
  u_super: [{ orgId: "org_a", role: "org_admin" }],
};
const taskFindManyCalls: Json[] = [];
const membershipQueries: Json[] = [];
const fakeRows = () => [
  {
    id: "t1",
    taskType: "project_inspection",
    triggerType: "cron",
    intent: "巡检",
    status: "completed",
    currentStepIndex: 1,
    totalSteps: 1,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    completedAt: null,
    project: { id: "p1", name: "项目一" },
    steps: [{ id: "s1", title: "报价状态检查", status: "completed", outputSummary: "评分 60", checkReportJson: SECRET_CHECK }],
  },
];
const fakeDb = {
  user: { findUnique: async ({ where }: { where: { id: string } }) => USERS[where.id] ?? null },
  organizationMember: {
    findMany: async (args: { where: { userId: string; status?: string } }) => {
      membershipQueries.push(args as unknown as Json);
      return args.where.status === "active" ? MEMBERSHIPS[args.where.userId] ?? [] : [];
    },
    findUnique: async () => null,
  },
  projectMember: { findUnique: async () => null },
  project: {
    // 项目任务列表的读权限守卫：u_member 是 p1 的负责人（没有组织、已分发）
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === "p1" ? { id: "p1", name: "项目一", ownerId: "u_member", orgId: null, intakeStatus: "dispatched", status: "active" } : null,
  },
  agentTask: {
    findMany: async (args: Json) => {
      taskFindManyCalls.push(args);
      return fakeRows();
    },
  },
};
(globalThis as unknown as { prisma: unknown }).prisma = fakeDb;

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "fix23-recent-route-args-test-secret-0123456789";
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { withPreviewToken } = await import("@/lib/preview/server");
  const { parseListLimit, RECENT_TASKS_LIMIT, PROJECT_TASKS_LIMIT } = await import("@/lib/agent-tasks/dto");
  const recentRoute = await import("@/app/api/agent/tasks/recent/route");
  const listRoute = await import("@/app/api/agent/tasks/route");

  const call = async (handler: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, userId: string | null, url: string) => {
    const user = userId ? USERS[userId] : null;
    const headers: Record<string, string> = {};
    if (user) headers.cookie = `qy_session=${await createSession({ sub: String(user.id), email: String(user.email), role: String(user.role) })}`;
    const req = new NextRequest(`http://localhost${url}`, { method: "GET", headers });
    const before = taskFindManyCalls.length;
    const res = await withPreviewToken(null, () => handler(req, { params: Promise.resolve({}) }));
    const body = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, body, args: taskFindManyCalls.length > before ? taskFindManyCalls[taskFindManyCalls.length - 1] : null };
  };
  const recent = (userId: string | null, query = "") => call(recentRoute.GET as never, userId, `/api/agent/tasks/recent${query}`);
  const list = (userId: string, query = "") => call(listRoute.GET as never, userId, `/api/agent/tasks?projectId=p1${query}`);

  const TASK_SELECT_KEYS = ["completedAt", "createdAt", "currentStepIndex", "id", "intent", "project", "status", "steps", "taskType", "totalSteps", "triggerType"];
  const STEP_SELECT_KEYS = ["checkReportJson", "id", "outputSummary", "status", "title"];

  console.log("最近任务：交给 Prisma 的字段（不论源码怎么写）");
  {
    const r = await recent("u_member");
    const a = r.args as Json | null;
    const select = (a?.select ?? null) as Json | null;
    const steps = (select?.steps ?? null) as Json | null;
    ok(r.status === 200 && !!a && same(keys(a), ["orderBy", "select", "take", "where"]), "findMany 只收到 where / select / orderBy / take（没有 include、没有 distinct 等）", keys(a));
    ok(same(keys(select), TASK_SELECT_KEYS), "任务层 select 的键集合恰好是允许的 11 个（没有 createdBy、approvalRequests、riskLevel 等）", keys(select));
    ok(same(select?.project, { select: { id: true, name: true } }), "项目只选 id 与 name", select?.project);
    ok(same(keys(steps), ["orderBy", "select"]) && same(steps?.orderBy, { stepIndex: "asc" }), "步骤只有 select 与按 stepIndex 升序（没有 include）", steps);
    const stepSelect = (steps?.select ?? null) as Json | null;
    ok(same(keys(stepSelect), STEP_SELECT_KEYS) && Object.values(stepSelect ?? {}).every((v) => v === true), "步骤 select 的键集合恰好是 id / title / status / outputSummary / checkReportJson（不含 error / inputJson / outputJson / approvalRequests）", stepSelect);
    ok(same(a?.orderBy, { createdAt: "desc" }), "按建任务时间倒序", a?.orderBy);
  }

  console.log("最近任务：范围条件");
  {
    const r = await recent("u_admin");
    const where = (r.args?.where ?? null) as Json | null;
    ok(
      same(where, {
        createdById: "u_admin",
        project: {
          intakeStatus: "dispatched",
          OR: [{ ownerId: "u_admin" }, { orgId: { in: ["org_a", "org_o"] } }, { members: { some: { userId: "u_admin", status: "active" } } }],
        },
      }),
      "组织管理员 / 所有者：where = 本人建的 + 项目已分发，且本人负责 / 所在组织是 owner 或 admin（只有 org_a、org_o）/ 项目 active 成员",
      where,
    );
    ok(membershipQueries.some((q) => same(q, { where: { userId: "u_admin", status: "active" }, select: { orgId: true, role: true } })), "组织角色按 active 的组织成员身份取", membershipQueries.slice(-1));
    const rm = await recent("u_member");
    ok(
      same((rm.args?.where as Json | undefined)?.project, {
        intakeStatus: "dispatched",
        OR: [{ ownerId: "u_member" }, { members: { some: { userId: "u_member", status: "active" } } }],
      }),
      "普通组织成员：范围里没有组织那一档",
      rm.args?.where,
    );
    const callsBefore = membershipQueries.length;
    const rs = await recent("u_super");
    const ws = (rs.args?.where ?? null) as Json | null;
    ok(same(ws, { createdById: "u_super" }) && membershipQueries.length === callsBefore, "super_admin：where 只有 createdById（不加范围、不查组织成员）", ws);
    const rc = await recent("u_admin", "?triggerType=cron");
    ok((rc.args?.where as Json | undefined)?.triggerType === "cron" && !!(rc.args?.where as Json | undefined)?.project, "?triggerType=cron：where 带 triggerType，范围条件仍在", rc.args?.where);
    ok(!("triggerType" in (where ?? {})), "不带 triggerType：where 里没有 triggerType");
  }

  console.log("最近任务：检查报告给谁");
  {
    const rm = await recent("u_member");
    const steps = ((rm.body.tasks as Json[] | undefined)?.[0]?.steps ?? []) as Json[];
    ok(rm.status === 200 && steps.length === 1 && "checkReportJson" in steps[0] && steps[0].checkReportJson === null && !JSON.stringify(rm.body).includes(SECRET_CHECK), "不是平台管理员：步骤带 checkReportJson 键、值为 null，正文里没有检查报告原文", steps);
    ok(same(keys(steps[0]), STEP_SELECT_KEYS), "不是平台管理员：步骤键集合不变", keys(steps[0]));
    const rs = await recent("u_super");
    const ss = ((rs.body.tasks as Json[] | undefined)?.[0]?.steps ?? []) as Json[];
    ok(rs.status === 200 && ss[0]?.checkReportJson === SECRET_CHECK, "super_admin：checkReportJson 原样", ss);
    const r401 = await recent(null);
    ok(r401.status === 401 && r401.args === null && !("tasks" in r401.body), "未登录：401，不查任务", r401);
  }

  console.log("条数规则（parseListLimit 与两个路由实际传给 take 的值）");
  {
    const cases: Array<[string | null, number, number]> = [
      // [原始参数, 最近任务, 项目任务列表]
      [null, 10, 20],
      ["", 10, 20],
      ["  ", 10, 20],
      ["5", 5, 5],
      [" 5 ", 5, 5],
      ["20", 20, 20],
      ["21", 20, 21],
      ["50", 20, 50],
      ["100", 20, 100],
      ["150", 20, 100],
      ["99999999999999999999", 20, 100],
      ["0", 10, 20],
      ["00", 10, 20],
      ["05", 10, 20],
      ["-5", 10, 20],
      ["-1000", 10, 20],
      ["2.5", 10, 20],
      ["5.0", 10, 20],
      ["abc", 10, 20],
      ["5abc", 10, 20],
      ["0x10", 10, 20],
      ["1e1", 10, 20],
      ["+3", 10, 20],
      ["Infinity", 10, 20],
      ["NaN", 10, 20],
    ];
    const badPure = cases.filter(([raw, recentN, listN]) => parseListLimit(raw, RECENT_TASKS_LIMIT) !== recentN || parseListLimit(raw, PROJECT_TASKS_LIMIT) !== listN);
    ok(badPure.length === 0, `parseListLimit：${cases.length} 种写法只有十进制正整数会被采用，其余按缺省，再封顶`, badPure);
    const badRecent: unknown[] = [];
    const badList: unknown[] = [];
    for (const [raw, recentN, listN] of cases) {
      const q = raw === null ? "" : `?limit=${encodeURIComponent(raw)}`;
      const r = await recent("u_member", q);
      if (r.status !== 200 || r.args?.take !== recentN) badRecent.push({ raw, status: r.status, take: r.args?.take });
      const l = await list("u_member", raw === null ? "" : `&limit=${encodeURIComponent(raw)}`);
      if (l.status !== 200 || l.args?.take !== listN) badList.push({ raw, status: l.status, take: l.args?.take });
    }
    ok(badRecent.length === 0, "最近任务：take 按规则取值，任何写法都在 1–20 之间", badRecent);
    ok(badList.length === 0, "项目任务列表：take 按规则取值（缺省 20、封顶 100），负数不再原样传给 take", badList);
    const lw = await list("u_member", "&limit=-1000");
    ok(same(lw.args?.where, { projectId: "p1" }) && same(lw.args?.orderBy, { createdAt: "desc" }), "项目任务列表：where 与排序不变", { where: lw.args?.where, orderBy: lw.args?.orderBy });
  }

  console.log(`\nFIX-23 recent / list route args: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
