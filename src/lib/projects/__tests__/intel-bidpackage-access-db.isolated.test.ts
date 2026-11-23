/**
 * FIX-21 项目情报与一键投标方案六个接口的项目权限检查 — DB + HTTP（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts
 *
 * 直接调路由导出的处理函数（带 createSession 签的会话 cookie），对应
 * openspec/changes/project-intel-bidpackage-access/specs/projects/intel-bidpackage-access 的每条 Scenario：
 *   - 未登录 / 已停用账号 401；别的组织、同组织非成员、inactive 项目成员、inactive 原组织管理员 403；
 *     只读成员与操作员、没有组织的项目里的项目管理员不能建任务 / 执行（403「无权修改该项目」）；
 *     不存在与未分发的项目 404；别的项目的任务 ID 404「任务不存在」；
 *   - 被拒之后任务与步骤、情报、项目、相似项目、待摘要文件逐字段不变，假模型服务 0 次请求，没有新通知；
 *     被拒的响应只有 error（可带 requestId），不带任务 / 步骤 / 审核结论，也不出现价格与原始报错的标记串；
 *   - 有权限的人照常可用；不是平台管理员的人只拿安全视图（步骤 data 为空对象、报错换成固定提示），
 *     平台管理员照旧拿到原文；不是平台管理员的人执行后库里存的仍是原文。
 *
 * 模型端是本机起的 OpenAI 兼容假服务（OPENAI_BASE_URL 指过去），统计收到的请求数。放行用例都挑不调模型的路径
 * （项目丙没有可用文档；执行的那一步是无事可做的文档摘要或未知技能），所以整个测试应当是 0 次模型请求。
 * 执行完最后一步发的通知不 await，按 projectId + sourceKey 前缀轮询到预期条数。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 FIX-21 情报与一键投标方案权限 DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 FIX-21 情报与一键投标方案权限 DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 FIX-21 情报与一键投标方案权限 DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "fix-21 project intel / bid package access" });
}

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

// ── 本机 OpenAI 兼容假服务：只数请求，一律回一个空对象 ──
const modelRequests: string[] = [];
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    modelRequests.push(`${req.method} ${req.url}`);
    let model = "test-model";
    try {
      model = (JSON.parse(body || "{}") as { model?: string }).model ?? model;
    } catch {
      /* 不是 JSON 也照样回 */
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl-fix21",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

