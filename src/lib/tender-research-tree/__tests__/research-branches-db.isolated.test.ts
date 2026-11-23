/**
 * TREE-3 三个子代理：真实 DB（隔离库）——条款员经生产库读真页表、授标支读数量与合同期、读取接口的守卫与 404、
 * 接口只给条款结果、条款员只记游标不写别的。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-research-tree/__tests__/research-branches-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；模型是假的，不发任何外部请求。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 TREE-3 三个子代理 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "TREE-3 research branches DB test" });

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
  const { startResearchTree } = await import("@/lib/tender-research-tree/start");
  const { runResearchBranch } = await import("@/lib/tender-research-tree/branch-run");
  const { productionStore } = await import("@/lib/tender-research-tree/deps");
  const { RESEARCH_STEP_IDS } = await import("@/lib/tender-research-tree/fork-rules");

  console.log("TREE-3 research branches — isolated DB");
  const fx = await seedWorkforceFixture("rb");
  const ORG = fx.orgId;
  const WRITER = await db.user.findUniqueOrThrow({ where: { id: fx.approverUserId } });
  const READER = await db.user.findUniqueOrThrow({ where: { id: fx.ownerUserId } });
  process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST = `${process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST},${WRITER.id}`;
  const OUTSIDER = await db.user.create({ data: { email: `outsider-${fx.tag}@example.test`, name: "Outsider", passwordHash: "x", role: "user" } });
  const projectIds: string[] = [];

  const cookieFor = async (u: { id: string; email: string; role: string }) => `qy_session=${await createSession({ sub: u.id, email: u.email, role: u.role })}`;
  async function get(user: { id: string; email: string; role: string }, projectId: string) {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/research-tree`, { method: "GET", headers: { cookie: await cookieFor(user) } });
    const res = await route.GET(req, { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    return { status: res.status, body: json, text };
  }
  async function snapshot(): Promise<Record<string, string>> {
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const out: Record<string, string> = {};
    for (const { table_name } of tables) {
      const r = await db.$queryRawUnsafe<Array<{ n: bigint; h: string }>>(
        `SELECT count(*)::bigint AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${table_name.replace(/"/g, "")}" t`,
      );
      out[table_name] = `${r[0]!.n}:${r[0]!.h}`;
    }
    return out;
  }
  const changedTables = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).sort();

  try {
    const p = await db.project.create({
      data: { name: `Office Chairs ${fx.tag}`, orgId: ORG, ownerId: WRITER.id, workDomain: "tender", intakeStatus: "dispatched", estimatedValue: 987654, clientOrganization: "Treasury Board of Canada Secretariat" },
      select: { id: true },
    });
    projectIds.push(p.id);
    await db.projectMember.create({ data: { projectId: p.id, userId: READER.id, role: "viewer", status: "active" } }).catch(() => undefined);
    const filler = "General terms and conditions apply to this solicitation. ".repeat(12);
    const doc = await db.projectDocument.create({
      data: { projectId: p.id, title: "RFP-24062-27-057.pdf", url: "https://blob.example.test/rfp.pdf", fileType: "pdf", source: "upload", parseStatus: "done", pageCount: 7, contentText: filler, uploadedById: WRITER.id },
      select: { id: true },
    });
    const pageTexts: Array<[number, string]> = [
      [1, filler],
      [7, `${filler} 7.3 Equivalent Products. Equivalent products will be considered provided that product data sheets are submitted with the bid. ${filler}`],
    ];
    for (const [n, t] of pageTexts) {
      await db.projectDocumentPage.create({ data: { documentId: doc.id, pageNumber: n, contentText: t, charCount: t.length, extractionMethod: "unpdf", parseStatus: "done", unitKind: "page" } });
    }
    await db.tenderAnalysisRun.create({
      data: {
        orgId: ORG,
        projectId: p.id,
        status: "REVIEW_REQUIRED",
        idempotencyKey: `tree3-${fx.tag}`,
        sourceHashFingerprint: "fx",
        summaryJson: { criticalFacts: { quantity: { status: "KNOWN", text: "20,000 office chairs" }, contract_duration: { status: "KNOWN", text: "1095 days from award" } } },
      },
    });

    /* ── 生产库的两个读取 ── */
    const tp = await productionStore.loadTenderPages(p.id);
    ok(tp.documentCount === 1 && tp.pages.some((x) => x.pageNumber === 7 && x.text.includes("Equivalent products will be considered") && x.documentTitle === "RFP-24062-27-057.pdf"), "读真页表：第 7 页的条款在", tp.pages.map((x) => x.pageNumber));
    const rf = await productionStore.loadRequirementFacts(p.id);
    ok(rf.quantity === 20000 && rf.contractDays === 1095, "读最新可用分析的数量与合同期", rf);

    /* ── 读取接口：开关关 ── */
    delete process.env.TENDER_RESEARCH_TREE_ENABLED;
    process.env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST = "";
    const off = await get(WRITER, p.id);
    ok(off.status === 404 && off.body.error === "未找到", "开关关：读取 404", off);
    const offOutsider = await get(OUTSIDER, p.id);
    ok(offOutsider.status === 403 && offOutsider.body.error === "无权查看该项目", "开关关 + 不是项目成员：守卫先判，得到守卫的 403（不是 404）", offOutsider);
    process.env.TENDER_RESEARCH_TREE_ENABLED = "1";
    process.env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST = ORG;
    const outsider = await get(OUTSIDER, p.id);
    ok(outsider.status === 403 && outsider.body.error === "无权查看该项目" && !("clauses" in outsider.body), "不是项目成员：原样得到守卫的 403", outsider);
    const empty = await get(READER, p.id);
    ok(empty.status === 200 && empty.body.job === null && empty.body.clauses === null, "项目读者、还没有调研树：job 与 clauses 都是 null", empty.body);

    /* ── 发起一棵树（只建 Job），读取：在查 ── */
    const started = await startResearchTree({ orgId: ORG, projectId: p.id, userId: WRITER.id, role: WRITER.role, trigger: "human_start" });
    ok(started.ok, "发起", started);
    const jobId = started.ok ? started.jobId : "";
    const pending = await get(READER, p.id);
    ok(pending.status === 200 && (pending.body.job as { id: string }).id === jobId && (pending.body.clauses as { state: string }).state === "pending", "在查：条款员还没交单", pending.body);

    /* ── 条款员经生产库跑一次（假模型），只记游标 ── */
    const before = await snapshot();
    const ctx = {
      orgId: ORG,
      userId: WRITER.id,
      role: "admin",
      runId: jobId,
      stepKey: RESEARCH_STEP_IDS.clauses,
      operationKey: "op:clauses",
      priorEvidence: {},
      runFence: { runId: jobId, check: async () => true, guard: async <T,>(fn: (c: unknown) => Promise<T>) => fn(db) },
      executionBudget: { deadlineAt: Date.now() + 240_000, tickBudgetMs: 240_000 },
    };
    const prompts: string[] = [];
    const r = await runResearchBranch(ctx as never, {
      store: productionStore,
      external: {
        now: () => Date.now(),
        env: process.env,
        search: async () => {
          throw new Error("条款员不该搜索");
        },
        openData: async () => {
          throw new Error("条款员不该查联邦数据");
        },
        invokerFor: () => async (req) => {
          prompts.push(req.userPrompt);
          const sid = /\[(S\d+)\]/.exec(req.userPrompt)?.[1] ?? "S1";
          return {
            content: JSON.stringify({
              local_content: { answer: "not_stated", citations: [] },
              brand: { answer: "not_stated", citations: [] },
              equivalents: { answer: "accepted", citations: [{ snippet: sid, excerpt: "Equivalent products will be considered" }], proof: null },
            }),
            model: "fake-model",
            elapsedMs: 1,
          };
        },
        openReadSession: async () => {
          throw new Error("条款员不该读网页");
        },
        readPage: async () => {
          throw new Error("条款员不该读网页");
        },
      },
    });
    const after = await snapshot();
    ok(r.ok && prompts.length === 1, "条款员跑完、请求一次模型", r);
    ok(JSON.stringify(changedTables(before, after)) === JSON.stringify(["AuditLog"]), "整库只多了审计（游标）：文件、页、分析记录与要求都不变", changedTables(before, after));
    const cursor = await db.auditLog.findMany({ where: { orgId: ORG, action: "research.branch_step", targetId: jobId }, select: { afterData: true } });
    ok(cursor.length === 3 && !JSON.stringify(cursor).includes("General terms and conditions"), "三条游标，没有标书正文", cursor.length);

    /* ── 读取：查完（把结果照运行时的写法放进步骤输出） ── */
    await db.agentRunStep.update({ where: { runId_stepKey: { runId: jobId, stepKey: RESEARCH_STEP_IDS.clauses } }, data: { status: "completed", outputJson: (r as { data: object }).data as never } });
    const done = await get(READER, p.id);
    const cl = done.body.clauses as { state: string; statusZh: string; findings: { questions: Array<{ key: string; answerZh: string; citations: Array<{ pageLabelZh: string; documentTitle: string }> }> } };
    const eq = cl.findings.questions.find((q) => q.key === "equivalents")!;
    ok(done.status === 200 && cl.state === "done" && cl.statusZh === "写明了 1 项" && eq.answerZh === "接受等效品" && eq.citations[0]?.pageLabelZh === "第 7 页", "读到条款结果：接受等效品、第 7 页", cl);
    ok(!/https?:\/\/|987654|230,000/.test(done.text), "读取接口不给网址与金额", done.text.slice(0, 300));
    const offAgain = (process.env.TENDER_RESEARCH_TREE_ENABLED = "0", await get(READER, p.id));
    ok(offAgain.status === 404, "再关开关：读取又是 404");
    process.env.TENDER_RESEARCH_TREE_ENABLED = "1";

    /* ── Job 停下、条款没交单：读取说「停下了」，不说在查 ── */
    const p2 = await db.project.create({
      data: { name: `Office Chairs B ${fx.tag}`, orgId: ORG, ownerId: WRITER.id, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: "Treasury Board of Canada Secretariat" },
      select: { id: true },
    });
    projectIds.push(p2.id);
    await db.projectMember.create({ data: { projectId: p2.id, userId: READER.id, role: "viewer", status: "active" } }).catch(() => undefined);
    const s2 = await startResearchTree({ orgId: ORG, projectId: p2.id, userId: WRITER.id, role: WRITER.role, trigger: "human_start" });
    const job2 = s2.ok ? s2.jobId : "";
    await db.agentRun.update({ where: { id: job2 }, data: { status: "cancelled" } });
    const stopped = await get(READER, p2.id);
    ok(stopped.status === 200 && (stopped.body.clauses as { state: string }).state === "stopped", "Job 取消、条款没交单：停下了", stopped.body);
  } finally {
    for (const id of projectIds) {
      await db.agentRun.deleteMany({ where: { orgId: ORG, AND: [{ metadata: { path: ["researchProjectId"], equals: id } }] } }).catch(() => undefined);
      await db.project.delete({ where: { id } }).catch(() => undefined);
    }
    await db.auditLog.deleteMany({ where: { orgId: ORG, action: "research.branch_step" } }).catch(() => undefined);
    await db.user.delete({ where: { id: OUTSIDER.id } }).catch(() => undefined);
    await cleanupWorkforceFixture(fx).catch(() => undefined);
  }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
