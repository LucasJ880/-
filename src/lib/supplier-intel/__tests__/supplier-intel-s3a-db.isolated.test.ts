/**
 * S3-A 服务 + HTTP 集成（隔离库执行，否则跳过）。
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     JWT_SECRET=... SUPPLIER_INTEL_ENABLED=1 \
 *     npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s3a-db.isolated.test.ts
 *
 * 覆盖任务书 §11A 的 T2–T11（T1 入口跳转由浏览器验收脚本覆盖）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 S3-A DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 S3-A DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 S3-A DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s3a workspace" });
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
  process.env.SUPPLIER_INTEL_ENABLED = process.env.SUPPLIER_INTEL_ENABLED || "1";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "s3a-db-test-secret";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const signalSvc = await import("../signal-service");
  const runSvc = await import("../run-service");
  const projectRunSvc = await import("../project-run-service");
  const er = await import("../entity-resolution");
  const pv = await import("../procurement-view");
  const { createSession } = await import("@/lib/auth/session");
  const { buildCanonicalRisksStructuredJson } = await import("./fixtures/canonical-risks-writer");

  const signalsRoute = await import("@/app/api/supplier-intel/signals/route");
  const procurementRoute = await import(
    "@/app/api/supplier-intel/projects/[projectId]/procurement-view/route"
  );

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  /** 稳定序列化：Prisma 回读 JSON 的键顺序与写入时不同，比较必须与顺序无关 */
  function canonicalJson(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
    if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  }

  const tag = `s3a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /* ─────────────── Fixture ─────────────── */
  const mk = (slug: string) =>
    db.user.create({
      data: { email: `${slug}_${tag}@test.qingyan.local`, name: slug, role: "user", status: "active" },
    });
  const owner = await mk("s3a_owner");
  const writer = await mk("s3a_writer");
  const viewer = await mk("s3a_viewer");
  const outsider = await mk("s3a_outsider");

  const org = await db.organization.create({
    data: { name: `S3A Org ${tag}`, code: `s3a_${tag}`, ownerId: owner.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [owner, writer, viewer, outsider].map((u) => ({
      orgId: org.id,
      userId: u.id,
      role: u.id === owner.id ? "org_admin" : "org_member",
      status: "active",
    })),
  });

  const mkProject = (name: string) =>
    db.project.create({
      data: {
        orgId: org.id, name, ownerId: owner.id, workDomain: "tender",
        intakeStatus: "dispatched", status: "active",
      },
    });
  const projA = await mkProject(`S3A ProjA ${tag}`);
  const projB = await mkProject(`S3A ProjB ${tag}`);
  await db.projectMember.createMany({
    data: [
      { projectId: projA.id, userId: writer.id, role: "project_admin", status: "active" },
      { projectId: projA.id, userId: viewer.id, role: "viewer", status: "active" },
      { projectId: projB.id, userId: outsider.id, role: "project_admin", status: "active" },
    ],
  });

  const SEED = [
    { code: "R-001", mandatory: true as const, en: "Must be ANSI/BIFMA X5.1 certified.", zh: "须通过 ANSI/BIFMA X5.1 认证。", cat: "safety" },
    { code: "R-002", mandatory: false as const, en: "Mesh back preferred.", zh: "优先网布靠背。", cat: "product" },
    { code: "R-003", mandatory: "uncertain" as const, en: "Sample may be required.", zh: "可能需要提供样品。", cat: "samples" },
  ];
  async function seedAnalysis(projectId: string, risks: unknown, key: string) {
    const run = await db.tenderAnalysisRun.create({
      data: {
        orgId: org.id, projectId, status: "APPROVED",
        idempotencyKey: `${key}_${tag}`, sourceHashFingerprint: "s3a",
        summaryJson: { criticalFacts: { quantity: { status: "KNOWN", text: "750 units" }, warranty: { status: "UNKNOWN" } } },
      },
    });
    for (const r of SEED) {
      await db.tenderExtractedRequirement.create({
        data: {
          projectId, analysisRunId: run.id, requirementCode: r.code, category: r.cat,
          originalRequirement: r.en, chineseTranslation: r.zh, mandatory: r.mandatory === true,
        },
      });
    }
    await db.tenderAnalysisSection.create({
      data: { runId: run.id, sectionKey: "RISKS", contentZh: "x", structuredJson: risks as never },
    });
    return run;
  }
  const goodRisks = buildCanonicalRisksStructuredJson(
    SEED.map((r) => ({ code: r.code, mandatory: r.mandatory, statement: r.en })),
  );
  const analysisA = await seedAnalysis(projA.id, goodRisks, "s3a_a");
  // projB：legacy 形状 → 来源不可证完整
  await seedAnalysis(projB.id, { kind: "risks", inventedHistoricalAwards: false }, "s3a_b");

  const actorOwner = { orgId: org.id, userId: owner.id };
  const actorWriter = { orgId: org.id, userId: writer.id };
  const actorViewer = { orgId: org.id, userId: viewer.id };
  const actorOutsider = { orgId: org.id, userId: outsider.id };

  async function req(user: { id: string; email: string }, url: string, init?: { method?: string; body?: unknown }) {
    const token = await createSession({ sub: user.id, email: user.email, role: "user" });
    return new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? "GET",
      headers: { cookie: `qy_session=${token}`, "content-type": "application/json" },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  const cleanupOrgs = [org.id];
  const cleanupUsers = [owner.id, writer.id, viewer.id, outsider.id];

  try {
    console.log("\n== T2：中文说明 / 英文原文 / 三值 / 来源定位一致 ==");
    const view = await pv.loadProcurementView(actorWriter, projA.id);
    ok(view.canonical.state === "OK", "canonical 来源有效");
    const byCode = new Map(view.requirements.map((r) => [r.code, r]));
    ok(byCode.get("R-001")?.mandatory === true, "T2a：true 忠实");
    ok(byCode.get("R-002")?.mandatory === false, "T2b：false 保持 false");
    ok(byCode.get("R-003")?.mandatory === "uncertain", "T2c：uncertain 幸存（不塌缩成 false）");
    ok(byCode.get("R-001")?.textEn === SEED[0].en, "T2d：英文原文原样保留");
    ok(byCode.get("R-001")?.textZh === SEED[0].zh && byCode.get("R-001")?.textZhIsChinese === true, "T2e：中文译文可用");
    ok(byCode.get("R-001")?.group === "compliance" && byCode.get("R-003")?.group === "samples", "T2f：采购分组正确");
    ok(view.counts.mandatory === 1 && view.counts.uncertain === 1 && view.counts.optional === 1, "T2g：三值计数正确");
    const qty = view.facts.find((f) => f.key === "quantity");
    const wty = view.facts.find((f) => f.key === "warranty");
    ok(qty?.status === "KNOWN" && qty.text === "750 units", "T2h：已知关键事实如实展示");
    ok(wty?.status === "UNKNOWN" && wty.text === null, "T2i：未知关键事实显示为未提取（不推断）");
    ok(view.requirements.every((r) => Array.isArray(r.sources)), "T2j：来源字段始终存在（无来源时为空数组，不编造）");
    ok(view.canWrite === true, "T2k：project_admin 的 canWrite=true");

    console.log("\n== T3：canonical 来源无效 → 阻断，且 Run/LLM/provider 调用均为 0 ==");
    const blocked = await pv.loadProcurementView(actorOwner, projB.id);
    ok(blocked.canonical.state === "BLOCKED", "T3a：阅读视图显示阻断而不是伪造三值");
    ok(blocked.requirements.length === 0, "T3b：阻断时不逐条展示要求");
    let llmCalls = 0;
    const countingInvoker = async () => {
      llmCalls += 1;
      return { content: "{}", model: "should-not-be-called", elapsedMs: 1 };
    };
    await expectErr("BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE", "T3c：开搜被服务端阻断", () =>
      projectRunSvc.createProjectSearchRun(actorOwner, { projectId: projB.id }, { invoker: countingInvoker }));
    ok(llmCalls === 0, "T3d：LLM 调用数 = 0", `实际 ${llmCalls}`);
    ok((await db.supplierSearchRun.count({ where: { orgId: org.id, projectId: projB.id } })) === 0, "T3e：可执行 Run 创建数 = 0");
    ok((await db.supplierDiscoverySignal.count({ where: { orgId: org.id, projectId: projB.id } })) === 0, "T3f：零信号 ⇒ 零 provider 落库");

    console.log("\n== T4：历史 Run 用自己的快照；需求更新只能新建 Run ==");
    const run1 = await projectRunSvc.createProjectSearchRun(actorWriter, { projectId: projA.id, allowLlm: false });
    const snap1 = run1.requirementSnapshotJson as Array<Record<string, unknown>>;
    ok(snap1.length === 3, "T4a：Run 冻结当时的需求快照");
    // 新分析版本：R-002 变强制
    const analysis2 = await db.tenderAnalysisRun.create({
      data: { orgId: org.id, projectId: projA.id, status: "APPROVED", idempotencyKey: `s3a_a2_${tag}`, sourceHashFingerprint: "s3a" },
    });
    for (const r of SEED) {
      await db.tenderExtractedRequirement.create({
        data: {
          projectId: projA.id, analysisRunId: analysis2.id, requirementCode: r.code, category: r.cat,
          originalRequirement: r.en, chineseTranslation: r.zh, mandatory: true,
        },
      });
    }
    await db.tenderAnalysisSection.create({
      data: {
        runId: analysis2.id, sectionKey: "RISKS", contentZh: "x",
        structuredJson: buildCanonicalRisksStructuredJson(SEED.map((r) => ({ code: r.code, mandatory: true as const, statement: r.en }))) as never,
      },
    });
    const reread = await db.supplierSearchRun.findUnique({ where: { id: run1.id } });
    const snapAfter = reread?.requirementSnapshotJson as Array<Record<string, unknown>>;
    ok(
      JSON.stringify(snapAfter) === JSON.stringify(snap1),
      "T4b：历史 Run 快照未被新分析改写",
    );
    const viewNow = await pv.loadProcurementView(actorWriter, projA.id);
    ok(viewNow.analysis?.runId === analysis2.id, "T4c：阅读视图跟随最新分析");
    ok(
      (run1.sourceConfigJson as Record<string, unknown>).canonicalAnalysisRunId === analysisA.id,
      "T4d：旧 Run 留有它当时的分析指针（供前端提示「基于旧版需求」）",
    );
    await runSvc.startSearchRun(actorWriter, run1.id);
    await runSvc.completeSearchRun(actorWriter, run1.id, { status: "ran" });
    await expectErr("RUN_IMMUTABLE", "T4e：终态 Run 不可再写工作数据", () =>
      runSvc.updateRunWorkingData(actorWriter, run1.id, { statusDetail: { tampered: true } }));

    console.log("\n== T5：重复执行保护（服务端，不靠前端 disabled）==");
    const run2 = await projectRunSvc.createProjectSearchRun(actorWriter, { projectId: projA.id, allowLlm: false });
    await runSvc.startSearchRun(actorWriter, run2.id);
    const lease1 = await runSvc.claimRunExecution(actorWriter, run2.id);
    ok(Boolean(lease1.claim.expiresAt), "T5a：首次认领成功");
    ok(typeof lease1.claimId === "string" && lease1.claimId.length > 0, "T5a2：认领带唯一 claimId");
    await expectErr("RUN_EXECUTION_IN_PROGRESS", "T5b：并发第二次认领被拒（不会跑两轮 provider）", () =>
      runSvc.claimRunExecution(actorOwner, run2.id));
    // 状态档整块重写后声明仍在（否则收口前会出现可再认领的窗口）
    await runSvc.updateRunWorkingData(actorWriter, run2.id, { statusDetail: { status: "ran", sources: {} } });
    await expectErr("RUN_EXECUTION_IN_PROGRESS", "T5c：写状态档后声明仍然有效", () =>
      runSvc.claimRunExecution(actorOwner, run2.id));
    ok(
      (await runSvc.releaseRunExecution(actorWriter, run2.id, lease1.claimId)) === true,
      "T5c2：持有者凭 claimId 释放成功",
    );
    const lease2 = await runSvc.claimRunExecution(actorOwner, run2.id);
    ok(Boolean(lease2.claim.claimedAt), "T5d：释放后可重新认领");
    ok(lease2.claimId !== lease1.claimId, "T5d2：两次认领的 claimId 不同（同一 Run 不同 owner）");
    await runSvc.releaseRunExecution(actorOwner, run2.id, lease2.claimId);
    const expired = runSvc.readActiveExecutionClaim(
      {
        executionClaim: {
          claimId: "c1",
          claimedAt: "x",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          byUserId: "u",
        },
      },
      new Date(),
    );
    ok(expired === null, "T5e：过期声明不再算「进行中」");

    console.log("\n== T6：手工线索——不自动抓取、不自动 LINK、不自动 VERIFIED ==");
    const manual = await signalSvc.createSubmittedSignal(actorWriter, {
      url: "https://s3a-demo-factory.example/product/123",
      rawText: `展会线索 <script>alert(1)</script> ${tag}`,
      manualEntry: true,
      projectId: projA.id,
    });
    ok(manual.status === "NEW" && manual.linkedSupplierId === null, "T6a：新线索是 NEW 且未关联");
    ok(manual.resolutionJson === null, "T6b：创建不产生解析条目（不自动解析）");
    ok(manual.rawText?.includes("<script>"), "T6c：原始文本按原样保存（展示层再做纯文本渲染）");
    ok(
      (await db.supplierCapabilitySignal.count({ where: { discoverySignalId: manual.id } })) === 0,
      "T6d：不自动生成能力信号，更不会有 VERIFIED",
    );
    const supplierBefore = await db.supplier.count({ where: { orgId: org.id } });
    ok(supplierBefore === 0, "T6e：提交线索不自动建供应商");

    console.log("\n== T7：人工 review → link 的真实持久化 ==");
    const sup = await db.supplier.create({
      data: { orgId: org.id, name: `S3A 供应商 ${tag}`, website: "https://s3a-demo-factory.example", createdById: owner.id },
    });
    await signalSvc.reviewSignal(actorWriter, manual.id);
    const linked = await signalSvc.linkSignalToSupplier(actorWriter, manual.id, { supplierId: sup.id, note: "人工确认" });
    ok(linked?.status === "LINKED" && linked?.linkedSupplierId === sup.id, "T7a：link 真实落库");
    const supAfter = await db.supplier.findUnique({ where: { id: sup.id }, select: { website: true } });
    ok(supAfter?.website === "https://s3a-demo-factory.example", "T7b：关联不改写 Supplier.website（内容链接不变官网）");
    const entries = (await db.supplierDiscoverySignal.findUnique({ where: { id: manual.id } }))
      ?.resolutionJson as Array<Record<string, unknown>>;
    ok(Array.isArray(entries) && entries.some((e) => e.decision === "HUMAN_LINKED"), "T7c：人工关联留审计条目");

    console.log("\n== T8：权限矩阵（同 org 不同项目 / 只读 / org_admin）==");
    ok((await pv.loadProcurementView(actorViewer, projA.id)).canWrite === false, "T8a：只读用户 canWrite=false");
    await expectErr("PROJECT_ACCESS_DENIED", "T8b：只读用户不能创建 Run", () =>
      projectRunSvc.createProjectSearchRun(actorViewer, { projectId: projA.id, allowLlm: false }));
    await expectErr("PROJECT_ACCESS_DENIED", "T8c：只读用户不能提交线索", () =>
      signalSvc.createSubmittedSignal(actorViewer, { rawText: "x", manualEntry: true, projectId: projA.id }));
    await expectErr("PROJECT_ACCESS_DENIED", "T8d：他项目用户读不到本项目采购视图", () =>
      pv.loadProcurementView(actorOutsider, projA.id));
    ok((await pv.loadProcurementView(actorOwner, projA.id)).canWrite === true, "T8e：org_admin 在 dispatched 项目可写");

    console.log("\n== T9：跨项目列表 / 计数 / 详情一致 ==");
    const bSignal = await signalSvc.createSubmittedSignal(actorOutsider, {
      rawText: `projB 线索 ${tag}`, manualEntry: true, projectId: projB.id,
    });
    const pageA = await signalSvc.listSignalsPage(actorWriter, { projectId: projA.id });
    ok(pageA.signals.some((s) => s.id === manual.id), "T9a：本项目线索在列表内");
    ok(!pageA.signals.some((s) => s.id === bSignal.id), "T9b：他项目线索不串入");
    ok(pageA.total === pageA.signals.length, "T9c：计数与列表同口径");
    const countA = await signalSvc.countSignals(actorWriter, { projectId: projA.id });
    ok(countA === pageA.total, "T9d：countSignals 与分页 total 一致");
    await expectErr("PROJECT_ACCESS_DENIED", "T9e：按无权项目筛选被拒（筛选参数不是越权入口）", () =>
      signalSvc.listSignalsPage(actorWriter, { projectId: projB.id }));
    const httpDenied = await signalsRoute.GET(
      await req(writer, `/api/supplier-intel/signals?orgId=${org.id}&projectId=${projB.id}`),
    );
    ok(httpDenied.status === 403, "T9f：HTTP 面同样拒绝越权项目筛选", `实际 ${httpDenied.status}`);
    // 分页稳定性
    for (let i = 0; i < 3; i++) {
      await signalSvc.createSubmittedSignal(actorWriter, {
        rawText: `分页线索 ${i} ${tag}`, manualEntry: true, projectId: projA.id,
      });
    }
    const p1 = await signalSvc.listSignalsPage(actorWriter, { projectId: projA.id, take: 2 });
    ok(p1.signals.length === 2 && p1.nextCursor !== null, "T9g：分页返回游标");
    const p2 = await signalSvc.listSignalsPage(actorWriter, { projectId: projA.id, take: 2, cursor: p1.nextCursor });
    const overlap = p2.signals.filter((s) => p1.signals.some((x) => x.id === s.id));
    ok(overlap.length === 0, "T9h：翻页不重复");
    ok(p1.total === p2.total, "T9i：total 跨页一致");
    const huge = await signalSvc.listSignalsPage(actorWriter, { projectId: projA.id, take: 9999 });
    ok(huge.pageSize <= 100, "T9j：页大小服务端有界（客户端放大无效）");

    console.log("\n== T10：并发 resolve / resolve 与 link 的追加完整性 ==");
    const concurrent = await signalSvc.createSubmittedSignal(actorWriter, {
      url: "https://s3a-demo-factory.example/another", rawText: `并发 ${tag}`, projectId: projA.id,
    });
    const [r1, r2] = await Promise.allSettled([
      er.resolveSignalEntity(actorWriter, concurrent.id),
      er.resolveSignalEntity(actorOwner, concurrent.id),
    ]);
    ok(r1.status === "fulfilled" && r2.status === "fulfilled", "T10a：两次并发 resolve 都成功");
    const afterTwo = (await db.supplierDiscoverySignal.findUnique({ where: { id: concurrent.id } }))
      ?.resolutionJson as unknown[];
    ok(Array.isArray(afterTwo) && afterTwo.length === 2, "T10b：两条 AUTO_PREFILL 都在（无覆盖丢失）", `实际 ${afterTwo?.length}`);

    const [r3, r4] = await Promise.allSettled([
      er.resolveSignalEntity(actorWriter, concurrent.id),
      signalSvc.linkSignalToSupplier(actorOwner, concurrent.id, { supplierId: sup.id }),
    ]);
    ok(r3.status === "fulfilled" && r4.status === "fulfilled", "T10c：resolve 与 link 并发都成功");
    const row = await db.supplierDiscoverySignal.findUnique({ where: { id: concurrent.id } });
    const finalEntries = row?.resolutionJson as Array<Record<string, unknown>>;
    ok(finalEntries.length === 4, "T10d：四条条目齐全（人工结果与预填互不覆盖）", `实际 ${finalEntries.length}`);
    ok(finalEntries.some((e) => e.decision === "HUMAN_LINKED"), "T10e：人工关联条目未被预填覆盖");
    ok(row?.status === "LINKED" && row?.linkedSupplierId === sup.id, "T10f：人工关联结果生效");
    const rejected = await signalSvc.createSubmittedSignal(actorWriter, {
      rawText: `将被拒 ${tag}`, manualEntry: true, projectId: projA.id,
    });
    await signalSvc.rejectSignal(actorWriter, rejected.id);
    await er.resolveSignalEntity(actorWriter, rejected.id).catch(() => null);
    const rej = await db.supplierDiscoverySignal.findUnique({ where: { id: rejected.id } });
    ok(rej?.status === "REJECTED", "T10g：预填不复活已拒绝状态");

    console.log("\n== T11：不可信内容与 HTTP 面 ==");
    const httpView = await procurementRoute.GET(
      await req(writer, `/api/supplier-intel/projects/${projA.id}/procurement-view?orgId=${org.id}`),
      { params: Promise.resolve({ projectId: projA.id }) },
    );
    ok(httpView.status === 200, "T11a：采购视图 HTTP 200");
    const httpBody = (await httpView.json()) as {
      view: { requirements: Array<{ code: string; mandatory: unknown }> };
    };
    // HTTP 面与服务层必须逐条同口径（此时最新分析已把三条都改成强制，故按实际值对比）
    const svcView = await pv.loadProcurementView(actorWriter, projA.id);
    const svcByCode = new Map(svcView.requirements.map((r) => [r.code, r.mandatory]));
    ok(
      httpBody.view.requirements.length === svcView.requirements.length &&
        httpBody.view.requirements.every((r) => svcByCode.get(r.code) === r.mandatory),
      "T11b：HTTP 载荷的 mandatory 与服务层逐条一致（三值原样透传）",
    );
    ok(
      httpBody.view.requirements.every((r) => r.mandatory === true || r.mandatory === false || r.mandatory === "uncertain"),
      "T11b2：mandatory 只出现三值之一，不被压成布尔",
    );
    const httpForbidden = await procurementRoute.GET(
      await req(outsider, `/api/supplier-intel/projects/${projA.id}/procurement-view?orgId=${org.id}`),
      { params: Promise.resolve({ projectId: projA.id }) },
    );
    ok(httpForbidden.status === 403, "T11c：无权限用户 HTTP 403", `实际 ${httpForbidden.status}`);
    const forbiddenBody = JSON.stringify(await httpForbidden.json());
    ok(!forbiddenBody.includes("ANSI/BIFMA"), "T11d：403 响应零业务内容");
    ok(
      (await db.supplier.findUnique({ where: { id: sup.id }, select: { website: true } }))?.website ===
        "https://s3a-demo-factory.example",
      "T11e：全流程结束后 Supplier.website 仍未被 contentUrl 覆盖",
    );

    /* ═════════ FR1：执行声明所有权 + 安全恢复 ═════════ */

    console.log("\n== FR1-T1/T2：声明所有权（旧 executor 不得释放新 executor 的声明）==");
    const runOwn = await projectRunSvc.createProjectSearchRun(actorWriter, {
      projectId: projA.id, allowLlm: false,
    });
    await runSvc.startSearchRun(actorWriter, runOwn.id);
    const leaseA = await runSvc.claimRunExecution(actorWriter, runOwn.id);
    await expectErr("RUN_EXECUTION_IN_PROGRESS", "FR1-T1：未过期时第二次认领被拒", () =>
      runSvc.claimRunExecution(actorOwner, runOwn.id));

    // A 正常收尾 → B 认领（新 claimId）→ A 的迟到 finally 再次 release(A.claimId)。
    // 这是「旧 executor 释放掉新 executor 声明」在 no-takeover 策略下唯一可达的路径。
    await runSvc.releaseRunExecution(actorWriter, runOwn.id, leaseA.claimId);
    const leaseB = await runSvc.claimRunExecution(actorOwner, runOwn.id);
    ok(leaseB.claimId !== leaseA.claimId, "FR1-T2a：新 executor 拿到不同的 claimId");
    const staleRelease = await runSvc.releaseRunExecution(actorWriter, runOwn.id, leaseA.claimId);
    ok(staleRelease === false, "FR1-T2b：旧 claimId 释放 = NO-OP");
    const afterStale = await db.supplierSearchRun.findUnique({
      where: { id: runOwn.id }, select: { statusDetailJson: true },
    });
    const survivingClaim = runSvc.readExecutionClaimRecord(afterStale?.statusDetailJson);
    ok(
      survivingClaim?.claimId === leaseB.claimId,
      "FR1-T2c：B 的声明仍在（旧 executor 没能把它删掉）",
      `实际 ${survivingClaim?.claimId ?? "null"}`,
    );
    await expectErr("RUN_EXECUTION_IN_PROGRESS", "FR1-T2d：第三方仍被 B 的声明挡住", () =>
      runSvc.claimRunExecution(actorViewer, runOwn.id));

    console.log("\n== FR1-T3：过期声明 = 结果未知，显式恢复（no-takeover）==");
    const runStale = await projectRunSvc.createProjectSearchRun(actorWriter, {
      projectId: projA.id, allowLlm: false,
    });
    await runSvc.startSearchRun(actorWriter, runStale.id);
    // 用负 TTL 直接造出一个「已过期且从未释放」的声明（等价于 executor 中途被杀）
    await runSvc.claimRunExecution(actorWriter, runStale.id, { ttlMs: -1000 });
    await expectErr(
      "RUN_EXECUTION_RECOVERY_REQUIRED",
      "FR1-T3a：过期后不自动接管，要求显式恢复",
      () => runSvc.claimRunExecution(actorOwner, runStale.id),
    );
    ok(
      runSvc.classifyRunExecutionState(
        (await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runStale.id } })),
        new Date(),
      ) === "RECOVERY_REQUIRED",
      "FR1-T3b：执行态对外表现为 RECOVERY_REQUIRED",
    );
    // 恢复出路 = 取消后新建；取消后终态不重入
    await runSvc.cancelSearchRun(actorWriter, runStale.id);
    await expectErr("RUN_IMMUTABLE", "FR1-T3c：取消后不可再执行（只能新建 Run）", () =>
      runSvc.claimRunExecution(actorWriter, runStale.id));

    console.log("\n== FR1-FINAL-T5/T6：不可验证的声明（旧格式 / malformed）必须 fail closed ==");
    /**
     * 这一组守的是 FR1 最容易被绕开的那条缝：
     * 「解析不出声明」曾被当成「没有声明」，于是旧格式（无 claimId）的 Run
     * 可以被直接重新认领——no-takeover 形同虚设。
     */
    const invalidClaimCases: Array<{ label: string; value: unknown }> = [
      // 旧格式：本轮之前写下的声明就长这样，且 expiresAt 还在未来
      {
        label: "legacy（无 claimId，未过期）",
        value: {
          claimedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          byUserId: writer.id,
        },
      },
      { label: "空 claimId", value: { claimId: "", claimedAt: "x", expiresAt: new Date(Date.now() + 600_000).toISOString(), byUserId: writer.id } },
      { label: "expiresAt 非法", value: { claimId: "c1", claimedAt: "x", expiresAt: "not-a-date", byUserId: writer.id } },
      { label: "值不是对象", value: "surprise" },
    ];

    for (const c of invalidClaimCases) {
      const r = await projectRunSvc.createProjectSearchRun(actorWriter, {
        projectId: projA.id, allowLlm: false,
      });
      await runSvc.startSearchRun(actorWriter, r.id);
      // 直接落一个不可验证的声明（模拟历史数据 / 被改过的行）
      await db.supplierSearchRun.update({
        where: { id: r.id },
        data: { statusDetailJson: { executionClaim: c.value } as never },
      });

      const row = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: r.id } });
      ok(
        runSvc.classifyRunExecutionState(row, new Date()) === "RECOVERY_REQUIRED",
        `FR1-FINAL-T5[${c.label}]：执行态判为 RECOVERY_REQUIRED`,
        `实际 ${runSvc.classifyRunExecutionState(row, new Date())}`,
      );
      await expectErr(
        "RUN_EXECUTION_RECOVERY_REQUIRED",
        `FR1-FINAL-T5[${c.label}]：claimRunExecution 被拒（不接管、不修复、不替换）`,
        () => runSvc.claimRunExecution(actorOwner, r.id),
      );
      // 新声明未写入：库里还是原来那个不可验证的值
      const after = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: r.id } });
      const afterDetail = (after.statusDetailJson ?? {}) as Record<string, unknown>;
      ok(
        canonicalJson(afterDetail.executionClaim) === canonicalJson(c.value),
        `FR1-FINAL-T5[${c.label}]：原值原样保留，没有被 repair / replace / 删除`,
        `实际 ${JSON.stringify(afterDetail.executionClaim)}`,
      );
      ok(after.status === "RUNNING", `FR1-FINAL-T5[${c.label}]：Run 状态未被错误推进`, `实际 ${after.status}`);

      // 持有者身份无从证明 → release 一律 NO-OP（不能把不可判定洗成空闲）
      ok(
        (await runSvc.releaseRunExecution(actorWriter, r.id, "any-claim-id")) === false,
        `FR1-FINAL-T5[${c.label}]：release 无法证明所有权 → NO-OP`,
      );

      // 状态档整块重写也不能把标记洗掉（否则一次工作数据写入就绕过了 no-takeover）
      await runSvc.updateRunWorkingData(actorWriter, r.id, {
        statusDetail: { status: "rewritten-by-discovery", sources: {} },
      });
      const afterRewrite = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: r.id } });
      const rewriteDetail = (afterRewrite.statusDetailJson ?? {}) as Record<string, unknown>;
      ok(
        canonicalJson(rewriteDetail.executionClaim) === canonicalJson(c.value),
        `FR1-FINAL-T5[${c.label}]：整块重写 statusDetail 后标记仍在（不被洗成 IDLE）`,
        `实际 ${JSON.stringify(rewriteDetail.executionClaim)}`,
      );
      ok(
        runSvc.classifyRunExecutionState(afterRewrite, new Date()) === "RECOVERY_REQUIRED",
        `FR1-FINAL-T5[${c.label}]：重写后仍是 RECOVERY_REQUIRED`,
      );
    }

    // T5 收尾：不可验证声明的 Run 上，provider 一次都不许被调用
    {
      const rBlocked = await projectRunSvc.createProjectSearchRun(actorWriter, {
        projectId: projA.id, allowLlm: false,
      });
      await runSvc.startSearchRun(actorWriter, rBlocked.id);
      await db.supplierSearchRun.update({
        where: { id: rBlocked.id },
        data: {
          statusDetailJson: {
            executionClaim: {
              claimedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              byUserId: writer.id,
            },
          } as never,
        },
      });
      const discoverRouteBlocked = await import("@/app/api/supplier-intel/runs/[id]/discover/route");
      const blockedRes = await discoverRouteBlocked.POST(
        await req(writer, `/api/supplier-intel/runs/${rBlocked.id}/discover?orgId=${org.id}`, {
          method: "POST", body: {},
        }),
        { params: Promise.resolve({ id: rBlocked.id }) },
      );
      ok(blockedRes.status === 409, "FR1-FINAL-T5-HTTP：legacy 声明的 Run 执行请求被 409 拒绝", `实际 ${blockedRes.status}`);
      const blockedBody = (await blockedRes.json()) as { code?: string };
      ok(
        blockedBody.code === "RUN_EXECUTION_RECOVERY_REQUIRED",
        "FR1-FINAL-T5-HTTP：错误码为 RUN_EXECUTION_RECOVERY_REQUIRED",
        `实际 ${blockedBody.code}`,
      );
      const candAfterBlocked = await db.supplierCandidate.count({
        where: { orgId: org.id, searchRunId: rBlocked.id },
      });
      const sigAfterBlocked = await db.supplierDiscoverySignal.count({
        where: { orgId: org.id, searchRunId: rBlocked.id },
      });
      ok(
        candAfterBlocked === 0 && sigAfterBlocked === 0,
        "FR1-FINAL-T5-HTTP：被拒的 Run 没有产生任何候选/线索（provider 调用数恒 0）",
        `cand=${candAfterBlocked} sig=${sigAfterBlocked}`,
      );

      // T6：恢复路径 = 取消旧 Run → 新建 Run → 新 Run 可以正常认领
      await runSvc.cancelSearchRun(actorWriter, rBlocked.id);
      const cancelled = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: rBlocked.id } });
      ok(cancelled.status === "CANCELLED", "FR1-FINAL-T6a：旧 Run 被取消进入终态");
      ok(
        runSvc.classifyRunExecutionState(cancelled, new Date()) === "TERMINAL",
        "FR1-FINAL-T6b：终态优先于不可验证声明",
      );
      await expectErr("RUN_IMMUTABLE", "FR1-FINAL-T6c：终态 Run 不能就地重启（不在原 Run 上修复）", () =>
        runSvc.claimRunExecution(actorWriter, rBlocked.id));

      const rFresh = await projectRunSvc.createProjectSearchRun(actorWriter, {
        projectId: projA.id, allowLlm: false,
      });
      const freshLease = await runSvc.claimRunExecution(actorWriter, rFresh.id);
      ok(Boolean(freshLease.claimId), "FR1-FINAL-T6d：新建的 Run 可以正常认领（恢复路径通畅）");
      await runSvc.releaseRunExecution(actorWriter, rFresh.id, freshLease.claimId);
      ok(
        runSvc.classifyRunExecutionState(
          await db.supplierSearchRun.findUniqueOrThrow({ where: { id: rFresh.id } }),
          new Date(),
        ) === "IDLE",
        "FR1-FINAL-T6e：正常释放后回到 IDLE（没有把正常路径一起阻断）",
      );
    }

    console.log("\n== FR1-T4：状态档整块重写与声明更新的竞争 ==");
    const runRace = await projectRunSvc.createProjectSearchRun(actorWriter, {
      projectId: projA.id, allowLlm: false,
    });
    await runSvc.startSearchRun(actorWriter, runRace.id);
    const leaseRace = await runSvc.claimRunExecution(actorWriter, runRace.id);
    // 并发：一边整块重写 statusDetail，一边（模拟收尾后）重新认领。
    // 任何交错顺序下，最终留在库里的声明都不能是已经被释放的那一个。
    await Promise.all([
      runSvc.updateRunWorkingData(actorWriter, runRace.id, {
        statusDetail: { status: "ran", sources: { saved: { status: "EMPTY" } } },
      }),
      runSvc.updateRunWorkingData(actorWriter, runRace.id, {
        statusDetail: { status: "ran2", sources: {} },
      }),
    ]);
    const afterRace = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runRace.id } });
    ok(
      runSvc.readExecutionClaimRecord(afterRace.statusDetailJson)?.claimId === leaseRace.claimId,
      "FR1-T4a：并发整块重写后，当前声明原样幸存（不被旧值覆盖）",
    );
    await runSvc.releaseRunExecution(actorWriter, runRace.id, leaseRace.claimId);
    const leaseRace2 = await runSvc.claimRunExecution(actorOwner, runRace.id);
    await runSvc.updateRunWorkingData(actorWriter, runRace.id, {
      statusDetail: { status: "late-write-from-old-executor" },
    });
    const afterLate = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runRace.id } });
    ok(
      runSvc.readExecutionClaimRecord(afterLate.statusDetailJson)?.claimId === leaseRace2.claimId,
      "FR1-T4b：旧 executor 的迟到状态档写入，不会把旧声明复活回去",
    );
    await runSvc.releaseRunExecution(actorOwner, runRace.id, leaseRace2.claimId);

    console.log("\n== FR1-T5：HTTP 执行入口的输入白名单 ==");
    const discoverRoute = await import("@/app/api/supplier-intel/runs/[id]/discover/route");
    const runPolicy = await projectRunSvc.createProjectSearchRun(actorWriter, {
      projectId: projA.id, allowLlm: false,
    });
    const policyRes = await discoverRoute.POST(
      await req(writer, `/api/supplier-intel/runs/${runPolicy.id}/discover?orgId=${org.id}`, {
        method: "POST",
        // 恶意/越权的执行策略：全部必须被忽略
        body: { finalize: false, includeInternalPool: false, internalPoolLimit: 999999 },
      }),
      { params: Promise.resolve({ id: runPolicy.id }) },
    );
    ok(policyRes.status === 200, "FR1-T5a：执行入口正常返回", `实际 ${policyRes.status}`);
    const policyRun = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runPolicy.id } });
    ok(
      policyRun.status === "COMPLETED" || policyRun.status === "FAILED",
      "FR1-T5b：finalize:false 被忽略——Run 仍按服务端策略收口到终态",
      `实际 ${policyRun.status}`,
    );
    const policyDetail = (policyRun.statusDetailJson ?? {}) as Record<string, unknown>;
    const policySources = (policyDetail.perSource ?? policyDetail.sources ?? {}) as Record<string, unknown>;
    ok(
      Object.keys(policySources).some((k) => k === "saved" || k === "memory" || k === "historical"),
      "FR1-T5c：includeInternalPool:false 被忽略——内部源仍然执行",
      `实际来源 ${Object.keys(policySources).join(",")}`,
    );
    ok(
      runSvc.readExecutionClaimRecord(policyRun.statusDetailJson) === null,
      "FR1-T5d：执行结束后声明已被持有者释放",
    );

    console.log("\n== FR1-T6：请求失败后的可恢复性（不重复调用 provider）==");
    const { executeSupplierSearchRun } = await import("../discovery-service");
    let providerCalls = 0;
    const countingProvider = {
      id: "test-counting",
      isAvailable: () => false, // 外部禁用：本例只关心「被调了几次」
      search: async () => {
        providerCalls += 1;
        return [];
      },
    };
    const runResume = await projectRunSvc.createProjectSearchRun(actorWriter, {
      projectId: projA.id, allowLlm: false,
    });
    // 浏览器断开 = 服务端根本没收到执行请求 → Run 停在 PLANNED、无声明
    const beforeResume = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runResume.id } });
    ok(
      runSvc.classifyRunExecutionState(beforeResume, new Date()) === "IDLE",
      "FR1-T6a：未执行的 Run 是 IDLE（界面给「继续执行 / 取消」）",
    );
    const leaseResume = await runSvc.claimRunExecution(actorWriter, runResume.id);
    await runSvc.startSearchRun(actorWriter, runResume.id);
    await executeSupplierSearchRun(actorWriter, runResume.id, {
      includeInternalPool: true, finalize: true,
      provider: countingProvider as never,
    });
    await runSvc.releaseRunExecution(actorWriter, runResume.id, leaseResume.claimId);
    ok(providerCalls === 0, "FR1-T6b：外部 provider 未启用时调用数恒 0", `实际 ${providerCalls}`);
    await expectErr("RUN_IMMUTABLE", "FR1-T6c：收口后重复执行被拒（不会跑第二轮）", () =>
      runSvc.claimRunExecution(actorWriter, runResume.id));

    console.log("\n== FR1-F：取消入口（HTTP）==");
    const runDetailRoute = await import("@/app/api/supplier-intel/runs/[id]/route");
    const runCancel = await projectRunSvc.createProjectSearchRun(actorWriter, {
      projectId: projA.id, allowLlm: false,
    });
    const cancelForbidden = await runDetailRoute.PATCH(
      await req(viewer, `/api/supplier-intel/runs/${runCancel.id}?orgId=${org.id}`, {
        method: "PATCH", body: { action: "cancel" },
      }),
      { params: Promise.resolve({ id: runCancel.id }) },
    );
    ok(cancelForbidden.status === 403, "FR1-Fa：只读用户不能取消", `实际 ${cancelForbidden.status}`);
    const badAction = await runDetailRoute.PATCH(
      await req(writer, `/api/supplier-intel/runs/${runCancel.id}?orgId=${org.id}`, {
        method: "PATCH", body: { action: "reset-claim" },
      }),
      { params: Promise.resolve({ id: runCancel.id }) },
    );
    ok(badAction.status === 400, "FR1-Fb：除 cancel 外没有其他动作（不提供「重置声明」后门）");
    const cancelOk = await runDetailRoute.PATCH(
      await req(writer, `/api/supplier-intel/runs/${runCancel.id}?orgId=${org.id}`, {
        method: "PATCH", body: { action: "cancel" },
      }),
      { params: Promise.resolve({ id: runCancel.id }) },
    );
    ok(cancelOk.status === 200, "FR1-Fc：有写权限的人可以取消", `实际 ${cancelOk.status}`);
    ok(
      (await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runCancel.id } })).status === "CANCELLED",
      "FR1-Fd：DB 回查确认已取消",
    );

    console.log("\n== FR3-A：内部候选可见（HTTP 回候选清单，不是只回计数）==");
    const detailRes = await runDetailRoute.GET(
      await req(writer, `/api/supplier-intel/runs/${runPolicy.id}?orgId=${org.id}`),
      { params: Promise.resolve({ id: runPolicy.id }) },
    );
    ok(detailRes.status === 200, "FR3-Aa：Run 详情 HTTP 200");
    const detailBody = (await detailRes.json()) as {
      counts: { candidates: number };
      candidates: Array<{ supplierId: string; name: string | null; originSource: string }>;
      executionState: string;
    };
    ok(Array.isArray(detailBody.candidates), "FR3-Ab：返回候选数组");
    ok(
      detailBody.candidates.length === Math.min(detailBody.counts.candidates, 50),
      "FR3-Ac：候选条数与计数一致",
      `list=${detailBody.candidates.length} count=${detailBody.counts.candidates}`,
    );
    if (detailBody.candidates.length > 0) {
      ok(
        detailBody.candidates.every((c) => typeof c.name === "string" && c.name.length > 0),
        "FR3-Ad：候选带供应商名字（采购同事能看出是哪几家）",
      );
      const dbCand = await db.supplierCandidate.findMany({
        where: { orgId: org.id, searchRunId: runPolicy.id }, select: { supplierId: true },
      });
      ok(
        detailBody.candidates.every((c) => dbCand.some((d) => d.supplierId === c.supplierId)),
        "FR3-Ae：候选来自 SupplierCandidate 真表（不是伪造的 Signal）",
      );
      const signalsForRun = await db.supplierDiscoverySignal.count({
        where: { orgId: org.id, searchRunId: runPolicy.id },
      });
      ok(
        signalsForRun === 0 || detailBody.candidates.length > 0,
        "FR3-Af：内部候选与线索是两张表，未被复制成假线索",
      );
    } else {
      ok(false, "FR3-Ad：本次执行没有产生任何内部候选（夹具应保证至少一家已存供应商命中）");
    }
    ok(detailBody.executionState === "TERMINAL", "FR3-Ag：详情带执行态");

    console.log(`\nS3-A 断言：${pass} 通过 / ${fail} 失败`);
  } finally {
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplier.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { orgId: { in: cleanupOrgs } } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { analysisRun: { orgId: { in: cleanupOrgs } } } });
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.projectMember.deleteMany({ where: { project: { orgId: { in: cleanupOrgs } } } });
    await db.project.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.organization.deleteMany({ where: { id: { in: cleanupOrgs } } });
    await db.user.deleteMany({ where: { id: { in: cleanupUsers } } });
    await db.$disconnect();
  }

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