async function main() {
  requireIsolatedTestDb();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.OPENAI_API_KEY = "fix21-test-key";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "fix21-project-intel-bidpackage-access-test-secret";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { SAFE_STEP_ERROR_MESSAGE } = await import("@/lib/agent-tasks/dto");
  const bidPackageRoute = await import("@/app/api/projects/[id]/ai-bid-package/route");
  const runStepRoute = await import("@/app/api/projects/[id]/ai-bid-package/run-step/route");
  const regenerateRoute = await import("@/app/api/projects/[id]/intelligence/regenerate/route");
  const reviewRoute = await import("@/app/api/projects/[id]/intelligence/review/route");

  const tag = `fix21_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const PRICE_MARK = `PRICE_MARK_${tag}`;
  const PRICE_NUMBER = 731984.27;
  const RAW_ERROR_MARK = `RAW_ERROR_MARK_${tag}`;
  const REVIEW_NOTE_MARK = `REVIEW_NOTE_${tag}`;
  const REVIEWER_MARK = `REVIEWER_${tag}`;
  const META_MARK = `META_MARK_${tag}`;
  const SECRET_TEXT = `Tender requirement text for ${tag}: mandatory bid bond 10 percent, delivery within 30 days of award.`;

  // ───────────────────────── 夹具：人 ─────────────────────────
  const mkUser = (slug: string, opts: { status?: string; role?: string } = {}) =>
    db.user.create({
      data: {
        email: `${slug}_${tag}@test.qingyan.local`,
        name: `${slug} ${tag}`,
        role: opts.role ?? "user",
        status: opts.status ?? "active",
      },
    });
  const uOwner = await mkUser("f21_owner"); // 项目甲、丙、甲二、丁的负责人
  const uOrgAdmin = await mkUser("f21_org_admin"); // 组织甲管理员，不是任何项目的成员
  const uProjAdmin = await mkUser("f21_proj_admin"); // 项目甲、丙、丁的项目管理员
  const uViewer = await mkUser("f21_viewer"); // 项目甲、丙、甲二的只读成员
  const uOperator = await mkUser("f21_operator"); // 项目甲、丙的操作员
  const uSameOrg = await mkUser("f21_same_org"); // 组织甲普通成员，不是项目成员
  const uInactiveMember = await mkUser("f21_inactive_member"); // 项目甲成员身份 inactive
  const uExOrgAdmin = await mkUser("f21_ex_org_admin"); // 组织甲管理员身份已 inactive，不是项目成员
  const uOutsider = await mkUser("f21_outsider"); // 组织乙管理员
  const uSuper = await mkUser("f21_super", { role: "super_admin" }); // 不属于任何组织
  const uSuspended = await mkUser("f21_suspended", { status: "suspended" }); // 账号已停用，曾是项目甲的项目管理员
  const allUsers = [uOwner, uOrgAdmin, uProjAdmin, uViewer, uOperator, uSameOrg, uInactiveMember, uExOrgAdmin, uOutsider, uSuper, uSuspended];

  const orgA = await db.organization.create({
    data: { name: `F21 OrgA ${tag}`, code: `f21a_${tag}`, ownerId: uOwner.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `F21 OrgB ${tag}`, code: `f21b_${tag}`, ownerId: uOutsider.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: uOwner.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uOrgAdmin.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: uProjAdmin.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uViewer.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uOperator.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uSameOrg.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uInactiveMember.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uExOrgAdmin.id, role: "org_admin", status: "inactive" },
      { orgId: orgA.id, userId: uSuspended.id, role: "org_member", status: "active" },
      { orgId: orgB.id, userId: uOutsider.id, role: "org_admin", status: "active" },
    ],
  });

  // ───────────────────────── 夹具：项目 ─────────────────────────
  const mkProject = (orgId: string | null, ownerId: string, slug: string, intakeStatus = "dispatched") =>
    db.project.create({ data: { orgId, name: `F21 ${slug} ${tag}`, ownerId, intakeStatus } });
  const projA = await mkProject(orgA.id, uOwner.id, "ProjA"); // 专给被拒用例
  const projC = await mkProject(orgA.id, uOwner.id, "ProjC"); // 专给放行用例：没有可用文档内容
  const projA2 = await mkProject(orgA.id, uOwner.id, "ProjA2", "pending_dispatch"); // 未分发
  const projB = await mkProject(orgB.id, uOutsider.id, "ProjB"); // 组织乙
  const projD = await mkProject(null, uOwner.id, "ProjD"); // 没有所属组织
  const projectIds = [projA.id, projC.id, projA2.id, projB.id, projD.id];
  await db.projectMember.createMany({
    data: [
      { projectId: projA.id, userId: uProjAdmin.id, role: "project_admin", status: "active" },
      { projectId: projA.id, userId: uViewer.id, role: "viewer", status: "active" },
      { projectId: projA.id, userId: uOperator.id, role: "operator", status: "active" },
      { projectId: projA.id, userId: uInactiveMember.id, role: "viewer", status: "inactive" },
      { projectId: projA.id, userId: uSuspended.id, role: "project_admin", status: "active" },
      { projectId: projC.id, userId: uProjAdmin.id, role: "project_admin", status: "active" },
      { projectId: projC.id, userId: uViewer.id, role: "viewer", status: "active" },
      { projectId: projC.id, userId: uOperator.id, role: "operator", status: "active" },
      { projectId: projA2.id, userId: uViewer.id, role: "viewer", status: "active" },
      { projectId: projD.id, userId: uProjAdmin.id, role: "project_admin", status: "active" },
    ],
  });

  // 项目甲：一份已解析、带正文、待摘要的文件；一份已审核通过的情报；两条相似项目记录
  const pendingDoc = await db.projectDocument.create({
    data: {
      projectId: projA.id,
      title: `F21 tender ${tag}.pdf`,
      url: `https://example.invalid/${tag}/tender.pdf`,
      fileType: "pdf",
      source: "upload",
      parseStatus: "done",
      contentText: SECRET_TEXT,
      aiSummaryStatus: "pending",
    },
  });
  await db.projectIntelligence.create({
    data: {
      projectId: projA.id,
      recommendation: "pursue",
      riskLevel: "low",
      fitScore: 82,
      summary: `Intel summary ${tag}`,
      fullReportJson: JSON.stringify({ _meta: { marker: META_MARK, model: "test" } }),
      reportStatus: "approved",
      reviewedBy: REVIEWER_MARK,
      reviewedAt: new Date("2026-11-01T10:00:00Z"),
      reviewNotes: REVIEW_NOTE_MARK,
      reviewScore: 4,
    },
  });
  await db.projectSimilarity.createMany({
    data: [
      { orgId: orgA.id, projectId: projA.id, similarProjectId: projC.id, score: 0.61, reasonsJson: JSON.stringify(["r1"]) },
      { orgId: orgA.id, projectId: projA.id, similarProjectId: projA2.id, score: 0.42, reasonsJson: JSON.stringify(["r2"]) },
    ],
  });
  // 项目丙：一份情报，供审核读写的放行用例
  await db.projectIntelligence.create({
    data: { projectId: projC.id, recommendation: "review", riskLevel: "medium", fitScore: 55, reportStatus: "ai_generated" },
  });

  // ───────────────────────── 夹具：一键投标方案任务 ─────────────────────────
  type StepSeed = { skillId: string; status: string; outputJson?: string | null; outputSummary?: string | null; error?: string | null; inputJson?: string | null };
  const quoteOutput = JSON.stringify({
    draft: { lineItems: [{ productName: PRICE_MARK, quantity: 10, unitPrice: PRICE_NUMBER, costPrice: 512340.11 }], notes: PRICE_MARK },
    recommendation: { templateType: "standard", reason: "test" },
  });
  const t0 = new Date("2026-11-20T10:00:00Z");
  const t1 = new Date("2026-11-20T10:00:07Z");
  const mkTask = async (projectId: string, status: string, steps: StepSeed[], extra: { currentStepIndex?: number } = {}) =>
    db.agentTask.create({
      data: {
        projectId,
        taskType: "ai_bid_package",
        triggerType: "manual",
        intent: "AI 一键生成投标方案",
        riskLevel: "medium",
        status,
        totalSteps: steps.length,
        currentStepIndex: extra.currentStepIndex ?? 0,
        createdById: uOwner.id,
        steps: {
          create: steps.map((s, i) => ({
            stepIndex: i,
            skillId: s.skillId,
            agentName: s.skillId,
            title: `步骤 ${i + 1}`,
            status: s.status,
            outputJson: s.outputJson ?? null,
            outputSummary: s.outputSummary ?? null,
            error: s.error ?? null,
            inputJson: s.inputJson ?? null,
            startedAt: s.status === "pending" ? null : t0,
            completedAt: s.status === "completed" || s.status === "failed" ? t1 : null,
          })),
        },
      },
    });
  const pendingSteps = (): StepSeed[] => [
    { skillId: "document_summary", status: "pending" },
    { skillId: "intelligence_report", status: "pending" },
    { skillId: "quote", status: "pending", inputJson: JSON.stringify({ action: "'draft'" }) },
    { skillId: "email_draft", status: "pending" },
  ];
  // 项目甲：一个已完成的任务（报价草稿带价格标记），一个 queued 任务（下一步是文档摘要）
  const taskADone = await mkTask(projA.id, "completed", [
    { skillId: "document_summary", status: "completed", outputJson: JSON.stringify({ processed: 0 }), outputSummary: "所有文档已有摘要，无需处理" },
    { skillId: "intelligence_report", status: "completed", outputJson: JSON.stringify({ report: `intel ${tag}` }), outputSummary: "情报完成" },
    { skillId: "quote", status: "completed", outputJson: quoteOutput, outputSummary: "报价草稿 1 项", inputJson: JSON.stringify({ action: "'draft'" }) },
    { skillId: "email_draft", status: "completed", outputJson: JSON.stringify({ subject: `email ${PRICE_MARK}` }), outputSummary: "邮件草稿" },
  ], { currentStepIndex: 4 });
  const taskAQueued = await mkTask(projA.id, "queued", pendingSteps());
  const taskA2Queued = await mkTask(projA2.id, "queued", pendingSteps());
  const taskBQueued = await mkTask(projB.id, "queued", pendingSteps());
  // 项目丙：「丙-展示」报价草稿已完成（带价格标记），邮件草稿失败（带原始报错标记）
  const taskCShow = await mkTask(projC.id, "failed", [
    { skillId: "document_summary", status: "completed", outputJson: JSON.stringify({ processed: 0 }), outputSummary: "所有文档已有摘要，无需处理" },
    { skillId: "intelligence_report", status: "completed", outputJson: JSON.stringify({ report: `intel ${tag}` }), outputSummary: "情报完成" },
    { skillId: "quote", status: "completed", outputJson: quoteOutput, outputSummary: "报价草稿 1 项", inputJson: JSON.stringify({ action: "'draft'" }) },
    { skillId: "email_draft", status: "failed", error: `${RAW_ERROR_MARK}: model said {"unitPrice": ${PRICE_NUMBER}}` },
  ], { currentStepIndex: 3 });
  // 「丙-末步」：前 3 步已完成，只剩最后一步待执行（文档摘要：项目丙没有待摘要文件，不调模型）
  const lastStepTask = (status = "running") => mkTask(projC.id, status, [
    { skillId: "intelligence_report", status: "completed", outputJson: JSON.stringify({ report: "x" }), outputSummary: "情报完成" },
    { skillId: "quote", status: "completed", outputJson: JSON.stringify({ recommendation: { templateType: "standard" } }), outputSummary: "报价" },
    { skillId: "email_draft", status: "completed", outputJson: JSON.stringify({ subject: "s" }), outputSummary: "邮件" },
    { skillId: "document_summary", status: "pending" },
  ], { currentStepIndex: 3 });
  const taskCLast = await lastStepTask();
  const taskCLastSuper = await lastStepTask();
  // 下一步是未知技能：执行时走「未知技能」失败分支（不调模型），用来看失败时的报错给谁看
  const unknownSkill = `no_such_skill_${tag}`;
  const unknownTask = () => mkTask(projC.id, "running", [
    { skillId: "document_summary", status: "completed", outputJson: JSON.stringify({ processed: 0 }), outputSummary: "无需处理" },
    { skillId: unknownSkill, status: "pending" },
  ], { currentStepIndex: 1 });
  const taskCUnknown = await unknownTask();
  const taskCUnknownSuper = await unknownTask();

  // ───────────────────────── 快照 ─────────────────────────
  const tasksOf = async (projectId: string) =>
    JSON.stringify(
      await db.agentTask.findMany({
        where: { projectId },
        orderBy: { id: "asc" },
        include: { steps: { orderBy: { stepIndex: "asc" } } },
      }),
    );
  const deniedSnapshot = async () =>
    JSON.stringify({
      tasksA: await tasksOf(projA.id),
      tasksA2: await tasksOf(projA2.id),
      tasksB: await tasksOf(projB.id),
      tasksD: await db.agentTask.count({ where: { projectId: projD.id } }),
      intelA: await db.projectIntelligence.findUnique({ where: { projectId: projA.id } }),
      projectA: await db.project.findUnique({ where: { id: projA.id } }),
      simsA: await db.projectSimilarity.findMany({ where: { projectId: projA.id }, orderBy: { similarProjectId: "asc" } }),
      doc: await db.projectDocument.findUnique({ where: { id: pendingDoc.id } }),
      notificationsA: await db.notification.count({ where: { projectId: projA.id } }),
    });
  const reviewFields = async (projectId: string) =>
    JSON.stringify(
      await db.projectIntelligence.findUnique({
        where: { projectId },
        select: { reportStatus: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, reviewScore: true },
      }),
    );

  // ───────────────────────── 请求 ─────────────────────────
  type TestUser = { id: string; email: string; role: string };
  const cookieFor = async (user: TestUser | null) =>
    user ? `qy_session=${await createSession({ sub: user.id, email: user.email, role: user.role })}` : "";
  const mkRequest = async (user: TestUser | null, method: string, url: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    const cookie = await cookieFor(user);
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    return new NextRequest(`http://localhost${url}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };
  type CallResult = { status: number; body: Record<string, unknown>; text: string };
  const read = async (res: Response): Promise<CallResult> => {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* 非 JSON 响应，body 留空 */
    }
    return { status: res.status, body, text };
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const getBidPackage = async (user: TestUser | null, projectId: string, taskId?: string) =>
    read(await bidPackageRoute.GET(await mkRequest(user, "GET", `/api/projects/${projectId}/ai-bid-package${taskId ? `?taskId=${taskId}` : ""}`), ctx(projectId)));
  const createBidPackage = async (user: TestUser | null, projectId: string) =>
    read(await bidPackageRoute.POST(await mkRequest(user, "POST", `/api/projects/${projectId}/ai-bid-package`), ctx(projectId)));
  const runStep = async (user: TestUser | null, projectId: string, taskId: string) =>
    read(await runStepRoute.POST(await mkRequest(user, "POST", `/api/projects/${projectId}/ai-bid-package/run-step`, { taskId }), ctx(projectId)));
  const regenerate = async (user: TestUser | null, projectId: string) =>
    read(await regenerateRoute.POST(await mkRequest(user, "POST", `/api/projects/${projectId}/intelligence/regenerate`), ctx(projectId)));
  const getReview = async (user: TestUser | null, projectId: string) =>
    read(await reviewRoute.GET(await mkRequest(user, "GET", `/api/projects/${projectId}/intelligence/review`), ctx(projectId)));
  const patchReview = async (user: TestUser | null, projectId: string, body: Record<string, unknown>) =>
    read(await reviewRoute.PATCH(await mkRequest(user, "PATCH", `/api/projects/${projectId}/intelligence/review`, body), ctx(projectId)));

  /** 六个处理函数各调一次（项目甲；执行用甲的 queued 任务；审核改成 approved） */
  const callAllSix = async (user: TestUser | null) => ({
    getBidPackage: await getBidPackage(user, projA.id, taskADone.id),
    getBidPackageLatest: await getBidPackage(user, projA.id),
    createBidPackage: await createBidPackage(user, projA.id),
    runStep: await runStep(user, projA.id, taskAQueued.id),
    regenerate: await regenerate(user, projA.id),
    getReview: await getReview(user, projA.id),
    patchReview: await patchReview(user, projA.id, { reportStatus: "approved", reviewNotes: "hijack", reviewScore: 1 }),
  });
  const READ_HANDLERS = ["getBidPackage", "getBidPackageLatest", "regenerate", "getReview", "patchReview"] as const;
  const WRITE_HANDLERS = ["createBidPackage", "runStep"] as const;

  /** 被拒的响应：只有 error（可带 requestId），不带任务 / 步骤 / 审核结论，不出现任何标记串与项目甲的任务 ID */
  const LEAK_KEYS = ["taskId", "steps", "data", "status", "done", "summary", "reportStatus", "reviewNotes", "reviewedBy", "reviewedAt", "reviewScore", "recommendation", "riskLevel", "fitScore", "meta"];
  const LEAK_TEXT = [PRICE_MARK, String(PRICE_NUMBER), RAW_ERROR_MARK, REVIEW_NOTE_MARK, REVIEWER_MARK, META_MARK, taskADone.id, taskAQueued.id, taskA2Queued.id];
  const noContent = (r: CallResult) =>
    Object.keys(r.body).every((k) => k === "error" || k === "requestId") &&
    LEAK_KEYS.every((k) => !(k in r.body)) &&
    !LEAK_TEXT.some((s) => r.text.includes(s));

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const countDoneNotifications = (projectId: string, taskId: string) =>
    db.notification.findMany({
      where: { projectId, sourceKey: { startsWith: `bid_package_done:${taskId}:` } },
      select: { userId: true, title: true, priority: true },
    });
  const waitForNotifications = async (projectId: string, taskId: string, expected: number) => {
    for (let i = 0; i < 50; i += 1) {
      const rows = await countDoneNotifications(projectId, taskId);
      if (rows.length >= expected) break;
      await sleep(100);
    }
    await sleep(300);
    return countDoneNotifications(projectId, taskId);
  };

  const baseline = await deniedSnapshot();
  const baselineReviewA = await reviewFields(projA.id);

  try {
    // ───────────────────────── 未登录返回 401 ─────────────────────────
    console.log("未登录返回 401");
    {
      const r = await callAllSix(null);
      for (const [k, v] of Object.entries(r)) {
        ok(v.status === 401 && v.body.error === "未登录", `未登录调 ${k} → 401「未登录」`, v);
      }
      ok(Object.values(r).every(noContent), "未登录的响应只有 error，不带任务与情报内容", Object.values(r).map((v) => v.body));
      const s = await runStep(uSuspended, projA.id, taskAQueued.id);
      ok(s.status === 401, "已停用的账号（曾是项目管理员）带着旧会话调 run-step → 401", s);
      const s2 = await callAllSix(uSuspended);
      ok(Object.values(s2).every((v) => v.status === 401 && noContent(v)), "已停用的账号调六个处理函数都是 401，响应不带内容", Object.values(s2).map((v) => [v.status, v.body]));
      ok((await deniedSnapshot()) === baseline, "未登录与已停用账号的请求没有改任何任务、情报、项目、相似项目、文件，没有通知");
      ok(modelRequests.length === 0, "未登录与已停用账号的请求没有发起模型调用", modelRequests);
    }

    // ───────────────────────── 别的组织的管理员 403 ─────────────────────────
    console.log("与项目无关的登录用户返回 403：别的组织的管理员");
    {
      const before = modelRequests.length;
      const r = await callAllSix(uOutsider);
      for (const k of READ_HANDLERS) ok(r[k].status === 403 && r[k].body.error === "无权查看该项目", `别的组织的管理员调 ${k} → 403「无权查看该项目」`, r[k]);
      for (const k of WRITE_HANDLERS) ok(r[k].status === 403 && r[k].body.error === "无权修改该项目", `别的组织的管理员调 ${k} → 403「无权修改该项目」`, r[k]);
      ok(Object.values(r).every(noContent), "被拒的响应只有 error：没有 taskId / steps，没有 reportStatus / reviewNotes / reviewedBy / recommendation，不出现价格、报错、备注、审核人的文字", Object.values(r).map((v) => v.text.slice(0, 200)));
      ok(!("taskId" in r.getBidPackage.body) && !("steps" in r.getBidPackage.body) && !r.getBidPackage.text.includes(PRICE_MARK), "被拒的查看不回报价草稿（项目里有一个报价草稿带价格的已完成任务）", r.getBidPackage.text);
      ok(["reportStatus", "reviewNotes", "reviewedBy", "recommendation"].every((k) => !(k in r.getReview.body)) && !r.getReview.text.includes(REVIEW_NOTE_MARK) && !r.getReview.text.includes(REVIEWER_MARK), "被拒的读取不回审核结论（情报带审核备注与审核人）", r.getReview.text);
      ok(modelRequests.length === before, "被拒的执行（下一步是文档摘要、项目里有待摘要文件）与被拒的重新生成：假模型服务收到 0 次请求", modelRequests.slice(before));
      const now = JSON.parse(await deniedSnapshot());
      const base = JSON.parse(baseline);
      ok(now.tasksA === base.tasksA, "被拒的执行：甲的待执行任务那一步仍是待执行，各任务与步骤都没变", now.tasksA === base.tasksA ? undefined : now.tasksA);
      ok(JSON.stringify(now.doc) === JSON.stringify(base.doc), "被拒的执行：待摘要文件的摘要状态没变", now.doc);
      ok(now.notificationsA === 0, "被拒的执行：项目成员没有新通知", now.notificationsA);
      ok(JSON.stringify(now.intelA) === JSON.stringify(base.intelA), "被拒的重新生成：情报记录（含审核状态、备注、评分、审核人）与请求前一致", now.intelA);
      ok(JSON.stringify(now.projectA) === JSON.stringify(base.projectA), "被拒的重新生成：项目记录与请求前一致（结构化摘要没刷新）");
      ok(JSON.stringify(now.simsA) === JSON.stringify(base.simsA), "被拒的重新生成：相似项目记录没被删、没被重建", now.simsA);
      ok(now.tasksD === 0 && (await db.agentTask.count({ where: { projectId: projA.id } })) === 2, "被拒的建任务：项目甲的任务数不变", now.tasksD);
    }

    // ───────────────────────── 同组织但不是项目成员 ─────────────────────────
    console.log("与项目无关的登录用户返回 403：同组织但不是项目成员");
    {
      const before = modelRequests.length;
      const r1 = await getBidPackage(uSameOrg, projA.id, taskADone.id);
      const r2 = await patchReview(uSameOrg, projA.id, { reportStatus: "approved" });
      ok(r1.status === 403 && r1.body.error === "无权查看该项目", "同组织普通成员调 GET …/ai-bid-package → 403「无权查看该项目」", r1);
      ok(r2.status === 403 && r2.body.error === "无权查看该项目", "同组织普通成员调 PATCH …/intelligence/review（approved）→ 403「无权查看该项目」", r2);
      ok((await reviewFields(projA.id)) === baselineReviewA, "被拒的审核：审核状态、审核人、审核时间、备注、评分都与请求前一致", await reviewFields(projA.id));
      const r = await callAllSix(uSameOrg);
      for (const k of READ_HANDLERS) ok(r[k].status === 403 && r[k].body.error === "无权查看该项目", `同组织普通成员调 ${k} → 403「无权查看该项目」`, r[k]);
      for (const k of WRITE_HANDLERS) ok(r[k].status === 403 && r[k].body.error === "无权修改该项目", `同组织普通成员调 ${k} → 403「无权修改该项目」`, r[k]);
      ok([r1, r2, ...Object.values(r)].every(noContent), "同组织普通成员被拒的响应都不带内容");
      ok(modelRequests.length === before, "同组织普通成员的请求没有发起模型调用", modelRequests.slice(before));
    }

    // ───────────────────────── 已停用的项目成员与组织管理员 ─────────────────────────
    console.log("与项目无关的登录用户返回 403：已停用的项目成员、已停用的组织管理员");
    {
      const before = modelRequests.length;
      const r1 = await regenerate(uInactiveMember, projA.id);
      ok(r1.status === 403 && r1.body.error === "无权查看该项目", "项目成员身份 inactive 的用户调 POST …/intelligence/regenerate → 403", r1);
      const r2 = await createBidPackage(uExOrgAdmin, projA.id);
      ok(r2.status === 403 && r2.body.error === "无权修改该项目", "组织成员身份 inactive 的原组织管理员（不是项目成员）调 POST …/ai-bid-package → 403", r2);
      const ri = await callAllSix(uInactiveMember);
      const re = await callAllSix(uExOrgAdmin);
      ok([...Object.values(ri), ...Object.values(re)].every((v) => v.status === 403), "这两个人调六个处理函数都是 403", [...Object.values(ri), ...Object.values(re)].map((v) => v.status));
      ok([r1, r2, ...Object.values(ri), ...Object.values(re)].every(noContent), "响应都不带内容");
      ok(modelRequests.length === before, "这些请求没有发起模型调用", modelRequests.slice(before));
    }

    // ───────────────────────── 只读成员与操作员不能建任务、不能执行 ─────────────────────────
    console.log("一键投标方案的建任务与逐步执行只对项目管理者开放：只读成员、操作员");
    {
      const before = modelRequests.length;
      const rs = [
        ["只读成员", "建任务", await createBidPackage(uViewer, projA.id)],
        ["只读成员", "执行", await runStep(uViewer, projA.id, taskAQueued.id)],
        ["操作员", "建任务", await createBidPackage(uOperator, projA.id)],
        ["操作员", "执行", await runStep(uOperator, projA.id, taskAQueued.id)],
      ] as const;
      for (const [who, what, r] of rs) ok(r.status === 403 && r.body.error === "无权修改该项目", `${who}${what} → 403「无权修改该项目」`, r);
      ok(rs.every(([, , r]) => noContent(r)), "响应不带任务内容");
      ok((await db.agentTask.count({ where: { projectId: projA.id } })) === 2, "项目甲的任务数不变");
      ok((await tasksOf(projA.id)) === JSON.parse(baseline).tasksA, "已有任务的各步骤状态不变");
      ok(modelRequests.length === before, "没有发起模型调用", modelRequests.slice(before));
    }

    // ───────────────────────── 没有所属组织的项目里的项目管理员 ─────────────────────────
    console.log("一键投标方案的建任务只对项目管理者开放：没有所属组织的项目里的项目管理员");
    {
      const r = await createBidPackage(uProjAdmin, projD.id);
      ok(r.status === 403 && r.body.error === "无权修改该项目", "没有所属组织、已分发的项目里，项目管理员调 POST …/ai-bid-package → 403「无权修改该项目」", r);
      ok((await db.agentTask.count({ where: { projectId: projD.id } })) === 0, "项目丁的任务数不变（0）");
    }

    // ───────────────────────── 项目不存在或未分发 404 ─────────────────────────
    console.log("项目不存在或未分发返回 404");
    {
      const ghost = `no_such_project_${tag}`;
      const r1 = await createBidPackage(uViewer, ghost);
      ok(r1.status === 404 && r1.body.error === "项目不存在", "不存在的项目 ID 调 POST …/ai-bid-package → 404「项目不存在」", r1);
      const r2 = await getReview(uViewer, ghost);
      ok(r2.status === 404 && r2.body.error === "项目不存在", "不存在的项目 ID 调 GET …/intelligence/review → 404「项目不存在」", r2);
      const r3 = await runStep(uOwner, projA2.id, taskA2Queued.id);
      ok(r3.status === 404 && r3.body.error === "项目不存在", "项目负责人对未分发的项目调 run-step → 404「项目不存在」", r3);
      ok((await tasksOf(projA2.id)) === JSON.parse(baseline).tasksA2, "未分发项目里那个待执行任务的各步骤状态不变");
      const r4 = await getBidPackage(uViewer, projA2.id, taskA2Queued.id);
      const r5 = await regenerate(uOwner, projA2.id);
      ok(r4.status === 404 && r5.status === 404, "成员与负责人对未分发的项目调 GET …/ai-bid-package、regenerate → 404", [r4, r5]);
      ok([r1, r2, r3, r4, r5].every(noContent), "404 响应都不带内容");
    }

    // ───────────────────────── 一键投标方案只认本项目的任务 ─────────────────────────
    console.log("一键投标方案只认本项目的任务");
    {
      const beforeB = await tasksOf(projB.id);
      const r1 = await runStep(uProjAdmin, projA.id, taskBQueued.id);
      ok(r1.status === 404 && r1.body.error === "任务不存在", "项目甲的项目管理员用项目乙的任务 ID 调 run-step → 404「任务不存在」", r1);
      ok((await tasksOf(projB.id)) === beforeB, "项目乙这个任务的状态与各步骤都不变");
      const r2 = await getBidPackage(uProjAdmin, projA.id, taskBQueued.id);
      ok(r2.status === 404 && r2.body.error === "任务不存在" && !("steps" in r2.body), "用项目乙的任务 ID 调 GET …/ai-bid-package → 404「任务不存在」，不返回那个任务", r2);
    }

    // 被拒用例全部结束：项目甲 / 甲二 / 乙 / 丁的数据与开头逐字段一致
    ok((await deniedSnapshot()) === baseline, "全部被拒用例之后：甲、甲二、乙的任务与步骤，丁的任务数，甲的情报、项目、相似项目、待摘要文件、通知数都与开头一致");
    ok(modelRequests.length === 0, "全部被拒用例之后：假模型服务一共收到 0 次请求", modelRequests);

    // ───────────────────────── 放行：情报接口与查看 ─────────────────────────
    console.log("情报接口与一键投标方案的查看只对与项目有关的人开放（放行）");
    {
      const r1 = await getReview(uViewer, projC.id);
      ok(r1.status === 200 && r1.body.reportStatus === "ai_generated", "只读成员调 GET …/intelligence/review → 200", r1);
      const r2 = await patchReview(uViewer, projC.id, { reportStatus: "approved" });
      ok(r2.status === 200 && r2.body.reportStatus === "approved", "只读成员调 PATCH …/intelligence/review（approved）→ 200", r2);
      const intelC = await db.projectIntelligence.findUnique({ where: { projectId: projC.id } });
      ok(intelC?.reportStatus === "approved" && intelC.reviewedBy === uViewer.name && intelC.reviewedAt instanceof Date, "PATCH 之后项目丙情报的审核状态是 approved，审核人记的是这个只读成员", intelC);

      const r3 = await regenerate(uViewer, projC.id);
      ok(r3.status === 200 && r3.body.success === true, "只读成员对没有可用文档内容的项目调 POST …/intelligence/regenerate → 200，success = true", r3);

      for (const [who, u] of [["项目负责人", uOwner], ["组织管理员（不是项目成员）", uOrgAdmin], ["平台 super_admin（不属于该组织）", uSuper]] as const) {
        const r = await getReview(u, projC.id);
        ok(r.status === 200 && r.body.reportStatus === "approved", `${who}调 GET …/intelligence/review → 200`, r);
      }
    }

    // ───────────────────────── 放行：安全视图与平台管理员全看 ─────────────────────────
    console.log("一键投标方案的步骤内幕只给平台管理员");
    type StepView = { skillId: string; status: string; success: boolean; summary: string; data: Record<string, unknown>; error: string | null; action?: string; durationMs: number | null };
    {
      for (const [who, u] of [["只读成员", uViewer], ["项目负责人", uOwner], ["组织管理员", uOrgAdmin]] as const) {
        const r = await getBidPackage(u, projC.id, taskCShow.id);
        const steps = (r.body.steps ?? []) as StepView[];
        ok(r.status === 200 && r.body.taskId === taskCShow.id && steps.length === 4, `${who}调 GET …/ai-bid-package?taskId=丙-展示 → 200，带 taskId 与 4 个步骤`, r.status);
        ok(steps.every((s) => JSON.stringify(s.data) === "{}"), `${who}：每一步的 data 都是空对象`, steps.map((s) => s.data));
        const failed = steps.find((s) => s.status === "failed");
        ok(failed?.error === SAFE_STEP_ERROR_MESSAGE, `${who}：失败那一步的 error 是「${SAFE_STEP_ERROR_MESSAGE}」`, failed);
        ok(steps.filter((s) => s.status !== "failed").every((s) => s.error === null), `${who}：没失败的步骤 error 为 null`, steps.map((s) => s.error));
        ok(!r.text.includes(PRICE_MARK) && !r.text.includes(String(PRICE_NUMBER)) && !r.text.includes("512340.11") && !r.text.includes(RAW_ERROR_MARK), `${who}：响应正文里不出现报价草稿的价格与文字，也不出现原始报错`, r.text.slice(0, 400));
        const quote = steps.find((s) => s.skillId === "quote");
        ok(r.body.status === "failed" && r.body.completedSteps === 3 && quote?.summary === "报价草稿 1 项" && quote.action === "draft" && quote.durationMs === 7000 && quote.success === true,
          `${who}：任务状态、完成数、步骤摘要、动作标签、耗时照旧`, { status: r.body.status, completedSteps: r.body.completedSteps, quote });
      }

      const rs = await getBidPackage(uSuper, projC.id, taskCShow.id);
      const steps = (rs.body.steps ?? []) as StepView[];
      const quote = steps.find((s) => s.skillId === "quote");
      const failed = steps.find((s) => s.status === "failed");
      ok(rs.status === 200 && JSON.stringify(quote?.data ?? {}).includes(PRICE_MARK) && JSON.stringify(quote?.data ?? {}).includes(String(PRICE_NUMBER)), "平台 super_admin 调同一个 GET → 200，报价草稿那一步的 data 带原来的价格", quote);
      ok(typeof failed?.error === "string" && failed.error.startsWith(RAW_ERROR_MARK), "平台 super_admin：失败那一步的 error 是原始报错", failed);
    }

    // ───────────────────────── 放行：建任务 ─────────────────────────
    console.log("一键投标方案的建任务与逐步执行只对项目管理者开放（放行）");
    {
      const r1 = await createBidPackage(uProjAdmin, projC.id);
      const created = typeof r1.body.taskId === "string" ? await db.agentTask.findUnique({ where: { id: r1.body.taskId }, include: { steps: true } }) : null;
      ok(r1.status === 200 && created?.projectId === projC.id && created.createdById === uProjAdmin.id && created.steps.length === 4 && created.status === "queued",
        "项目管理员调 POST …/ai-bid-package → 200 与新任务的 taskId（4 步、queued、发起人是他）", r1);
      for (const [who, u] of [["项目负责人", uOwner], ["组织管理员（不是项目成员）", uOrgAdmin], ["平台 super_admin（不属于该组织）", uSuper]] as const) {
        const r = await createBidPackage(u, projC.id);
        ok(r.status === 200 && typeof r.body.taskId === "string", `${who}调 POST …/ai-bid-package → 200`, r);
      }
    }

    // ───────────────────────── 放行：执行最后一步，通知，安全视图 ─────────────────────────
    console.log("项目管理员执行最后一步：响应是安全视图，库里存原文，成员收到通知");
    {
      const r = await runStep(uProjAdmin, projC.id, taskCLast.id);
      ok(r.status === 200 && r.body.success === true && r.body.done === true && r.body.skillId === "document_summary", "项目管理员对只剩最后一步的任务调 run-step → 200，success / done = true", r);
      ok(JSON.stringify(r.body.data) === "{}" && !("error" in r.body), "项目管理员（不是平台管理员）：响应 data 是空对象、不带 error", r.body);
      ok(r.body.summary === "所有文档已有摘要，无需处理" && typeof r.body.durationMs === "number" && r.body.stepIndex === 3 && r.body.title === "步骤 4", "响应里的序号、标题、摘要、耗时照旧", r.body);
      const task = await db.agentTask.findUnique({ where: { id: taskCLast.id } });
      ok(task?.status === "completed" && task.completedAt instanceof Date, "任务变为已完成", task?.status);

      const rows = await waitForNotifications(projC.id, taskCLast.id, 3);
      const recipients = new Set(rows.map((n) => n.userId));
      ok(rows.length === 3 && recipients.has(uViewer.id) && recipients.has(uOperator.id) && recipients.has(uOwner.id) && !recipients.has(uProjAdmin.id),
        "除调用者以外的项目 active 成员（只读成员、操作员）与项目负责人各收到一条通知", rows);
      ok(rows.every((n) => n.title === "AI 投标方案已生成" && n.priority === "high"), "通知是高优先级的「AI 投标方案已生成」", rows);

      const rs = await getBidPackage(uSuper, projC.id, taskCLast.id);
      const last = ((rs.body.steps ?? []) as StepView[]).find((s) => s.skillId === "document_summary");
      ok(rs.status === 200 && JSON.stringify(last?.data) === JSON.stringify({ processed: 0 }), "随后 super_admin 查看这个任务：这一步的 data 是技能的原始输出 { processed: 0 }，不是空对象", last);

      const rsr = await runStep(uSuper, projC.id, taskCLastSuper.id);
      ok(rsr.status === 200 && JSON.stringify(rsr.body.data) === JSON.stringify({ processed: 0 }), "super_admin 自己执行：响应 data 是技能的原始输出", rsr.body);
    }

    console.log("执行失败时的报错给谁看");
    {
      const r = await runStep(uProjAdmin, projC.id, taskCUnknown.id);
      ok(r.status === 200 && r.body.success === false && r.body.error === SAFE_STEP_ERROR_MESSAGE, "项目管理员执行失败的一步（未知技能）：error 是固定提示", r.body);
      ok(!r.text.includes("未知技能"), "项目管理员：响应里没有原始报错「未知技能: …」", r.body.error);
      const step = await db.agentTaskStep.findFirst({ where: { taskId: taskCUnknown.id, stepIndex: 1 } });
      ok(step?.status === "failed" && step.error === `未知技能: ${unknownSkill}`, "库里照旧写入原始报错", step);
      const rg = await getBidPackage(uSuper, projC.id, taskCUnknown.id);
      const failed = ((rg.body.steps ?? []) as StepView[]).find((s) => s.status === "failed");
      ok(failed?.error === `未知技能: ${unknownSkill}`, "super_admin 查看：失败那一步的 error 是原始报错", failed);
      const rv = await getBidPackage(uViewer, projC.id, taskCUnknown.id);
      const failedV = ((rv.body.steps ?? []) as StepView[]).find((s) => s.status === "failed");
      ok(failedV?.error === SAFE_STEP_ERROR_MESSAGE && !rv.text.includes("未知技能"), "只读成员查看：失败那一步的 error 是固定提示", failedV);
      const rs = await runStep(uSuper, projC.id, taskCUnknownSuper.id);
      ok(rs.status === 200 && rs.body.success === false && rs.body.error === `未知技能: ${unknownSkill}`, "super_admin 执行失败的一步：error 是原始报错", rs.body);
    }

    ok(modelRequests.length === 0, "整个测试假模型服务一共收到 0 次请求", modelRequests);
  } finally {
    // ───────────────────────── 清理 ─────────────────────────
    const orgIds = [orgA.id, orgB.id];
    const userIds = allUsers.map((u) => u.id);
    const quiet = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        console.log(`  （清理 ${label} 失败，留在隔离库里：${e instanceof Error ? e.message.split("\n")[0] : String(e)}）`);
      }
    };
    await sleep(300); // 等不 await 的通知写完再删
    await quiet("notification", () => db.notification.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] } }));
    await quiet("agentTask", () => db.agentTask.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectSimilarity", () => db.projectSimilarity.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { similarProjectId: { in: projectIds } }] } }));
    await quiet("projectIntelligence", () => db.projectIntelligence.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectDocument", () => db.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectMember", () => db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("project", () => db.project.deleteMany({ where: { id: { in: projectIds } } }));
    await quiet("organizationMember", () => db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } }));
    await quiet("organization", () => db.organization.deleteMany({ where: { id: { in: orgIds } } }));
    await quiet("user", () => db.user.deleteMany({ where: { id: { in: userIds } } }));
    await db.$disconnect();
    server.close();
  }

  console.log(`\nFIX-21 project intel / bid package access (DB + HTTP): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
