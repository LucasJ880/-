/**
 * TREE-2 情报调研树：发起接口与发起服务（真实 DB，隔离库；直接调路由导出的处理函数，带会话 cookie）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-research-tree/__tests__/research-tree-start-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；不调模型、不发外部请求（只建 Job，不处理）。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 TREE-2 发起接口 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "TREE-2 research tree start DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { seedWorkforceFixture, cleanupWorkforceFixture } = await import("@/lib/workforce-runtime/__tests__/helpers");
  const route = await import("@/app/api/projects/[id]/research-tree/route");

  console.log("TREE-2 research tree start — isolated DB");
  const fx = await seedWorkforceFixture("rt");
  const ORG = fx.orgId;
  const WRITER = await db.user.findUniqueOrThrow({ where: { id: fx.approverUserId } }); // org_admin
  const READER = await db.user.findUniqueOrThrow({ where: { id: fx.ownerUserId } }); // 组织成员 + 项目成员（只读）
  process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST = `${process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST},${WRITER.id}`;
  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(workDomain = "tender") {
    seq += 1;
    const p = await db.project.create({
      data: { name: `Fixture Bins ${fx.tag}-${seq}`, orgId: ORG, ownerId: WRITER.id, workDomain, intakeStatus: "dispatched", estimatedValue: 987654, clientOrganization: "City of Example" },
      select: { id: true },
    });
    projectIds.push(p.id);
    await db.projectMember.create({ data: { projectId: p.id, userId: READER.id, role: "viewer", status: "active" } }).catch(() => undefined);
    return p.id;
  }
  const cookieFor = async (u: { id: string; email: string; role: string }) => `qy_session=${await createSession({ sub: u.id, email: u.email, role: u.role })}`;
  async function post(user: typeof WRITER, projectId: string, body: unknown = { action: "start" }, raw?: string) {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/research-tree`, {
      method: "POST",
      headers: { cookie: await cookieFor(user), "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    });
    const res = await route.POST(req, { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    return { status: res.status, body: json };
  }
  const researchJobs = (projectId: string) =>
    db.agentRun.findMany({
      where: { orgId: ORG, AND: [{ metadata: { path: ["researchTree"], equals: true } }, { metadata: { path: ["researchProjectId"], equals: projectId } }] },
      select: { id: true, status: true, metadata: true },
    });

  try {
    /* ── 开关关 ── */
    delete process.env.TENDER_RESEARCH_TREE_ENABLED;
    process.env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST = "";
    const p1 = await mkProject();
    const off = await post(WRITER, p1);
    ok(off.status === 404 && (await researchJobs(p1)).length === 0, "开关关：404，不建 Job", off);
    process.env.TENDER_RESEARCH_TREE_ENABLED = "1";
    process.env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST = "some-other-org";
    const notListed = await post(WRITER, p1);
    ok(notListed.status === 404 && (await researchJobs(p1)).length === 0, "组织不在名单里：404，不建 Job", notListed);
    process.env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST = ORG;

    /* ── 权限 ── */
    const ro = await post(READER, p1);
    ok(ro.status === 403 && (await researchJobs(p1)).length === 0, "只有读权限：403，不建 Job", ro);

    /* ── 发起 ── */
    const s1 = await post(WRITER, p1);
    const jobs1 = await researchJobs(p1);
    ok(s1.status === 200 && typeof s1.body.jobId === "string" && s1.body.reused === false && jobs1.length === 1, "有写权限：建出一条调研 Job", s1);
    const job = jobs1[0]!;
    const meta = job.metadata as Record<string, unknown>;
    ok(
      meta.researchTree === true && meta.researchTreeVersion === 1 && meta.researchTrigger === "human_start" && meta.researchProjectId === p1 && meta.workDomain === "tender" && meta.initiatedByUserId === WRITER.id,
      "调研标记平铺、所属项目放 researchProjectId、发起人是点按钮的人",
      meta,
    );
    ok(meta.projectId === undefined || meta.projectId === null, "不设 metadata.projectId（一键分析认不出它）", meta.projectId);
    ok(typeof meta.goal === "string" && !String(meta.goal).includes("Fixture Bins") && !JSON.stringify(meta).includes("987654") && !JSON.stringify(meta).includes("City of Example"), "标题与元数据里没有项目名、采购方与金额", meta.goal);
    const steps = await db.agentRunStep.findMany({ where: { runId: job.id }, orderBy: { createdAt: "asc" }, select: { stepKey: true, title: true } });
    ok(steps.length === 6 && steps.map((s) => s.stepKey).join(",") === "research_clauses,research_prior_awards,research_similar,research_wave2_full,research_wave2_relaxed,research_trunk", "六步计划已落库", steps.map((s) => s.stepKey));
    ok(steps.every((s) => !s.title.includes("Fixture Bins")), "步骤标题里没有项目名");
    ok(meta.plannerLlmCalls === 0, "规划模型调用为 0", meta.plannerLlmCalls);

    const s2 = await post(WRITER, p1);
    ok(s2.status === 200 && s2.body.jobId === s1.body.jobId && s2.body.reused === true && s2.body.status === "queued" && (await researchJobs(p1)).length === 1, "再点一次：复用那条（带上它的状态），不另建", s2);

    /* ── 一键分析看不到调研 Job ── */
    const { getTenderWorkforceAnalysisStatus } = await import("@/lib/tender-workforce/trigger-service");
    process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "1";
    const analysis = await getTenderWorkforceAnalysisStatus({ orgId: ORG, projectId: p1 });
    ok(!JSON.stringify(analysis ?? {}).includes(String(s1.body.jobId)), "项目的 AI 分析卡片状态里没有这条调研 Job", analysis);

    /* ── 并发双击 ── */
    const p2 = await mkProject();
    const [c1, c2] = await Promise.all([post(WRITER, p2), post(WRITER, p2)]);
    const jobs2 = await researchJobs(p2);
    ok(c1.status === 200 && c2.status === 200 && c1.body.jobId === c2.body.jobId && jobs2.length === 1, "并发双击：只建一条，两次返回同一个 jobId", { c1, c2, n: jobs2.length });

    /* ── requestId 重放、结束后再发起 ── */
    const p3 = await mkProject();
    const r1 = await post(WRITER, p3, { action: "start", requestId: "req-1" });
    await db.agentRun.update({ where: { id: String(r1.body.jobId) }, data: { status: "completed" } });
    ok(r1.body.status === "queued", "新建的那条状态是排队中", r1.body);
    const r2 = await post(WRITER, p3, { action: "start", requestId: "req-1" });
    ok(r2.body.jobId === r1.body.jobId && r2.body.reused === true, "同一个 requestId 重放：返回同一条", r2);
    const r3 = await post(WRITER, p3, { action: "start" });
    ok(r3.status === 200 && r3.body.jobId !== r1.body.jobId && r3.body.reused === false && (await researchJobs(p3)).length === 2, "上一棵树结束了：再发起建新的一条", r3);

    /* ── 停在「需要人工处理」的树不挡住新的一棵 ── */
    const p5 = await mkProject();
    const n1 = await post(WRITER, p5);
    await db.agentRun.update({ where: { id: String(n1.body.jobId) }, data: { status: "needs_human" } });
    const n2 = await post(WRITER, p5);
    ok(n2.status === 200 && n2.body.jobId !== n1.body.jobId && n2.body.reused === false, "上一棵停在「需要人工处理」：再发起建新的一条", n2);

    /* ── 请求体 ── */
    const p6 = await mkProject();
    const empty = await post(WRITER, p6, undefined, "");
    ok(empty.status === 200 && typeof empty.body.jobId === "string", "请求体为空：按开始调研处理", empty);
    const noAction = await post(WRITER, p6, {});
    ok(noAction.status === 200 && noAction.body.jobId === empty.body.jobId && noAction.body.reused === true, "省略 action：按开始调研处理（复用在查的那条）", noAction);
    const bad = await post(WRITER, p3, undefined, "{not json");
    ok(bad.status === 400, "请求体坏了：400", bad);
    const arr = await post(WRITER, p3, undefined, "[1,2]");
    ok(arr.status === 400, "请求体不是对象：400", arr);
    const unk = await post(WRITER, p3, { action: "cancel" });
    ok(unk.status === 400 && unk.body.error === "不支持的操作", "不认识的 action：400「不支持的操作」", unk);
    const num = await post(WRITER, p3, { action: 1 });
    ok(num.status === 400, "action 不是字符串：400", num);
    const p4 = await mkProject("sales");
    const sales = await post(WRITER, p4);
    ok(sales.status === 409 && (await researchJobs(p4)).length === 0, "不是招投标项目：409，不建 Job", sales);

    /* ── 发起服务：只收人发起的方式 ── */
    const { startResearchTree } = await import("../start");
    const sched = await startResearchTree({ orgId: ORG, projectId: p4, userId: WRITER.id, trigger: "scheduled" as never });
    ok(!sched.ok && sched.code === "INVALID_TRIGGER", "发起方式不是人发起的几种：拒绝", sched);
  } finally {
    await db.agentRun.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
    await cleanupWorkforceFixture(fx);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
