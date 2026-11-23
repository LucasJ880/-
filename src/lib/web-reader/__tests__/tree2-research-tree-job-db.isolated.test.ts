/**
 * TREE-2 情报调研树：整棵树经任务运行时与处理器跑完（真实 DB，隔离库；搜索 / 模型 / 网络是假的，
 * 读页层是 TREE-1 的真实实现 + 假网络，游标、读页审计、情报室都写真库）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-research-tree/__tests__/research-tree-job-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；不发任何外部请求、不调真实模型。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 TREE-2 整棵树 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "TREE-2 research tree job DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : "");
  }
}

const A = "https://www.example-city.ca/awards/2023-bins";
const S1 = "https://procurement.example-region.ca/awards/bins-2024";
const R1 = "https://bids.example-county.gov/award-results/containers";
// TREE-3：同类授标由同一组的合同额、数量、年份组成（代码组装成记录、算单价），不再有「同类授标」这一事实类型
const PAGES: Record<string, { html: string; facts: Array<{ factType: string; value: string; excerpt: string; group?: string }> }> = {
  [A]: {
    html: "<html><body><p>The City of Example awarded contract RFT-2023-044 to Acme Bins Ltd. Total value: $230,000.00 for 10,000 waste bins.</p></body></html>",
    facts: [
      { factType: "winner", value: "Acme Bins Ltd", excerpt: "awarded contract RFT-2023-044 to Acme Bins Ltd." },
      { factType: "award_amount", value: "$230,000.00", excerpt: "Total value: $230,000.00 for 10,000 waste bins." },
    ],
  },
  [S1]: {
    html: "<html><body><p>Region of Example: 8,000 waste bins awarded for $200,000 in 2024.</p></body></html>",
    facts: [
      { factType: "quantity", value: "8,000", excerpt: "Region of Example: 8,000 waste bins awarded for $200,000 in 2024.", group: "s1" },
      { factType: "award_amount", value: "$200,000", excerpt: "Region of Example: 8,000 waste bins awarded for $200,000 in 2024.", group: "s1" },
      { factType: "award_year", value: "2024", excerpt: "Region of Example: 8,000 waste bins awarded for $200,000 in 2024.", group: "s1" },
    ],
  },
  [R1]: {
    html: "<html><body><p>County award: 12,500 refuse containers, $262,500 (2022).</p><p>Second award: 4,000 carts, $96,000 (2021).</p></body></html>",
    facts: [
      { factType: "quantity", value: "12,500", excerpt: "County award: 12,500 refuse containers, $262,500 (2022).", group: "r1" },
      { factType: "award_amount", value: "$262,500", excerpt: "County award: 12,500 refuse containers, $262,500 (2022).", group: "r1" },
      { factType: "quantity", value: "4,000", excerpt: "Second award: 4,000 carts, $96,000 (2021).", group: "r2" },
      { factType: "award_amount", value: "$96,000", excerpt: "Second award: 4,000 carts, $96,000 (2021).", group: "r2" },
    ],
  },
};

function branchTag(systemPrompt: string): string {
  if (systemPrompt.includes("同一个采购方")) return "prior";
  if (systemPrompt.includes("放宽")) return "relaxed";
  if (systemPrompt.includes("往期同标没查到")) return "full";
  return "similar";
}

async function main() {
  const { db } = await import("@/lib/db");
  const { seedWorkforceFixture, cleanupWorkforceFixture } = await import("@/lib/workforce-runtime/__tests__/helpers");
  const { processWorkforceJobSlice } = await import("@/lib/workforce-runtime/processor");
  const { onWorkforceJobStopped } = await import("@/lib/workforce-runtime/domain-hooks");
  const { claimRunLease } = await import("@/lib/agent-runtime/lease");
  const { WORKFORCE_JOB_RUN_TYPE, WORKFORCE_ACTIVE_STATUSES } = await import("@/lib/workforce-runtime/constants");
  const { createResearchReadSessionWithDeps } = await import("../read-page");
  const { loadResearchJobRow, loadOrgSettingsJson, loadTreeHistory, writeWebReadAudit } = await import("../db-deps");
  const { readPublicPage } = await import("@/lib/web-reader");
  const { makeWorld, html } = await import("./fake-world");
  const { __setResearchTreeDepsForTest } = await import("@/lib/tender-research-tree/deps");
  const { startResearchTree } = await import("@/lib/tender-research-tree/start");

  console.log("TREE-2 research tree job — isolated DB");
  const fx = await seedWorkforceFixture("rj");
  const ORG = fx.orgId;
  const USER = fx.approverUserId; // org_admin
  process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST = `${process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST},${USER}`;
  process.env.TENDER_RESEARCH_TREE_ENABLED = "1";
  process.env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST = ORG;
  process.env.TENDER_EXTERNAL_INTEL_ENABLED = "1";
  process.env.TAVILY_API_KEY = "test-key-not-real";

  const world = makeWorld();
  for (const [u, p] of Object.entries(PAGES)) world.handlers.set(u, () => html(p.html));
  const searches: string[] = [];
  const modelCalls: Array<{ tag: string }> = [];
  const openDataQueries: string[] = [];
  let failTag: string | null = null;
  __setResearchTreeDepsForTest({
    // TREE-3：往期同标先查联邦合同公开数据（假的：没有结果；测试里一律不发真实请求）
    openData: async (q) => {
      openDataQueries.push(q);
      return { ok: true, rows: [], note: null };
    },
    search: async (q) => {
      searches.push(q);
      const url = q.startsWith("prior") ? A : q.startsWith("relaxed") ? R1 : q.startsWith("similar") ? S1 : null;
      return url ? { status: "SUCCESS", httpStatus: 200, hits: [{ title: "award", url, snippet: "award" }] } : { status: "EMPTY", httpStatus: 200, hits: [] };
    },
    invokerFor: () => async (req) => {
      const tag = branchTag(req.systemPrompt);
      modelCalls.push({ tag });
      if (failTag === tag) throw new Error("model down");
      const latest = req.userPrompt.split("【本轮结果】")[1] ?? "";
      let decision: unknown;
      const pageUrl = /读到的网页：(\S+)/.exec(latest)?.[1]?.replace(/（.*$/, "");
      const hit = /^\d+\. (\S+)/m.exec(latest)?.[1];
      if (pageUrl && PAGES[pageUrl]) decision = { facts: PAGES[pageUrl]!.facts, next: { action: "finish" } };
      else if (hit) decision = { next: { action: "read", url: hit } };
      else if (latest.includes("这是第一轮") || latest.includes("联邦合同公开数据")) decision = { next: { action: "search", query: `${tag} waste bins contract award` } };
      else decision = { next: { action: "finish" } };
      return { content: JSON.stringify(decision), model: "fake-model", elapsedMs: 1 };
    },
    openReadSession: (input) =>
      createResearchReadSessionWithDeps(input, {
        loadJob: loadResearchJobRow,
        loadOrgSettings: loadOrgSettingsJson,
        loadTreeHistory,
        reader: { net: world.net, clock: world.clock, audit: writeWebReadAudit },
      }),
    readPage: (url, c) => readPublicPage(url, c),
  });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(withRoom = true) {
    seq += 1;
    const p = await db.project.create({
      data: { name: `Fixture Bins ${fx.tag}-${seq}`, orgId: ORG, ownerId: USER, workDomain: "tender", intakeStatus: "dispatched", estimatedValue: 987654, clientOrganization: "City of Example" },
      select: { id: true },
    });
    projectIds.push(p.id);
    if (withRoom) await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: p.id, summaryJson: { otherFeature: { keep: true } } } });
    return p.id;
  }
  /** 整库快照：每张表的行数与内容哈希（能抓到插入，也能抓到改动） */
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
  /** 运行时自己的表（Job、步骤、事件、验证、会话、配额预留） */
  const RUNTIME_TABLES = ["AgentRun", "AgentRunEvent", "AgentRunStep", "AgentRunVerification", "AgentSession", "CapabilityQuotaReservation"];
  async function runToEnd(jobId: string, maxSlices = 40) {
    for (let i = 0; i < maxSlices; i++) {
      const row = await db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } });
      if (!(["queued", ...WORKFORCE_ACTIVE_STATUSES] as string[]).includes(row.status)) return row.status;
      await db.agentRun.update({ where: { id: jobId }, data: { nextAttemptAt: new Date(Date.now() - 1_000), leaseExpiresAt: null } });
      await processWorkforceJobSlice(jobId, { executionBudget: { deadlineAt: Date.now() + 240_000, tickBudgetMs: 240_000 } });
    }
    return (await db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } })).status;
  }
  const stepOutputs = async (jobId: string) =>
    Object.fromEntries(
      (await db.agentRunStep.findMany({ where: { runId: jobId }, select: { stepKey: true, status: true, outputJson: true } })).map((s) => [s.stepKey, s]),
    ) as Record<string, { stepKey: string; status: string; outputJson: unknown }>;
  const handoff = (o: unknown) => ((o as Record<string, unknown> | null)?.researchHandoff ?? null) as { status: string; found: unknown[]; usage: { modelCalls: number; searches: number; reads: number } } | null;

  try {
    /* ── 整棵树跑完 ── */
    console.log("\n[整棵树经处理器跑完]");
    const p1 = await mkProject();
    const auditBefore = await db.auditLog.count();
    const before = await snapshot();
    const started = await startResearchTree({ orgId: ORG, projectId: p1, userId: USER, role: "admin", trigger: "human_start" });
    ok(started.ok, "发起", started);
    const jobId = started.ok ? started.jobId : "";
    const finalStatus = await runToEnd(jobId);
    ok(finalStatus === "completed", "调研 Job 完成", finalStatus);
    const steps = await stepOutputs(jobId);
    ok(Object.values(steps).length === 6 && Object.values(steps).every((s) => s.status === "completed"), "六步都完成", Object.values(steps).map((s) => `${s.stepKey}:${s.status}`));
    const ho = (k: string) => handoff(steps[k]?.outputJson);
    ok(ho("research_clauses")?.status === "unavailable", "① 条款交「未接通」");
    ok(ho("research_prior_awards")?.status === "found" && ho("research_prior_awards")!.found.length === 2, "② 往期同标查到 2 条", ho("research_prior_awards"));
    ok(ho("research_similar")?.status === "found" && (ho("research_similar")!.records ?? []).length === 1 && ho("research_similar")!.records![0]!.unitPrice === "25.00", "③ 同类项目（限量）查到 1 条（单价 25.00）", ho("research_similar")?.records);
    ok(ho("research_wave2_full")?.status === "not_needed", "② 查到了：第二波甲无需追查");
    ok(
      ho("research_wave2_relaxed")?.status === "found" && (ho("research_wave2_relaxed")!.records ?? []).map((r) => r.unitPrice).join(",") === "21.00,24.00",
      "③ 只有 1 条能算单价：第二波乙放宽后查到 2 条（单价 21.00、24.00）",
      ho("research_wave2_relaxed"),
    );
    ok(openDataQueries.length > 0 && (ho("research_prior_awards")?.usage.searches ?? 0) === 1 + openDataQueries.length, "往期同标先查了联邦数据（假的），每次算一次搜索", { q: openDataQueries, u: ho("research_prior_awards")?.usage });
    const sumCalls = ["research_prior_awards", "research_similar", "research_wave2_relaxed"].reduce((n, k) => n + (ho(k)?.usage.modelCalls ?? 0), 0);
    ok(modelCalls.length === sumCalls && modelCalls.length === 9, "模型请求只来自分支循环（3 支 × 3 轮），运行时自己没有调模型", { calls: modelCalls.length, sumCalls });
    ok(searches.length === 3, "搜索 3 次", searches);
    const room = await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId: p1 }, select: { summaryJson: true } });
    const sj = room.summaryJson as Record<string, unknown>;
    const tree = sj.researchTree as { jobId: string; branches: Array<{ key: string; status: string; foundCount: number }>; pendingReverse: string[]; usage: { modelCalls: number } };
    ok(tree?.jobId === jobId && tree.branches.length === 5, "树干写进情报室 summaryJson.researchTree", tree);
    ok(JSON.stringify(tree.pendingReverse) === JSON.stringify(["Acme Bins Ltd"]) && tree.usage.modelCalls === 9, "待反查与全树用量");
    ok((sj.otherFeature as { keep?: boolean })?.keep === true, "情报室里别的功能的键原样保留");
    ok(!/https?:|230,000|\$|Total value|awarded contract/.test(JSON.stringify(tree)), "摘要里没有网址、金额与摘录", JSON.stringify(tree).slice(0, 300));
    const branchRows = await db.auditLog.count({ where: { orgId: ORG, action: "research.branch_step", targetId: jobId } });
    const readRows = await db.auditLog.count({ where: { orgId: ORG, action: "research.web_read", targetId: jobId } });
    ok(branchRows > 0 && readRows === 3, "游标审计与读页审计都写在这条调研 Job 下", { branchRows, readRows });
    const after = await snapshot();
    const changed = changedTables(before, after);
    const allowed = new Set([...RUNTIME_TABLES, "AuditLog", "BidIntelligenceRoom"]);
    ok(changed.every((t) => allowed.has(t)), "零出站：整库只有运行时自己的表、审计与情报室有变化（待批卡、通知、邮件、授标记录、供应商、询价、报价、项目都不变）", changed);
    const newAudits = await db.auditLog.findMany({ orderBy: { createdAt: "asc" }, skip: auditBefore, select: { action: true } });
    ok(newAudits.every((a) => /^research\.(branch_step|web_read)$|^QUOTA_/.test(a.action)), "新增的审计只有调研游标、读页与运行时配额记账", [...new Set(newAudits.map((a) => a.action))]);
    const planJson = (await db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { planJson: true } })).planJson as { completionCriteria?: Array<{ verificationType: string; evidenceStepIds?: string[] }> };
    ok(
      (planJson.completionCriteria ?? []).length > 0 && (planJson.completionCriteria ?? []).every((c) => c.verificationType === "tool_result" && (c.evidenceStepIds ?? []).length > 0),
      "落库的计划：完成条件全是工具结果（验证器不调模型）",
      planJson.completionCriteria,
    );
    const runMeta = (await db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { metadata: true } })).metadata as Record<string, unknown>;
    ok(runMeta.plannerLlmCalls === 0 || runMeta.plannerLlmCalls === undefined, "规划模型调用为 0");

    /* ── 一支模型不可用 ── */
    console.log("\n[一支出问题不连累别的支]");
    const p2 = await mkProject();
    failTag = "prior";
    const s2 = await startResearchTree({ orgId: ORG, projectId: p2, userId: USER, role: "admin", trigger: "human_start" });
    const job2 = s2.ok ? s2.jobId : "";
    const st2 = await runToEnd(job2);
    failTag = null;
    const steps2 = await stepOutputs(job2);
    const h2 = (k: string) => handoff(steps2[k]?.outputJson);
    ok(st2 === "completed", "Job 照样完成", st2);
    ok(h2("research_prior_awards")?.status === "unavailable", "② 模型不可用：交「未接通」", h2("research_prior_awards"));
    ok(
      h2("research_similar")?.status === "found" && h2("research_wave2_full")?.status !== "not_needed" && (h2("research_wave2_full")?.usage.modelCalls ?? 0) > 0,
      "③ 照常；② 没查到 → 第二波甲跑了（假搜索对它没有结果）",
      { s: h2("research_similar")?.status, f: h2("research_wave2_full") },
    );
    const tree2 = ((await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId: p2 } })).summaryJson as Record<string, unknown>).researchTree as { branches: unknown[] };
    ok(tree2?.branches?.length === 5, "树干照常汇总");

    /* ── 没有情报室：不新建 ── */
    const p3 = await mkProject(false);
    const s3 = await startResearchTree({ orgId: ORG, projectId: p3, userId: USER, role: "admin", trigger: "human_start" });
    const st3 = await runToEnd(s3.ok ? s3.jobId : "");
    const trunk3 = (await stepOutputs(s3.ok ? s3.jobId : ""))["research_trunk"]?.outputJson as { researchTrunk?: { roomWritten: boolean } };
    ok(st3 === "completed" && trunk3?.researchTrunk?.roomWritten === false && (await db.bidIntelligenceRoom.count({ where: { projectId: p3 } })) === 0, "项目没有情报室：不新建，结果写明没写入", trunk3);

    /* ── 调研 Job 失败不标「AI 分析未完成」 ── */
    console.log("\n[调研 Job 失败：一键分析的收尾什么都不做]");
    const p4 = await mkProject();
    const { buildWorkforceTenderIdempotencyKey, TENDER_WORKFORCE_ANALYSIS_VERSION } = await import("@/lib/tender-workforce/analysis-run-service");
    // 这个项目有一条正在「AI 数字员工分析中」的分析记录（另一条分析 Job 的）
    const analysisRun = await db.tenderAnalysisRun.create({
      data: {
        orgId: ORG,
        projectId: p4,
        status: "AGENT_ANALYZING",
        analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        idempotencyKey: buildWorkforceTenderIdempotencyKey(`analysis-job-${fx.tag}`),
        sourceHashFingerprint: "fixture",
        createdById: USER,
      },
      select: { id: true },
    });
    const s4 = await startResearchTree({ orgId: ORG, projectId: p4, userId: USER, role: "admin", trigger: "human_start" });
    const job4 = s4.ok ? s4.jobId : "";
    const notifBefore = await db.notification.count();
    await db.agentRun.update({ where: { id: job4 }, data: { status: "failed", errorCode: "test_failure" } });
    const { surfaceTenderJobStopped } = await import("@/lib/tender-workforce/job-failure-surfacing");
    const direct = await surfaceTenderJobStopped(job4);
    ok(direct.surfaced === false && direct.reason === "already_terminal", "收尾认它是招投标域、已停下，但找不到分析记录 → 什么都不改（already_terminal）", direct);
    await onWorkforceJobStopped({ runId: job4 });
    await db.agentRun.update({ where: { id: job4 }, data: { status: "needs_human" } });
    await onWorkforceJobStopped({ runId: job4 });
    const surfaced = await db.auditLog.count({ where: { action: "tender.workforce.failed_surfaced", targetId: job4 } });
    const ar = await db.tenderAnalysisRun.findUniqueOrThrow({ where: { id: analysisRun.id }, select: { status: true, errorCode: true } });
    ok(surfaced === 0 && ar.status === "AGENT_ANALYZING" && ar.errorCode === null && (await db.notification.count()) === notifBefore, "项目那条在跑的分析记录不变（不标「AI 分析未完成」）、没有失败收尾审计、没有通知", { surfaced, ar });

    /* ── 一键分析不复用调研 Job ── */
    const { startTenderWorkforceAnalysis } = await import("@/lib/tender-workforce/trigger-service");
    process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = "1";
    const p5 = await mkProject();
    const s5 = await startResearchTree({ orgId: ORG, projectId: p5, userId: USER, role: "admin", trigger: "human_start" });
    const analysis = await startTenderWorkforceAnalysis({ orgId: ORG, projectId: p5, projectName: "x", userId: USER, role: "admin" });
    ok(analysis.ok && s5.ok && analysis.jobId !== s5.jobId && analysis.reused === false, "项目有在查的调研 Job 时点 AI 分析：新建自己的 Job", { analysis, s5 });
    const { cancelTenderWorkforceAnalysis } = await import("@/lib/tender-workforce/trigger-service");
    const cancel = await cancelTenderWorkforceAnalysis({ orgId: ORG, projectId: p5, jobId: s5.ok ? s5.jobId : "" });
    ok(!cancel.ok && cancel.code === "NOT_FOUND" && (await db.agentRun.findUniqueOrThrow({ where: { id: s5.ok ? s5.jobId : "" } })).status !== "cancelled", "分析的取消认不出调研 Job（取消不到它）", cancel);
    if (analysis.ok) await db.agentRun.update({ where: { id: analysis.jobId }, data: { status: "cancelled" } });

    /* ── 两处同时认领 ── */
    console.log("\n[同一 Job 同一时间只有一处在处理]");
    const job5 = s5.ok ? s5.jobId : "";
    await db.agentRun.update({ where: { id: job5 }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
    const claims = await Promise.all([0, 1, 2].map(() => claimRunLease({ runId: job5, allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE], leaseMs: 60_000, maxAttempts: 5, reclaimableStatuses: [...WORKFORCE_ACTIVE_STATUSES] })));
    ok(claims.filter((c) => c.ok).length === 1, "三处同时认领只有一个拿到", claims.map((c) => c.ok));
    // 被别人拿着租约时，处理器认领不到、什么都不做
    const callsBefore = modelCalls.length;
    const slice = await processWorkforceJobSlice(job5, { executionBudget: { deadlineAt: Date.now() + 240_000, tickBudgetMs: 240_000 } });
    ok(slice.claimed === false && modelCalls.length === callsBefore, "租约在别人手里：处理器认领不到，不调模型", slice);
    await db.agentRun.update({ where: { id: job5 }, data: { status: "cancelled", leaseExpiresAt: null } });

    /* ── 开关关：在途的调研 Job 什么都不做 ── */
    console.log("\n[开关关时零变化]");
    const p6 = await mkProject();
    const s6 = await startResearchTree({ orgId: ORG, projectId: p6, userId: USER, role: "admin", trigger: "human_start" });
    const job6 = s6.ok ? s6.jobId : "";
    delete process.env.TENDER_RESEARCH_TREE_ENABLED;
    const offBefore = await snapshot();
    const m0 = modelCalls.length;
    const q0 = searches.length;
    const n0 = world.log.length;
    const o0 = openDataQueries.length;
    const st6 = await runToEnd(job6);
    const steps6 = await stepOutputs(job6);
    ok(st6 === "completed" && Object.keys(steps6).filter((k) => k !== "research_trunk").every((k) => handoff(steps6[k]?.outputJson)?.status === "flag_off"), "每一支都交「开关已关」", st6);
    ok(modelCalls.length === m0 && searches.length === q0 && world.log.length === n0 && openDataQueries.length === o0, "零模型请求、零搜索、零联邦数据查询、零读页");
    ok((await db.auditLog.count({ where: { orgId: ORG, action: { in: ["research.branch_step", "research.web_read"] }, targetId: job6 } })) === 0, "零审计");
    const offChanged = changedTables(offBefore, await snapshot());
    ok(offChanged.every((t) => RUNTIME_TABLES.includes(t)), "开关关：整库只有运行时自己的表有变化", offChanged);
    const sj6 = (await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId: p6 } })).summaryJson as Record<string, unknown>;
    ok(sj6.researchTree === undefined && (sj6.otherFeature as { keep?: boolean })?.keep === true, "情报室不变");
    process.env.TENDER_RESEARCH_TREE_ENABLED = "1";
  } finally {
    __setResearchTreeDepsForTest(null);
    await db.agentRun.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
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
