/**
 * FIX-23 最近任务接口（GET /api/agent/tasks/recent）的项目范围与安全投影 — DB + HTTP（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts
 *
 * 直接调路由导出的 GET（带 createSession 签的会话 cookie；岗位预览另带预览 cookie，并在 withPreviewToken 里调用：
 * 库函数在测试进程里读不到 next/headers 的请求 cookie）。对应
 * openspec/changes/agent-tasks-recent-safe-view/specs/agents/agent-tasks-recent-view 的每条 Scenario：
 *   - 对照断言：每个夹具用户 `?limit=20` 返回的任务序列 = 他建的任务里、对其项目直接调项目读权限守卫放行的那些，
 *     按建立时间倒序取前 20 条（含顺序）；
 *   - 不是平台管理员的人：每一步 checkReportJson 为 null、键集合不变，正文里没有原始报错 / 价格 / 「利润率」标记串，
 *     也没有打不开的项目的名字、编号、意图与步骤摘要；
 *   - super_admin：自己建的全部任务（含未分发项目），检查报告与库里一字不差；以岗位预览身份访问时按预览身份判断；
 *   - 条数：先筛后取；limit 不是大于 0 的整数时按 10，封顶 20；
 *   - triggerType 筛选与排序；未登录 / 已停用账号 401；请求前后任务与步骤逐字段不变。
 *
 * 只用虚构企业名；不调模型、不发通知、不出站。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 FIX-23 最近任务接口 DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 FIX-23 最近任务接口 DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 FIX-23 最近任务接口 DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "fix-23 agent tasks recent view" });
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TASK_KEYS = ["completedAt", "createdAt", "currentStepIndex", "id", "intent", "project", "status", "taskType", "totalSteps", "triggerType"];
const STEP_KEYS = ["checkReportJson", "id", "outputSummary", "status", "title"];

async function main() {
  requireIsolatedTestDb();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "fix23-agent-tasks-recent-view-test-secret";

  const { NextRequest, NextResponse } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { requireProjectReadAccess } = await import("@/lib/projects/access");
  const { withPreviewToken } = await import("@/lib/preview/server");
  const { signPreviewToken } = await import("@/lib/preview/token");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const recentRoute = await import("@/app/api/agent/tasks/recent/route");

  const tag = `fix23_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const RAW_ERROR_MARK = `RAW_ERROR_MARK_${tag}`;
  const PRICE_MARK = `PRICE_MARK_${tag}`;
  const MARGIN_TEXT = "利润率 7.5%，低于 10% 安全线";

  // ───────────────────────── 夹具 ─────────────────────────
  const mkUser = (slug: string, opts: { status?: string; role?: string } = {}) =>
    db.user.create({
      data: {
        email: `${slug}_${tag}@test.qingyan.local`,
        name: slug,
        role: opts.role ?? "user",
        status: opts.status ?? "active",
      },
    });

  // 对照组
  const uOwner = await mkUser("f23_owner"); // P1 与 P3 的负责人：已离开组织甲（成员身份 inactive）、不是这两个项目的成员
  const uViewer = await mkUser("f23_viewer"); // P1 的 active 只读成员（也是没有组织的 P4 的 active 成员）
  const uInactiveMember = await mkUser("f23_inactive_member"); // P1 成员身份为 inactive 的原成员
  const uOrgAdmin = await mkUser("f23_org_admin"); // 甲的 active 管理员，不是项目成员
  const uOrgOwner = await mkUser("f23_org_owner"); // 甲的 active 所有者，不是项目成员
  const uExOrgAdmin = await mkUser("f23_ex_org_admin"); // 甲的 inactive 原管理员，不是项目成员
  const uSameOrg = await mkUser("f23_same_org"); // 甲的普通成员，不是项目成员
  const uOutsiderAdmin = await mkUser("f23_outsider_admin"); // 乙的管理员
  const uSuper = await mkUser("f23_super", { role: "super_admin" }); // 不属于甲；是丙的 active 管理员（岗位预览用）
  // 其他
  const uOther = await mkUser("f23_other_owner"); // P2、P4、P5、P6 的负责人，不参加断言
  const uCount = await mkUser("f23_count"); // 条数用户：P1 的 active 成员
  const uSuspended = await mkUser("f23_suspended", { status: "suspended" }); // 已停用账号（曾是 P1 成员）
  const controlUsers = [uOwner, uViewer, uInactiveMember, uOrgAdmin, uOrgOwner, uExOrgAdmin, uSameOrg, uOutsiderAdmin, uSuper];
  const allUsers = [...controlUsers, uOther, uCount, uSuspended];

  const orgA = await db.organization.create({
    data: { name: `F23 OrgA ${tag}`, code: `f23a_${tag}`, ownerId: uOrgOwner.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `F23 OrgB ${tag}`, code: `f23b_${tag}`, ownerId: uOutsiderAdmin.id, status: "active" },
  });
  // 丙：岗位模式（可以开岗位预览）
  const orgC = await db.organization.create({
    data: { name: `F23 OrgC ${tag}`, code: `f23c_${tag}`, ownerId: uOther.id, status: "active", industryPackId: "window_covering_services_v1" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: uOwner.id, role: "org_member", status: "inactive" },
      { orgId: orgA.id, userId: uViewer.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uInactiveMember.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uOrgAdmin.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: uOrgOwner.id, role: "org_owner", status: "active" },
      { orgId: orgA.id, userId: uExOrgAdmin.id, role: "org_admin", status: "inactive" },
      { orgId: orgA.id, userId: uSameOrg.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uOther.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uCount.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uSuspended.id, role: "org_member", status: "active" },
      { orgId: orgB.id, userId: uOutsiderAdmin.id, role: "org_admin", status: "active" },
      { orgId: orgC.id, userId: uSuper.id, role: "org_admin", status: "active" },
      { orgId: orgC.id, userId: uOther.id, role: "org_owner", status: "active" },
    ],
  });

  const mkProject = (key: string, orgId: string | null, ownerId: string, intakeStatus = "dispatched") =>
    db.project.create({ data: { orgId, name: `F23-${key}-${tag}`, ownerId, intakeStatus } });
  const P1 = await mkProject("P1", orgA.id, uOwner.id);
  const P2 = await mkProject("P2", orgA.id, uOther.id);
  const P3 = await mkProject("P3", orgA.id, uOwner.id, "pending_dispatch"); // 未分发
  const P4 = await mkProject("P4", null, uOther.id); // 没有组织的已分发项目
  const P5 = await mkProject("P5", orgC.id, uOther.id);
  const P6 = await mkProject("P6", orgC.id, uOther.id);
  const projects = [P1, P2, P3, P4, P5, P6];
  const projectKey = new Map(projects.map((p, i) => [p.id, `P${i + 1}`]));
  await db.projectMember.createMany({
    data: [
      { projectId: P1.id, userId: uViewer.id, role: "viewer", status: "active" },
      { projectId: P4.id, userId: uViewer.id, role: "viewer", status: "active" },
      { projectId: P1.id, userId: uInactiveMember.id, role: "viewer", status: "inactive" },
      { projectId: P1.id, userId: uCount.id, role: "operator", status: "active" },
      { projectId: P1.id, userId: uSuspended.id, role: "viewer", status: "active" },
      { projectId: P6.id, userId: uSuper.id, role: "viewer", status: "active" },
    ],
  });

  // 每条任务显式写不同的 createdAt（按夹具顺序逐条递增），排序断言不依赖写库先后
  const baseTime = Date.now() - 30 * 24 * 3600_000;
  let seq = 0;
  const failedReport = JSON.stringify({
    passed: false,
    score: 0,
    issues: [{ level: "urgent", message: `步骤执行失败：${RAW_ERROR_MARK} 模型原文 {"unitPrice": 1234.5}` }],
    blockers: [{ level: "urgent", message: `步骤执行失败：${RAW_ERROR_MARK} 模型原文 {"unitPrice": 1234.5}` }],
  });
  const quoteReport = JSON.stringify({
    passed: false,
    score: 60,
    issues: [
      { level: "warning", message: MARGIN_TEXT },
      { level: "info", message: `单价 ${PRICE_MARK} 总价 98765.43` },
    ],
    blockers: [],
  });
  type FixtureTask = { id: string; projectId: string; createdById: string; triggerType: string; createdAt: Date };
  const fixtureTasks: FixtureTask[] = [];
  const mkTask = async (userId: string, projectId: string, triggerType: "cron" | "manual", withMarkers = true) => {
    seq += 1;
    const key = projectKey.get(projectId)!;
    const createdAt = new Date(baseTime + seq * 60_000);
    const task = await db.agentTask.create({
      data: {
        projectId,
        createdById: userId,
        taskType: triggerType === "cron" ? "project_inspection" : "custom",
        triggerType,
        intent: `INTENT-${key}-${tag} #${seq}`,
        status: "waiting_for_approval",
        currentStepIndex: 1,
        totalSteps: 2,
        createdAt,
        steps: {
          create: [
            {
              stepIndex: 0,
              skillId: "quote",
              agentName: "quote_agent",
              title: "报价草稿",
              status: "waiting_for_approval",
              outputSummary: `SUMMARY-${key}-${tag} 报价草稿生成失败`,
              checkReportJson: withMarkers ? failedReport : JSON.stringify({ passed: true, score: 100, issues: [], blockers: [] }),
              error: withMarkers ? `${RAW_ERROR_MARK} raw error` : null,
              inputJson: JSON.stringify({ action: "draft" }),
              outputJson: withMarkers ? JSON.stringify({ unitPrice: PRICE_MARK }) : null,
            },
            {
              stepIndex: 1,
              skillId: "quote",
              agentName: "quote_agent",
              title: "报价状态检查",
              status: "completed",
              outputSummary: `SUMMARY-${key}-${tag} 报价审查评分 60`,
              checkReportJson: withMarkers ? quoteReport : null,
            },
          ],
        },
      },
      select: { id: true, projectId: true, createdById: true, triggerType: true, createdAt: true },
    });
    fixtureTasks.push(task);
    return task;
  };

  // 对照组：每人在 P1–P4 上各一条 cron、一条 manual（直接写库，模拟 FIX-21 之前谁都能建任务）
  for (const u of controlUsers) {
    for (const p of [P1, P2, P3, P4]) {
      await mkTask(u.id, p.id, "cron");
      await mkTask(u.id, p.id, "manual");
    }
  }
  // 岗位预览：super_admin 在丙的 P5（不是项目成员）、P6（active 项目成员）上各一条
  const taskSuperP5 = await mkTask(uSuper.id, P5.id, "manual");
  const taskSuperP6 = await mkTask(uSuper.id, P6.id, "manual");
  // 条数用户：P1 上 22 条较早的，P2（打不开）上 25 条更新的
  const countP1: FixtureTask[] = [];
  for (let i = 0; i < 22; i++) countP1.push(await mkTask(uCount.id, P1.id, i % 2 ? "cron" : "manual", false));
  for (let i = 0; i < 25; i++) await mkTask(uCount.id, P2.id, "manual", false);
  // 已停用账号：只用于 401
  await mkTask(uSuspended.id, P1.id, "manual");

  // 岗位预览 token：丙按岗位模式，签一张 super_admin 在丙的预览 token
  await seedOrgAuthorizationProfiles(orgC.id);
  const previewPosition = await db.roleProfile.findFirst({
    where: { orgId: orgC.id, principalType: "HUMAN", status: "active" },
    orderBy: { key: "asc" },
  });
  const previewToken = previewPosition
    ? (await signPreviewToken({ userId: uSuper.id, orgId: orgC.id, keys: [previewPosition.key] })).token
    : null;

  const allTaskIds = fixtureTasks.map((t) => t.id);
  const dbSnapshot = async () =>
    JSON.stringify(
      await db.agentTask.findMany({
        where: { id: { in: allTaskIds } },
        orderBy: { id: "asc" },
        include: { steps: { orderBy: { stepIndex: "asc" } } },
      }),
    );
  const before = await dbSnapshot();
  const dbSteps = new Map(
    (await db.agentTaskStep.findMany({ where: { taskId: { in: allTaskIds } } })).map((s) => [s.id, s]),
  );

  // ───────────────────────── 请求 ─────────────────────────
  type TestUser = { id: string; email: string; role: string };
  const mkRequest = async (user: TestUser | null, url: string, preview: string | null) => {
    const parts: string[] = [];
    if (user) parts.push(`qy_session=${await createSession({ sub: user.id, email: user.email, role: user.role })}`);
    if (user && preview) parts.push(`qy_preview=${preview}`);
    return new NextRequest(`http://localhost${url}`, { method: "GET", headers: parts.length ? { cookie: parts.join("; ") } : {} });
  };
  type StepView = Record<string, unknown> & { id: string; checkReportJson: unknown };
  type TaskView = Record<string, unknown> & { id: string; project: { id: string; name: string }; steps: StepView[] };
  type CallResult = { status: number; body: Record<string, unknown>; text: string; tasks: TaskView[] };
  const recent = async (user: TestUser | null, query = "", preview: string | null = null): Promise<CallResult> => {
    const req = await mkRequest(user, `/api/agent/tasks/recent${query}`, preview);
    const res = await withPreviewToken(preview, () => recentRoute.GET(req, { params: Promise.resolve({}) }));
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* 非 JSON 响应，body 留空 */
    }
    return { status: res.status, body, text, tasks: Array.isArray(body.tasks) ? (body.tasks as TaskView[]) : [] };
  };
  const ids = (r: CallResult) => r.tasks.map((t) => t.id);
  /** 对照：对该用户建过任务的每个项目逐一调项目读权限守卫（同一 cookie） */
  const readableProjects = async (user: TestUser, preview: string | null = null) => {
    const projectIds = [...new Set(fixtureTasks.filter((t) => t.createdById === user.id).map((t) => t.projectId))];
    const allowed = new Set<string>();
    for (const projectId of projectIds) {
      const req = await mkRequest(user, `/api/projects/${projectId}`, preview);
      const r = await withPreviewToken(preview, () => requireProjectReadAccess(req, projectId));
      if (!(r instanceof NextResponse)) allowed.add(projectId);
    }
    return { projectIds, allowed };
  };
  const expectedFor = (user: TestUser, allowed: Set<string>, limit: number, triggerType?: string) =>
    fixtureTasks
      .filter((t) => t.createdById === user.id && allowed.has(t.projectId) && (!triggerType || t.triggerType === triggerType))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((t) => t.id);
  /** 任务 10 个键 + steps，步骤 5 个键（与改动前相同，不新增字段） */
  const keysOk = (r: CallResult) =>
    r.tasks.every(
      (t) =>
        same(Object.keys(t).sort(), [...TASK_KEYS, "steps"].sort()) &&
        Array.isArray(t.steps) &&
        t.steps.every((s) => same(Object.keys(s).sort(), STEP_KEYS)),
    );
  const hiddenMarks = (projectId: string) => {
    const key = projectKey.get(projectId)!;
    const p = projects.find((x) => x.id === projectId)!;
    return [p.name, p.id, `INTENT-${key}-${tag}`, `SUMMARY-${key}-${tag}`];
  };

  try {
    // ── 对照断言（每个对照组用户） ──
    console.log("与项目读权限逐人一致（隔离库测试）");
    const guardResult = new Map<string, Set<string>>();
    for (const u of controlUsers) {
      const { projectIds, allowed } = await readableProjects(u);
      guardResult.set(u.id, allowed);
      const r = await recent(u, "?limit=20");
      const expected = expectedFor(u, allowed, 20);
      ok(
        r.status === 200 && same(ids(r), expected),
        `${u.name}：?limit=20 返回的任务序列与逐项目调守卫放行的结果相同（含顺序，${expected.length} 条）`,
        r.status === 200
          ? {
              allowed: [...allowed].map((id) => projectKey.get(id)),
              denied: projectIds.filter((id) => !allowed.has(id)).map((id) => projectKey.get(id)),
              extra: ids(r).filter((id) => !expected.includes(id)).length,
              missing: expected.filter((id) => !ids(r).includes(id)).length,
              orderOnly: ids(r).length === expected.length && ids(r).every((id) => expected.includes(id)),
            }
          : { status: r.status, body: r.body },
      );
    }
    // 守卫本身的放行结果与规格描述一致（避免对照断言空转）
    const keysOf = (u: TestUser) => [...(guardResult.get(u.id) ?? [])].map((id) => projectKey.get(id)).sort();
    ok(
      same(keysOf(uOwner), ["P1"]) &&
        same(keysOf(uViewer), ["P1", "P4"]) &&
        same(keysOf(uOrgAdmin), ["P1", "P2"]) &&
        same(keysOf(uOrgOwner), ["P1", "P2"]) &&
        same(keysOf(uInactiveMember), []) &&
        same(keysOf(uExOrgAdmin), []) &&
        same(keysOf(uSameOrg), []) &&
        same(keysOf(uOutsiderAdmin), []) &&
        same(keysOf(uSuper), ["P1", "P2", "P3", "P4", "P5", "P6"]),
      "守卫放行：负责人 P1；只读成员 P1、P4；组织管理员 / 所有者 P1、P2；被移出的成员、原管理员、同企业非成员、别的企业管理员都没有；super_admin 全部",
      controlUsers.map((u) => [u.name, keysOf(u)]),
    );

    // ── 还能打开项目的人照常看到 ──
    console.log("还能打开项目的人照常看到");
    for (const [u, label] of [
      [uViewer, "项目的 active 只读成员"],
      [uOrgAdmin, "项目所在组织的管理员（不是项目成员）"],
      [uOwner, "项目负责人（已离开该组织、不是项目成员）"],
    ] as const) {
      const r = await recent(u);
      const mine = fixtureTasks.filter((t) => t.createdById === u.id && t.projectId === P1.id).map((t) => t.id);
      ok(r.status === 200 && mine.length === 2 && mine.every((id) => ids(r).includes(id)), `${label}：200，自己在 P1 上建的 2 条任务都在 tasks 里`, { status: r.status, got: ids(r).length });
    }

    // ── 打不开项目的人看不到 ──
    console.log("打不开项目的人看不到自己在那里建过的任务");
    {
      const r = await recent(uInactiveMember, "?limit=20");
      const onP1 = fixtureTasks.filter((t) => t.createdById === uInactiveMember.id && t.projectId === P1.id).map((t) => t.id);
      ok(r.status === 200 && onP1.length === 2 && onP1.every((id) => !ids(r).includes(id)) && !r.text.includes(P1.name), "被移出项目的人：200，P1 上的两条任务不在 tasks 里，正文里没有 P1 的名字", { status: r.status, got: ids(r).length });
      const ro = await recent(uOutsiderAdmin, "?limit=20");
      const onA = fixtureTasks.filter((t) => t.createdById === uOutsiderAdmin.id && [P1.id, P2.id, P3.id].includes(t.projectId)).map((t) => t.id);
      ok(ro.status === 200 && onA.every((id) => !ids(ro).includes(id)), "乙组织的管理员：200，甲组织项目上的任务都不在 tasks 里", { status: ro.status, got: ids(ro).length });
      const rs = await recent(uSameOrg, "?limit=20");
      const onP1s = fixtureTasks.filter((t) => t.createdById === uSameOrg.id && t.projectId === P1.id).map((t) => t.id);
      ok(rs.status === 200 && onP1s.every((id) => !ids(rs).includes(id)), "同企业但不是项目成员：200，P1 上的任务不在 tasks 里", { status: rs.status, got: ids(rs).length });
      const rx = await recent(uExOrgAdmin, "?limit=20");
      ok(rx.status === 200 && rx.tasks.length === 0, "组织成员身份已停用的原组织管理员：200，tasks 为空", { status: rx.status, got: ids(rx).length });
    }

    // ── 未分发项目上的巡检任务 ──
    console.log("未分发项目上的巡检任务");
    {
      const r = await recent(uOwner, "?triggerType=cron");
      const p3Cron = fixtureTasks.find((t) => t.createdById === uOwner.id && t.projectId === P3.id && t.triggerType === "cron")!;
      ok(r.status === 200 && !ids(r).includes(p3Cron.id) && !r.text.includes(P3.name), "项目负责人（不是 super_admin）?triggerType=cron：200，未分发 P3 上的巡检任务不在 tasks 里", { status: r.status, got: ids(r).map((id) => projectKey.get(fixtureTasks.find((t) => t.id === id)?.projectId ?? "")) });
      const rs = await recent(uSuper, "?triggerType=cron");
      const p3CronSuper = fixtureTasks.find((t) => t.createdById === uSuper.id && t.projectId === P3.id && t.triggerType === "cron")!;
      ok(rs.status === 200 && ids(rs).includes(p3CronSuper.id), "super_admin 同样查看：自己在未分发 P3 上的巡检任务在结果里", { status: rs.status });
      ok(r.status === 200 && same(ids(r), expectedFor(uOwner, guardResult.get(uOwner.id)!, 10, "cron")), "项目负责人 ?triggerType=cron：结果正好是守卫放行的项目上的 cron 任务（只剩 P1 上那条）", { status: r.status, n: r.tasks.length });
    }

    // ── 触发方式筛选与排序 ──
    console.log("触发方式筛选与排序照旧");
    {
      // 只看筛选与排序（与项目范围无关，改动前后都应通过）；范围见上一节与对照断言
      const newestFirst = (r: CallResult) =>
        r.tasks.every((t, i) => i === 0 || Date.parse(String(r.tasks[i - 1].createdAt)) > Date.parse(String(t.createdAt)));
      const r = await recent(uOwner, "?triggerType=cron");
      const p1Cron = fixtureTasks.find((t) => t.createdById === uOwner.id && t.projectId === P1.id && t.triggerType === "cron")!;
      ok(r.status === 200 && ids(r).includes(p1Cron.id) && r.tasks.every((t) => t.triggerType === "cron") && newestFirst(r), "项目负责人 ?triggerType=cron：只有 cron 任务（含 P1 上那条），按建任务时间从新到旧", { status: r.status, got: r.tasks.map((t) => [t.triggerType, t.createdAt]) });
      const rm = await recent(uOrgAdmin, "?triggerType=manual");
      const p1Manual = fixtureTasks.find((t) => t.createdById === uOrgAdmin.id && t.projectId === P1.id && t.triggerType === "manual")!;
      ok(rm.status === 200 && ids(rm).includes(p1Manual.id) && rm.tasks.every((t) => t.triggerType === "manual") && newestFirst(rm), "组织管理员 ?triggerType=manual：只有 manual 任务（含 P1 上那条），按建任务时间从新到旧", { status: rm.status, got: rm.tasks.map((t) => [t.triggerType, t.createdAt]) });
      ok(same(Object.keys(r.body), ["tasks"]), "响应形状照旧是 { tasks }", Object.keys(r.body));
    }

    // ── 不是平台管理员的人看到的检查报告为空，拿不到检查报告里的内容 ──
    console.log("不是平台管理员的人：检查报告为空、正文里没有标记串与打不开的项目");
    for (const u of controlUsers.filter((x) => x.id !== uSuper.id)) {
      const r = await recent(u, "?limit=20");
      const allSteps = r.tasks.flatMap((t) => t.steps ?? []);
      ok(r.status === 200 && allSteps.every((s) => "checkReportJson" in s && s.checkReportJson === null), `${u.name}：每一步都带 checkReportJson 键、值为 null（${allSteps.length} 步）`, allSteps.filter((s) => s.checkReportJson !== null).length);
      ok(r.status === 200 && keysOk(r), `${u.name}：任务 10 个键、步骤 5 个键，与改动前相同`, r.tasks[0] ? { task: Object.keys(r.tasks[0]), step: Object.keys(r.tasks[0].steps?.[0] ?? {}) } : r.status);
      const leaked = [RAW_ERROR_MARK, PRICE_MARK, "利润率"].filter((m) => r.text.includes(m));
      const denied = fixtureTasks.filter((t) => t.createdById === u.id && !guardResult.get(u.id)!.has(t.projectId)).map((t) => t.projectId);
      const hidden = [...new Set(denied)].flatMap(hiddenMarks).filter((m) => r.text.includes(m));
      ok(leaked.length === 0 && hidden.length === 0, `${u.name}：正文里没有原始报错 / 价格标记串与「利润率」，也没有打不开的项目的名字、编号、意图与步骤摘要`, { leaked, hidden });
    }
    {
      const r = await recent(uViewer, "?limit=20");
      const steps = r.tasks.flatMap((t) => t.steps);
      const mismatch = steps.filter((s) => {
        const d = dbSteps.get(s.id);
        return !d || s.title !== d.title || s.status !== d.status || s.outputSummary !== d.outputSummary;
      });
      ok(r.status === 200 && steps.length > 0 && mismatch.length === 0, "只读成员：步骤标题、状态、摘要与库里一致", mismatch.slice(0, 2));
      const t = r.tasks[0];
      const dbTask = t ? await db.agentTask.findUnique({ where: { id: t.id }, include: { project: { select: { id: true, name: true } } } }) : null;
      ok(
        !!t && !!dbTask && t.taskType === dbTask.taskType && t.triggerType === dbTask.triggerType && t.intent === dbTask.intent && t.status === dbTask.status &&
          t.currentStepIndex === dbTask.currentStepIndex && t.totalSteps === dbTask.totalSteps && t.createdAt === dbTask.createdAt.toISOString() &&
          t.completedAt === null && same(t.project, dbTask.project),
        "只读成员：任务的编号、类型、触发方式、意图、状态、步序、总步数、时间、所属项目照旧",
        t,
      );
    }

    // ── 平台管理员照旧看到全部原文 ──
    console.log("平台管理员照旧看到全部原文");
    {
      const r = await recent(uSuper, "?limit=20");
      const mine = fixtureTasks.filter((t) => t.createdById === uSuper.id);
      ok(r.status === 200 && mine.length === 10 && mine.every((t) => ids(r).includes(t.id)) && r.tasks.length === 10, "super_admin（不属于甲）：P1–P6 上自己建的 10 条任务都在结果里（含未分发的 P3）", { status: r.status, got: r.tasks.length });
      const steps = r.tasks.flatMap((t) => t.steps);
      const diff = steps.filter((s) => s.checkReportJson !== (dbSteps.get(s.id)?.checkReportJson ?? null));
      ok(steps.length === 20 && diff.length === 0 && steps.some((s) => s.checkReportJson === failedReport), "super_admin：每一步 checkReportJson 与库里一字不差（含带原始报错的那一步）", diff.length);
      ok(keysOk(r) && !r.text.includes(`${RAW_ERROR_MARK} raw error`), "super_admin：键集合不变，步骤里没有选出原始报错字段 error", r.tasks[0] ? Object.keys(r.tasks[0].steps[0] ?? {}) : r.status);
    }

    // ── 以岗位预览身份访问的 super_admin ──
    console.log("以岗位预览身份访问的 super_admin");
    {
      ok(previewToken !== null, "丙按岗位模式，签出了预览 token", previewPosition?.key);
      const r = await recent(uSuper, "?limit=20", previewToken);
      ok(r.status === 200 && same(ids(r), [taskSuperP6.id]), "预览企业丙：tasks 里只有 P6 上那一条（P5 不是项目成员、P1–P4 在别的企业或没有组织）", { status: r.status, got: ids(r).map((id) => projectKey.get(fixtureTasks.find((t) => t.id === id)?.projectId ?? "")) });
      ok(r.status === 200 && r.tasks.length > 0 && r.tasks.every((t) => t.steps.every((s) => s.checkReportJson === null)) && ![RAW_ERROR_MARK, PRICE_MARK, "利润率"].some((m) => r.text.includes(m)), "预览中：每一步 checkReportJson 为 null，正文里没有标记串", r.text.slice(0, 300));
      ok(!ids(r).includes(taskSuperP5.id) && !r.text.includes(P5.name), "预览中：P5 上的任务与 P5 的名字都不出现");
      const { allowed } = await readableProjects(uSuper, previewToken);
      ok(same(ids(r), expectedFor(uSuper, allowed, 20)), "预览中：与按预览身份逐项目调守卫放行的结果相同", [...allowed].map((id) => projectKey.get(id)));
    }

    // ── 条数上限按可见任务计 ──
    console.log("条数上限按可见任务计（条数用户：P1 上 22 条较早、P2 上 25 条更新）");
    {
      const newestP1 = (n: number) => [...countP1].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, n).map((t) => t.id);
      const p2Ids = new Set(fixtureTasks.filter((t) => t.createdById === uCount.id && t.projectId === P2.id).map((t) => t.id));
      const show = (r: CallResult) => ({ status: r.status, n: r.tasks.length, p2: ids(r).filter((id) => p2Ids.has(id)).length, error: r.body.error });
      const r5 = await recent(uCount, "?limit=5");
      ok(r5.status === 200 && same(ids(r5), newestP1(5)), "?limit=5：P1 上最新的 5 条，P2 上的一条都不出现（先筛后取）", show(r5));
      const rNone = await recent(uCount);
      ok(rNone.status === 200 && same(ids(rNone), newestP1(10)), "不带 limit：P1 上最新的 10 条", show(rNone));
      const r50 = await recent(uCount, "?limit=50");
      ok(r50.status === 200 && same(ids(r50), newestP1(20)), "?limit=50：P1 上最新的 20 条", show(r50));
      for (const q of ["-5", "abc", "0", "2.5", ""]) {
        const r = await recent(uCount, `?limit=${q}`);
        ok(r.status === 200 && same(ids(r), newestP1(10)), `?limit=${q === "" ? "（空串）" : q}：200，P1 上最新的 10 条`, show(r));
      }
    }

    // ── 未登录返回 401 ──
    console.log("未登录返回 401");
    {
      const r = await recent(null);
      ok(r.status === 401 && r.body.error === "未登录" && !("tasks" in r.body), "不带会话：401「未登录」，正文没有 tasks", r);
      const rs = await recent(uSuspended);
      ok(rs.status === 401 && !("tasks" in rs.body), "账号已停用、此前建过任务的用户带旧会话：401，正文没有 tasks", rs);
    }

    // ── 库里不变 ──
    console.log("不是平台管理员的人看过之后，库里不变");
    {
      const after = await dbSnapshot();
      ok(after === before, "全部请求前后，任务与步骤的每个字段都不变");
      const stillRaw = await db.agentTaskStep.count({ where: { taskId: { in: allTaskIds }, checkReportJson: failedReport } });
      ok(stillRaw > 0 && stillRaw === [...dbSteps.values()].filter((s) => s.checkReportJson === failedReport).length, "库里的检查报告仍是原文", stillRaw);
    }
  } finally {
    // ───────────────────────── 清理 ─────────────────────────
    const projectIds = projects.map((p) => p.id);
    const orgIds = [orgA.id, orgB.id, orgC.id];
    const userIds = allUsers.map((u) => u.id);
    const quiet = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        console.log(`  （清理 ${label} 失败，留在隔离库里：${e instanceof Error ? e.message.split("\n")[0] : String(e)}）`);
      }
    };
    await quiet("agentTask", () => db.agentTask.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectMember", () => db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("project", () => db.project.deleteMany({ where: { id: { in: projectIds } } }));
    await quiet("principalRoleBinding", () => db.principalRoleBinding.deleteMany({ where: { orgId: { in: orgIds } } }));
    await quiet("roleProfile", () => db.roleProfile.deleteMany({ where: { orgId: { in: orgIds } } }));
    await quiet("organizationMember", () => db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } }));
    await quiet("organization", () => db.organization.deleteMany({ where: { id: { in: orgIds } } }));
    await quiet("user", () => db.user.deleteMany({ where: { id: { in: userIds } } }));
    await db.$disconnect();
  }

  console.log(`\nFIX-23 agent tasks recent view (DB + HTTP): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
