/**
 * Supplier Intelligence M1-S2 — DB 集成（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2-db.isolated.test.ts
 *
 * 覆盖：executeSupplierSearchRun 全链（S2-T9/T10/T11 优先级 1–3、S2-T12 外部关=DISABLED
 * 仍有内部结果、S2-T13 历史成功不自动合规、每源状态档 §20、查询快照 §11、幂等去重 §30、
 * S2-T26 取消竞态晚到丢弃、S2-T29 egress、实体解析预填 append、跨租户隔离、终态收口 §44）。
 * 零真实外呼（provider 全 fake）；memory 源走 canonical searchMemoryClaims（§31）。
 */
import assert from "node:assert/strict";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Supplier Intel S2 DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Supplier Intel S2 DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 Supplier Intel S2 DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s2 integration" });
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const runSvc = await import("../run-service");
  const signalSvc = await import("../signal-service");
  const discovery = await import("../discovery-service");
  const er = await import("../entity-resolution");
  const { buildDeterministicBrief } = await import("../search-brief");
  const { douyinSupplierDiscoveryAdapter, openWebSupplierAdapter, wechatChannelsDiscoveryAdapter } =
    await import("../adapters");
  const providersMod = await import("../providers");
  type Provider = import("../providers").DiscoveryProvider;

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  const tag = `s2si_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ---------------- Fixture ----------------
  const userA = await db.user.create({
    data: { email: `s2_a_${tag}@test.qingyan.local`, name: "S2UserA", role: "user", status: "active" },
  });
  const userB = await db.user.create({
    data: { email: `s2_b_${tag}@test.qingyan.local`, name: "S2UserB", role: "user", status: "active" },
  });
  const orgA = await db.organization.create({
    data: { name: `S2 Org A ${tag}`, code: `s2a_${tag}`, ownerId: userA.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `S2 Org B ${tag}`, code: `s2b_${tag}`, ownerId: userB.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: userA.id, role: "org_admin", status: "active" },
      { orgId: orgB.id, userId: userB.id, role: "org_admin", status: "active" },
    ],
  });
  const projectA = await db.project.create({
    data: { orgId: orgA.id, name: `S2 Proj ${tag}`, ownerId: userA.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const supMem = await db.supplier.create({
    data: { orgId: orgA.id, name: `记忆供应商 ${tag}`, createdById: userA.id },
  });
  const supWin = await db.supplier.create({
    data: { orgId: orgA.id, name: `中选供应商 ${tag}`, createdById: userA.id },
  });
  const supPlain = await db.supplier.create({
    data: { orgId: orgA.id, name: `普通供应商 ${tag}`, website: "https://xxfurniture.cn", createdById: userA.id },
  });
  await db.memoryClaim.create({
    data: {
      orgId: orgA.id,
      subjectType: "VENDOR",
      subjectKey: supMem.id,
      claimType: "SUPPLIER_FACT",
      claimNature: "INTERPRETATION",
      statement: `S2 fixture：铝合金外壳 打样能力 ${tag}`,
      confidence: "MEDIUM",
      verificationStatus: "NEEDS_REVIEW",
      sourceType: "USER_ENTRY",
      capturedAt: new Date(),
      status: "ACTIVE",
      accessClass: "INTERNAL_COMPANY",
      createdByType: "user",
      createdById: userA.id,
    },
  });
  const inquiry = await db.projectInquiry.create({
    data: { projectId: projectA.id, roundNumber: 1, createdById: userA.id },
  });
  await db.inquiryItem.create({
    data: { inquiryId: inquiry.id, supplierId: supWin.id, isSelected: true, createdById: userA.id },
  });

  const actorA = { orgId: orgA.id, userId: userA.id };
  const actorB = { orgId: orgB.id, userId: userB.id };

  const requirements = [
    { id: `r1_${tag}`, code: "R-001", text: "必须提供 UL 认证", category: "MANDATORY", mandatory: true, mandatorySignal: "must" },
    { id: `r2_${tag}`, code: "R-002", text: "疑似强制的安装要求", category: "INSTALLATION", mandatory: "uncertain", mandatorySignal: "may" },
  ];
  const brief = buildDeterministicBrief({
    requirements,
    productKeywordsZh: ["铝合金外壳"],
    productKeywordsEn: ["aluminum enclosure"],
  });

  const fakeProvider = (results: Array<{ url: string; title?: string }>): Provider => ({
    providerId: "fake-search",
    policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
    isAvailable: () => true,
    search: async (q) => ({
      status: results.length > 0 ? "SUCCESS" : "EMPTY",
      results: results.map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: "snippet", sourceQuery: q })),
    }),
  });

  try {
    console.log("\n== S2-T29 egress：敏感词查询在计划期被丢弃（不出站）==");
    const dirtyBrief = buildDeterministicBrief({
      requirements,
      productKeywordsZh: ["毛利底价椅"], // 派生词全部携带敏感词（置于截断上限之内）
    });
    const planOut = discovery.buildExternalQueryPlan(dirtyBrief, [openWebSupplierAdapter]);
    ok(planOut.egressDropped > 0, "含 毛利/底价 的派生查询被 egress 闸丢弃");
    ok(
      [...planOut.plans.values()].flat().every((q) => !/毛利|底价/.test(q.query)),
      "外发查询计划零敏感词",
    );

    console.log("\n== 主链：执行发现（内部 1–3 + 层 B + 状态档 + 收口）==");
    const run = await runSvc.createSearchRun(actorA, { projectId: projectA.id, brief, requirements });
    await runSvc.startSearchRun(actorA, run.id);
    const result = await discovery.executeSupplierSearchRun(actorA, run.id, {
      provider: fakeProvider([
        { url: "https://v.douyin.com/f1/", title: "工厂实拍" },
        { url: "https://detail.1688.com/offer/9.html", title: "铝壳定制" },
        { url: "https://xxfurniture.cn/about", title: "官网" },
        { url: "https://www.pinterest.com/pin/1", title: "噪音" },
      ]),
      adapters: [douyinSupplierDiscoveryAdapter, wechatChannelsDiscoveryAdapter, openWebSupplierAdapter],
    });
    ok(result.runStatus === "COMPLETED", "§44：有 SUCCESS 源 → COMPLETED 收口", result.runStatus);
    ok(result.candidatesCreated === 3, "内部池：三家供应商入池", String(result.candidatesCreated));
    const candidates = await db.supplierCandidate.findMany({ where: { searchRunId: run.id } });
    const originOf = (sid: string) => candidates.find((c) => c.supplierId === sid)?.originSource;
    ok(originOf(supMem.id) === "MEMORY", "S2-T9：memory 供应商 originSource=MEMORY（canonical 记忆检索）");
    ok(originOf(supWin.id) === "HISTORICAL_SUCCESS", "S2-T10：历史中选 originSource=HISTORICAL_SUCCESS");
    ok(originOf(supPlain.id) === "SAVED", "S2-T11：已存供应商 originSource=SAVED");
    ok(
      candidates.every((c) => c.mandatoryGateResult === "PENDING" && c.totalScore === null),
      "S2-T13：发现只入池——无门判定无评分（历史成功不自动合规）",
    );
    const runRow = await db.supplierSearchRun.findUnique({ where: { id: run.id } });
    const plannedQueries = runRow?.queriesJson as Array<Record<string, unknown>>;
    ok(
      Array.isArray(plannedQueries) &&
        plannedQueries.length > 0 &&
        plannedQueries.every((q) => q.source && q.query && q.language && q.queryType && q.priority),
      "§11：queriesJson 对象化快照（source/query/language/queryType/priority）",
    );
    const detail = runRow?.statusDetailJson as Record<string, unknown>;
    const srcMap = detail?.sources as Record<string, { status: string; count?: number }>;
    ok(srcMap?.memory?.status === "SUCCESS" && srcMap?.historical?.status === "SUCCESS" && srcMap?.saved?.status === "SUCCESS", "§20：内部源状态档 SUCCESS");
    ok(srcMap?.WECHAT_CHANNELS?.status === "DISABLED", "视频号=DISABLED（USER_ASSISTED）");
    const signals = await db.supplierDiscoverySignal.findMany({ where: { searchRunId: run.id } });
    ok(signals.length >= 3 && signals.every((s) => s.sourceOrigin === "PUBLIC_WEB"), "层 B 信号落库=PUBLIC_WEB（§24/§39 只是 discovery）");
    ok(signals.some((s) => s.platform === "DOUYIN") && signals.some((s) => s.platform === "ONE688") && signals.some((s) => s.platform === "WEBSITE"), "平台按 host 归类");
    ok(!signals.some((s) => (s.contentUrl ?? "").includes("pinterest")), "§23：噪音 host 不落信号");

    console.log("\n== §30 幂等：重复执行不重复落库（finalize:false 复跑）==");
    const run2 = await runSvc.createSearchRun(actorA, { brief, requirements });
    await runSvc.startSearchRun(actorA, run2.id);
    const first = await discovery.executeSupplierSearchRun(actorA, run2.id, {
      provider: fakeProvider([{ url: "https://v.douyin.com/f1/" }]),
      adapters: [douyinSupplierDiscoveryAdapter],
      finalize: false,
    });
    ok(first.runStatus === "RUNNING" && first.signalsCreated === 1, "finalize:false 保持 RUNNING（S4 组合位）");
    const second = await discovery.executeSupplierSearchRun(actorA, run2.id, {
      provider: fakeProvider([{ url: "https://v.douyin.com/f1/" }]),
      adapters: [douyinSupplierDiscoveryAdapter],
      finalize: false,
    });
    ok(second.signalsCreated === 0 && second.signalsDeduped === 1, "同 Run 同 URL 去重");
    ok(second.candidatesCreated === 0 && second.candidatesDeduped === 3, "内部池幂等跳过");

    console.log("\n== S2-T12/T14/T15：外部双门关 → DISABLED 显式 + 内部照常 ==");
    const run3 = await runSvc.createSearchRun(actorA, { brief, requirements });
    await runSvc.startSearchRun(actorA, run3.id);
    let externalCalls = 0;
    const closedProvider = providersMod.createTavilySearchEngineProvider({
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        externalCalls += 1;
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
    });
    const closed = await discovery.executeSupplierSearchRun(actorA, run3.id, { provider: closedProvider });
    ok(closed.runStatus === "COMPLETED" && closed.candidatesCreated === 3, "外部关：内部源照常工作并 COMPLETED");
    ok(externalCalls === 0, "S2-T14/T15：双门关 → 零 provider 调用");
    ok(Boolean(closed.externalSkippedReason?.includes("DISABLED")), "externalSearch=DISABLED 显式（非 silent no-op）");
    const detail3 = (await db.supplierSearchRun.findUnique({ where: { id: run3.id } }))?.statusDetailJson as Record<string, unknown>;
    const src3 = detail3?.sources as Record<string, { status: string }>;
    ok(src3?.OPEN_WEB?.status === "DISABLED", "每源状态档：OPEN_WEB=DISABLED");

    console.log("\n== provider FAILED 传导：外部失败不拖垮内部（§44）==");
    const run4 = await runSvc.createSearchRun(actorA, { brief, requirements });
    await runSvc.startSearchRun(actorA, run4.id);
    const failingProvider: Provider = {
      providerId: "fake-failing",
      policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
      isAvailable: () => true,
      search: async () => ({ status: "TIMEOUT", results: [] }),
    };
    const partial = await discovery.executeSupplierSearchRun(actorA, run4.id, {
      provider: failingProvider,
      adapters: [openWebSupplierAdapter],
    });
    ok(partial.runStatus === "COMPLETED", "内部 SUCCESS + 外部 FAILED → 仍 COMPLETED");
    const detail4 = (await db.supplierSearchRun.findUnique({ where: { id: run4.id } }))?.statusDetailJson as Record<string, unknown>;
    const src4 = detail4?.sources as Record<string, { status: string; reason?: string }>;
    ok(src4?.OPEN_WEB?.status === "FAILED" && src4?.OPEN_WEB?.reason === "TIMEOUT", "S2-T16/T19：provider 失败显式落档（TIMEOUT），不吞");

    console.log("\n== S2-T26/T27：取消竞态——飞行中的 provider 结果晚到即丢弃 ==");
    const run5 = await runSvc.createSearchRun(actorA, { brief, requirements });
    await runSvc.startSearchRun(actorA, run5.id);
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((r) => { releaseProvider = r; });
    let providerCalled!: () => void;
    const calledGate = new Promise<void>((r) => { providerCalled = r; });
    let firstCall = true;
    const blockingProvider: Provider = {
      providerId: "fake-blocking",
      policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
      isAvailable: () => true,
      search: async (q) => {
        if (firstCall) {
          firstCall = false;
          providerCalled();
        }
        await providerGate;
        return {
          status: "SUCCESS",
          results: [{ title: "late", url: "https://v.douyin.com/late1/", snippet: "", sourceQuery: q }],
        };
      },
    };
    const execPromise = discovery.executeSupplierSearchRun(actorA, run5.id, {
      provider: blockingProvider,
      adapters: [douyinSupplierDiscoveryAdapter],
      includeInternalPool: false,
    });
    await calledGate; // provider 已在飞行中（无任何 DB 行锁被持有）
    await runSvc.cancelSearchRun(actorA, run5.id); // 并发取消——若编排持锁，这里会卡死
    releaseProvider();
    const raced = await execPromise;
    ok(raced.runStatus === "TERMINAL_RACE", "编排识别终态竞态并停止写入");
    ok(raced.lateResultsDiscarded > 0, "晚到 provider 结果被丢弃（计数留痕）");
    ok((await db.supplierDiscoverySignal.count({ where: { searchRunId: run5.id } })) === 0, "CANCELLED Run 零事后信号（§47）");
    ok((await db.supplierSearchRun.findUnique({ where: { id: run5.id } }))?.status === "CANCELLED", "Run 终态保持 CANCELLED（不被编排收口覆盖）");

    console.log("\n== 实体解析预填 ==");
    const sig = await signalSvc.createSubmittedSignal(actorA, {
      url: "https://xxfurniture.cn/contact",
      rawText: `联系 13800138000`,
    });
    const resolved = await er.resolveSignalEntity(actorA, sig.id);
    ok(resolved.decision === "MATCHED_EXISTING" && resolved.supplierId === supPlain.id, "S2-T20：官网域名强键 → MATCHED_EXISTING 预填", JSON.stringify(resolved.matchedSignals));
    const sigRow = await db.supplierDiscoverySignal.findUnique({ where: { id: sig.id } });
    const entries = sigRow?.resolutionJson as Array<Record<string, unknown>>;
    ok(Array.isArray(entries) && entries.length === 1 && entries[0].phase === "AUTO_PREFILL", "resolutionJson append（AUTO_PREFILL）");
    ok(sigRow?.status === "NEW" && sigRow?.linkedSupplierId === null, "预填不改状态不建关联（AUTO_MERGE_PATHS=0）");
    await expectErr("NOT_FOUND", "S2-T24：跨租户解析被拒", () => er.resolveSignalEntity(actorB, sig.id));

    console.log("\n== 终态拒绝 ==");
    await expectErr("RUN_NOT_RUNNING", "终态 Run 不可再执行发现（重评估=新 Run）", () =>
      discovery.executeSupplierSearchRun(actorA, run.id, { provider: fakeProvider([]) }));
  } finally {
    const orgIds = [orgA.id, orgB.id];
    await db.supplierRequirementMatch.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierCertification.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.inquiryItem.deleteMany({ where: { supplier: { orgId: { in: orgIds } } } });
    await db.projectInquiry.deleteMany({ where: { project: { orgId: { in: orgIds } } } });
    await db.memoryClaim.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.supplier.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.project.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Supplier Intel S2 集成测试异常:", e);
  process.exit(1);
});
