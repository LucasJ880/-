/**
 * S4-A：评估运行 + 需求匹配 + 强制项硬门——服务 + HTTP 集成（隔离库执行，否则跳过）。
 * 覆盖任务书 §44 T1–T28、§45 并发、§31/§32 ACL、§5.3 不外呼、§47 审计。
 * 「厂家」「证书」全部是合成夹具。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) { console.log("⏭  跳过 S4-A DB 测试（未提供 DATABASE_URL）"); process.exit(0); }
  if (process.env.NODE_ENV !== "test") { console.log("⏭  跳过 S4-A DB 测试（需 NODE_ENV=test）"); process.exit(0); }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") { console.log("⏭  跳过 S4-A DB 测试（需 DATABASE_ENVIRONMENT=isolated）"); process.exit(0); }
  assertSafeTestDatabase({ scriptName: "supplier-intel s4a mandatory gate" });
}

let pass = 0; let fail = 0;
function ok(cond: boolean, name: string, detail?: string) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  requireIsolatedTestDb();
  process.env.SUPPLIER_INTEL_ENABLED = process.env.SUPPLIER_INTEL_ENABLED || "1";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "s4a-db-test-secret";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const evalRun = await import("../evaluation-run-service");
  const evalSvc = await import("../evaluation-service");
  const runSvc = await import("../run-service");
  const signalSvc = await import("../signal-service");
  const { buildCanonicalRisksStructuredJson } = await import("./fixtures/canonical-risks-writer");
  const { createSession } = await import("@/lib/auth/session");
  const evaluationsRoute = await import("@/app/api/supplier-intel/projects/[projectId]/evaluations/route");
  const viewRoute = await import("@/app/api/supplier-intel/runs/[id]/evaluation/route");
  const completeRoute = await import("@/app/api/supplier-intel/runs/[id]/complete/route");
  const matchesRoute = await import("@/app/api/supplier-intel/candidates/[candidateId]/matches/route");
  const gateRoute = await import("@/app/api/supplier-intel/candidates/[candidateId]/mandatory-gate/route");
  const discoverRoute = await import("@/app/api/supplier-intel/runs/[id]/discover/route");

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try { await fn(); ok(false, `${name}（期望抛 ${code}，实际成功）`); }
    catch (e) { if (isSupplierIntelError(e, code as never)) ok(true, name); else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e)); }
  }

  const tag = `s4a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mk = (slug: string) => db.user.create({ data: { email: `${slug}_${tag}@test.qingyan.local`, name: slug, role: "user", status: "active" } });
  const owner = await mk("s4a_owner"); const writer = await mk("s4a_writer"); const viewer = await mk("s4a_viewer");
  const outsider = await mk("s4a_outsider"); const stranger = await mk("s4a_stranger");
  const org = await db.organization.create({ data: { name: `S4A Org ${tag}`, code: `s4a_${tag}`, ownerId: owner.id, status: "active" } });
  const otherOrg = await db.organization.create({ data: { name: `S4A Other ${tag}`, code: `s4a_o_${tag}`, ownerId: stranger.id, status: "active" } });
  await db.organizationMember.createMany({ data: [
    { orgId: org.id, userId: owner.id, role: "org_admin", status: "active" },
    { orgId: org.id, userId: writer.id, role: "org_member", status: "active" },
    { orgId: org.id, userId: viewer.id, role: "org_member", status: "active" },
    { orgId: org.id, userId: outsider.id, role: "org_member", status: "active" },
    { orgId: otherOrg.id, userId: stranger.id, role: "org_admin", status: "active" },
  ] });
  const mkProject = (name: string) => db.project.create({ data: { orgId: org.id, name: `${name} ${tag}`, ownerId: owner.id, workDomain: "tender", intakeStatus: "dispatched", status: "active" } });
  const projA = await mkProject("S4A projA（含 uncertain）"); const projB = await mkProject("S4A projB（干净）");
  for (const p of [projA, projB]) {
    await db.projectMember.createMany({ data: [
      { projectId: p.id, userId: writer.id, role: "project_admin", status: "active" },
      { projectId: p.id, userId: viewer.id, role: "viewer", status: "active" },
    ] });
  }

  type Spec = { code: string; mandatory: true | false | "uncertain"; en: string; zh: string; cat: string };
  const SEED_A: Spec[] = [
    { code: "R-001", mandatory: true, en: "Chairs shall be certified to ANSI/BIFMA X5.1.", zh: "须通过 BIFMA 认证。", cat: "safety" },
    { code: "R-002", mandatory: true, en: "Minimum weight capacity 300 lb.", zh: "最小承重 300 磅。", cat: "technical" },
    { code: "R-003", mandatory: true, en: "Quantity: 750 units.", zh: "数量 750 张。", cat: "product" },
    { code: "R-004", mandatory: false, en: "Mesh back preferred.", zh: "优先网布。", cat: "product" },
    { code: "R-005", mandatory: "uncertain", en: "Supplier may be required to provide a sample chair.", zh: "可能需要样椅。", cat: "samples" },
    { code: "R-006", mandatory: true, en: "Must be UL listed.", zh: "须为 UL 列名。", cat: "safety" },
  ];
  const SEED_B: Spec[] = [
    { code: "R-001", mandatory: true, en: "Chairs shall be certified to ANSI/BIFMA X5.1.", zh: "须通过 BIFMA 认证。", cat: "safety" },
    { code: "R-002", mandatory: true, en: "Minimum weight capacity 300 lb.", zh: "最小承重 300 磅。", cat: "technical" },
    { code: "R-003", mandatory: false, en: "Mesh back preferred.", zh: "优先网布。", cat: "product" },
  ];
  async function seedAnalysis(projectId: string, seed: Spec[], key: string) {
    const run = await db.tenderAnalysisRun.create({ data: { orgId: org.id, projectId, status: "APPROVED", idempotencyKey: `${key}_${tag}`, sourceHashFingerprint: "s4a", summaryJson: { criticalFacts: {} } } });
    for (const r of seed) {
      await db.tenderExtractedRequirement.create({ data: { projectId, analysisRunId: run.id, requirementCode: r.code, category: r.cat, originalRequirement: r.en, chineseTranslation: r.zh, mandatory: r.mandatory === true } });
    }
    await db.tenderAnalysisSection.create({ data: { runId: run.id, sectionKey: "RISKS", contentZh: "x", structuredJson: buildCanonicalRisksStructuredJson(seed.map((r) => ({ code: r.code, mandatory: r.mandatory, statement: r.en }))) as never } });
    return run;
  }
  await seedAnalysis(projA.id, SEED_A, "s4a_a");
  await seedAnalysis(projB.id, SEED_B, "s4a_b");

  const supplier = await db.supplier.create({ data: { orgId: org.id, name: `S4A 演示家具厂 ${tag}`, createdById: owner.id } });
  const supplier2 = await db.supplier.create({ data: { orgId: org.id, name: `S4A 另一家 ${tag}`, createdById: owner.id } });
  const foreignSupplier = await db.supplier.create({ data: { orgId: otherOrg.id, name: `S4A 他组织厂 ${tag}`, createdById: stranger.id } });
  const offA = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supplier.id, name: "网布椅 A", sku: "A-1", attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", createdByUserId: owner.id } });
  const offB = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supplier.id, name: "经济椅 B", sku: "B-1", attributesJson: { 承重: "250 lb" }, unitPrice: 50, currency: "CNY", priceStatus: "KNOWN", sourceKind: "MANUAL", createdByUserId: owner.id } });
  const FUTURE = new Date("2030-01-01T00:00:00.000Z"); const PAST = new Date("2020-01-01T00:00:00.000Z");
  const mkCert = (data: Record<string, unknown>) => db.supplierCertification.create({ data: { orgId: org.id, supplierId: supplier.id, sourceKind: "USER_ENTRY", ...data } as never });
  const certBifmaA = await mkCert({ scope: "PRODUCT", offeringId: offA.id, certificationType: "BIFMA", status: "VERIFIED", expiresAt: FUTURE, verifiedByUserId: owner.id, verifiedAt: new Date() });
  const certBifmaClaimed = await mkCert({ scope: "SUPPLIER", certificationType: "BIFMA", status: "CLAIMED" });
  const certUlExpired = await mkCert({ scope: "SUPPLIER", certificationType: "UL", status: "VERIFIED", expiresAt: PAST, verifiedByUserId: owner.id, verifiedAt: new Date() });
  const certOtherSupplier = await db.supplierCertification.create({ data: { orgId: org.id, supplierId: supplier2.id, scope: "SUPPLIER", certificationType: "BIFMA", status: "VERIFIED", sourceKind: "USER_ENTRY", expiresAt: FUTURE } });
  const archA = await db.tenderArchiveItem.create({ data: { orgId: org.id, projectId: projA.id, kind: "other", captureKey: `upload:s4a-a-${tag}`, capturedAt: new Date(), captureMethod: "upload", mimeType: "application/pdf", fileSize: 1, contentHash: `ha_${tag}`, storageKey: `a/${tag}` } });
  const archB = await db.tenderArchiveItem.create({ data: { orgId: org.id, projectId: projB.id, kind: "other", captureKey: `upload:s4a-b-${tag}`, capturedAt: new Date(), captureMethod: "upload", mimeType: "application/pdf", fileSize: 1, contentHash: `hb_${tag}`, storageKey: `b/${tag}` } });

  const actorOwner = { orgId: org.id, userId: owner.id }; const actorWriter = { orgId: org.id, userId: writer.id };

  async function req(user: { id: string; email: string }, url: string, init?: { method?: string; body?: unknown }) {
    const token = await createSession({ sub: user.id, email: user.email, role: "user" });
    return new NextRequest(`http://localhost${url}`, { method: init?.method ?? "GET", headers: { cookie: `qy_session=${token}`, "content-type": "application/json" }, ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  }
  const P = (o: Record<string, string>) => ({ params: Promise.resolve(o) });
  const q = `?orgId=${org.id}`;

  const cleanupOrgs = [org.id, otherOrg.id]; const cleanupUsers = [owner.id, writer.id, viewer.id, outsider.id, stranger.id];
  try {
    // 已关联线索：来源推导 NEW_DISCOVERY 的依据；projB 那条也是社媒自述证据（T20）
    const sigLinked = await signalSvc.createSubmittedSignal(actorWriter, { url: `https://s4a.example/${tag}/linked`, rawText: `${tag} 厂家自述：UL certified, BIFMA certified`, manualEntry: true, projectId: projB.id });
    await signalSvc.reviewSignal(actorWriter, sigLinked.id);
    await signalSvc.linkSignalToSupplier(actorWriter, sigLinked.id, { supplierId: supplier.id });
    const sigLoose = await signalSvc.createSubmittedSignal(actorWriter, { url: `https://s4a.example/${tag}/loose`, rawText: `${tag} 未关联`, manualEntry: true, projectId: projB.id });
    // projA 也要有来源依据，否则评估会 fail closed——这正是 §6.2 的行为（另有专门断言）
    const sigLinkedA = await signalSvc.createSubmittedSignal(actorWriter, { url: `https://s4a.example/${tag}/linked-a`, rawText: `${tag} projA 线索`, manualEntry: true, projectId: projA.id });
    await signalSvc.reviewSignal(actorWriter, sigLinkedA.id);
    await signalSvc.linkSignalToSupplier(actorWriter, sigLinkedA.id, { supplierId: supplier.id });

    console.log("\n== T3：已收口的发现 Run 不能 reopen / 追加 ==");
    const disc = await runSvc.createSearchRun(actorWriter, { projectId: projB.id, brief: { k: 1 }, requirements: SEED_B.map((r) => ({ id: `x-${r.code}`, code: r.code, text: r.en, category: r.cat, mandatory: r.mandatory })), sourceConfig: { adapters: [] } });
    await runSvc.startSearchRun(actorWriter, disc.id);
    await runSvc.completeSearchRun(actorWriter, disc.id, { status: "ran", sources: {} });
    await expectErr("RUN_NOT_RUNNING", "T3a：COMPLETED 发现 Run 不能追加候选", () => evalSvc.createSupplierCandidate(actorWriter, { searchRunId: disc.id, supplierId: supplier.id, originSource: "SAVED" }));
    await expectErr("INVALID_RUN_TRANSITION", "T3b：COMPLETED 不能回到 RUNNING", () => runSvc.startSearchRun(actorWriter, disc.id));
    await expectErr("RUN_IMMUTABLE", "T3c：终态快照与工作数据不可改", () => runSvc.updateRunWorkingData(actorWriter, disc.id, { statusDetail: { hacked: true } }));

    console.log("\n== T1/T2/T4：评估 = 新 Run；需求只来自服务端 canonical；客户端注入被忽略 ==");
    const createRes = await evaluationsRoute.POST(await req(writer, `/api/supplier-intel/projects/${projB.id}/evaluations${q}`, { method: "POST", body: {
      supplierId: supplier.id, offeringId: offA.id, sourceDiscoveryRunId: disc.id,
      requirements: [{ id: "fake", code: "R-999", text: "fake", mandatory: false }], mandatory: false, evaluationVersion: "hacked", scoreVersion: "hacked", originSource: "HISTORICAL_SUCCESS", requirementRefId: "hack",
    } }), P({ projectId: projB.id }));
    ok(createRes.status === 201, "T4a：创建评估运行 201", `实际 ${createRes.status} ${await createRes.clone().text()}`);
    const created = (await createRes.json()) as { run: { id: string; status: string }; candidate: { id: string } };
    const evRun = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: created.run.id } });
    ok(evRun.id !== disc.id && evRun.status === "RUNNING", "T4b：是新的 Run 且处于 RUNNING");
    ok((evRun.sourceConfigJson as { runMode?: string }).runMode === "EVALUATION_ONLY", "T4c：runMode=EVALUATION_ONLY 落在 sourceConfigJson");
    ok((evRun.sourceConfigJson as { sourceDiscoveryRunId?: string }).sourceDiscoveryRunId === disc.id, "T4d：provenance 指回那次发现 Run（服务端核实同项目）");
    ok((evRun.statusDetailJson as { runMode?: string })?.runMode === "EVALUATION_ONLY", "T4e：statusDetail 诚实标识评估运行");
    const snap = evRun.requirementSnapshotJson as Array<{ code: string; mandatory: unknown }>;
    ok(snap.map((s) => s.code).join(",") === "R-001,R-002,R-003", "T1a：需求快照来自 canonical（R-001..R-003）", snap.map((s) => s.code).join(","));
    ok(!snap.some((s) => s.code === "R-999"), "T2a：客户端塞的 requirements 被忽略");
    ok(evRun.evaluationVersion === "supplier-eval-v1" && evRun.scoreVersion === "supplier-score-v1", "T2b：版本号服务端冻结，客户端 hacked 无效");
    const cand = await db.supplierCandidate.findUniqueOrThrow({ where: { id: created.candidate.id } });
    ok(cand.originSource === "NEW_DISCOVERY", "T2c/§6.2：originSource 由服务端从已关联线索推导，不是客户端的 HISTORICAL_SUCCESS", cand.originSource);
    ok((cand.discoveryConfidenceJson as { originBasis?: string })?.originBasis === "LINKED_SIGNAL", "§6.2：来源依据可追溯");
    ok((cand.supplierSnapshotJson as { name?: string }).name === supplier.name && (cand.offeringSnapshotJson as { attributes?: { 承重?: string } })?.attributes?.承重 === "600 lb", "T5a：供应商 / offering 快照已冻结");
    ok(Boolean(await db.auditLog.findFirst({ where: { action: "supplier_intel.evaluation.run.created", targetId: evRun.id } })), "§47：audit evaluation.run.created");

    console.log("\n== §5.3：评估运行不外呼——discover 一律 409 ==");
    const cBefore = await db.supplierCandidate.count({ where: { searchRunId: evRun.id } });
    const sBefore = await db.supplierDiscoverySignal.count({ where: { searchRunId: evRun.id } });
    const discRes = await discoverRoute.POST(await req(writer, `/api/supplier-intel/runs/${evRun.id}/discover${q}`, { method: "POST", body: {} }), P({ id: evRun.id }));
    ok(discRes.status === 409 && ((await discRes.json()) as { code?: string }).code === "RUN_MODE_MISMATCH", "§5.3a：评估运行不能执行搜索（409 RUN_MODE_MISMATCH）", `实际 ${discRes.status}`);
    ok((await db.supplierCandidate.count({ where: { searchRunId: evRun.id } })) === cBefore && (await db.supplierDiscoverySignal.count({ where: { searchRunId: evRun.id } })) === sBefore, "§5.3b：候选 / 线索数未变（provider 调用数恒 0）");
    const { executeSupplierSearchRun } = await import("../discovery-service");
    await expectErr("RUN_MODE_MISMATCH", "§5.3c：服务层直接调发现流程也被拒", () => executeSupplierSearchRun(actorWriter, evRun.id, { finalize: true }));

    console.log("\n== T6–T10：证据 / 键的 fail-closed ==");
    const post = async (user: typeof writer, candidateId: string, body: unknown) =>
      matchesRoute.POST(await req(user, `/api/supplier-intel/candidates/${candidateId}/matches${q}`, { method: "POST", body }), P({ candidateId }));
    let r = await post(writer, cand.id, { requirementKey: "R-999", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] });
    ok(r.status === 422 && ((await r.json()) as { code?: string }).code === "REQUIREMENT_KEY_NOT_IN_SNAPSHOT", "T6：requirementKey 不在快照 → 422");
    r = await post(writer, cand.id, { requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certOtherSupplier.id }] });
    ok(r.status === 422 && ((await r.json()) as { code?: string }).code === "CERT_SUPPLIER_MISMATCH", "T7：他家供应商的证书 → 422");
    r = await post(writer, cand.id, { requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "signal", signalId: sigLoose.id }] });
    ok(r.status === 422 && ((await r.json()) as { code?: string }).code === "SIGNAL_NOT_LINKED_TO_SUPPLIER", "T9：未关联线索 → 422");
    r = await post(writer, cand.id, { requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "archive", archiveItemId: archA.id }] });
    ok(r.status === 422 && ((await r.json()) as { code?: string }).code === "ARCHIVE_PROJECT_MISMATCH", "T10：其它项目的档案 → 422");
    r = await post(writer, cand.id, { requirementKey: "R-001", verdict: "PASS", evidence: [] });
    ok(r.status === 422 && ((await r.json()) as { code?: string }).code === "EVIDENCE_REQUIRED", "§18：PASS 无证据不能保存");
    r = await post(writer, cand.id, { requirementKey: "R-001", verdict: "LIKELY_PASS", evidence: [{ kind: "note", snippet: "x" }] });
    ok(r.status === 400 || r.status === 422, "§8：词表外 verdict（LIKELY_PASS）拒收", `实际 ${r.status}`);
    r = await post(writer, cand.id, { requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }], evaluatedBy: "DETERMINISTIC" });
    ok(r.status === 201 && ((await r.json()) as { match: { evaluatedBy: string } }).match.evaluatedBy === "HUMAN", "§30：客户端声明 evaluatedBy 无效，人工入口恒 HUMAN");
    ok((await db.supplierCandidate.count({ where: { searchRunId: evRun.id } })) === 1, "T6–T10 期间没有多余写入");

    console.log("\n== T15：缺 Match → INCOMPLETE ==");
    let g = await evalRun.computeCandidateMandatoryGate(actorWriter, cand.id);
    ok(g.snapshot.result === "INCOMPLETE" && g.recommendation === "NEEDS_VERIFICATION", "T15a：R-002 缺 Match → INCOMPLETE + NEEDS_VERIFICATION");
    ok(g.snapshot.items.find((i) => i.requirementKey === "R-002")?.reasonCode === "MANDATORY_MATCH_MISSING", "T15b：原因码 MANDATORY_MATCH_MISSING");
    const candRow1 = await db.supplierCandidate.findUniqueOrThrow({ where: { id: cand.id } });
    ok(candRow1.mandatoryGateResult === "INCOMPLETE" && candRow1.recommendation === "NEEDS_VERIFICATION" && candRow1.mandatoryGateJson !== null, "§23：门快照落在 SupplierCandidate.mandatoryGateJson");

    console.log("\n== T11/T22/T27：确定性 PASS + 人工 PASS → 门 PASS；价格 UNKNOWN 不导致 NOT_ELIGIBLE ==");
    r = await post(writer, cand.id, { requirementKey: "R-002", applyDeterministic: true });
    const detBody = (await r.json()) as { match?: { verdict: string; evaluatedBy: string }; ruleId?: string };
    ok(r.status === 201 && detBody.match?.verdict === "PASS" && detBody.match?.evaluatedBy === "DETERMINISTIC" && detBody.ruleId === "NUMERIC_THRESHOLD_V2", "G6：600 lb ≥ 300 lb 规则判 PASS（DETERMINISTIC）", JSON.stringify(detBody));
    r = await post(writer, cand.id, { requirementKey: "R-003", verdict: "FAIL", evidence: [{ kind: "note", snippet: "非强制项：不是网布" }] });
    ok(r.status === 201, "T17 前置：非强制项写 FAIL");
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, cand.id);
    ok(g.snapshot.result === "PASS", "T11：全部 mandatory PASS 且可采信 → 门 PASS", JSON.stringify(g.snapshot.items));
    ok(g.recommendation === null && g.rejectionReason === null, "§25：门 PASS 不产生任何最终推荐");
    ok(!g.snapshot.items.some((i) => i.requirementKey === "R-003"), "T17：非强制项 FAIL 不进门、不触发 FAIL");
    ok(candRow1.offeringSnapshotJson && (candRow1.offeringSnapshotJson as { priceStatus?: string }).priceStatus === "UNKNOWN", "T27a：该候选价格 UNKNOWN");
    ok((await db.supplierCandidate.findUniqueOrThrow({ where: { id: cand.id } })).recommendation === null, "T27b：价格 UNKNOWN 不自动 NOT_ELIGIBLE");
    const g2 = await evalRun.computeCandidateMandatoryGate(actorWriter, cand.id);
    ok(JSON.stringify({ ...g.snapshot, computedAt: 0 }) === JSON.stringify({ ...g2.snapshot, computedAt: 0 }), "§46：重复计算同结果（幂等），候选只有一份门快照");
    ok(Boolean(await db.auditLog.findFirst({ where: { action: "supplier_intel.mandatory_gate.computed", targetId: cand.id } })), "§47：audit mandatory_gate.computed");
    {
      const matchIds = (await db.supplierRequirementMatch.findMany({ where: { candidateId: cand.id }, select: { id: true } })).map((m) => m.id);
      const auditRows = await db.auditLog.findMany({ where: { action: "supplier_intel.requirement_match.created", orgId: org.id, targetId: { in: matchIds } }, select: { id: true } });
      ok(auditRows.length === matchIds.length && matchIds.length >= 2, "§47：每条 Match 都有 requirement_match.created 审计", `${auditRows.length}/${matchIds.length}`);
    }

    console.log("\n== §45：并发——Match 写入与门计算串行，不出现「门 PASS 但 mandatory 正在写入」==");
    {
      const cres = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
      const c2 = cres.candidate;
      const results = await Promise.allSettled([
        evalRun.computeCandidateMandatoryGate(actorWriter, c2.id),
        evalRun.recordEvaluationMatch(actorWriter, { candidateId: c2.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] }),
        evalRun.computeCandidateMandatoryGate(actorWriter, c2.id),
        evalRun.applyDeterministicMatch(actorWriter, { candidateId: c2.id, requirementKey: "R-002" }),
        evalRun.computeCandidateMandatoryGate(actorWriter, c2.id),
      ]);
      ok(results.every((x) => x.status === "fulfilled"), "并发 a：五个并发操作都完成，无死锁", results.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason)).join(" | "));
      const stored = await db.supplierCandidate.findUniqueOrThrow({ where: { id: c2.id } });
      const recomputed = await evalRun.computeCandidateMandatoryGate(actorWriter, c2.id);
      const storedJson = stored.mandatoryGateJson as { result: string; items: unknown[] };
      const rank = { FAIL: 0, INCOMPLETE: 1, PASS: 2 } as Record<string, number>;
      ok(stored.mandatoryGateResult === "PENDING" || rank[storedJson.result] <= rank[recomputed.snapshot.result], "并发 b：存的门要么 PENDING（Match 写在门之后并使其失效），要么不比最终 Match 集更乐观", `${stored.mandatoryGateResult} vs ${recomputed.snapshot.result}`);
      ok(recomputed.snapshot.result === "PASS", "并发 c：最终重算为 PASS");
      await evalRun.completeEvaluationRun(actorWriter, cres.run.id);
    }

    console.log("\n== T12/T18/T19：mandatory FAIL → NOT_ELIGIBLE；最低价、历史合作都绕不过 ==");
    const histRun = await runSvc.createSearchRun(actorWriter, { projectId: projB.id, brief: { k: 2 }, requirements: SEED_B.map((r) => ({ id: `y-${r.code}`, code: r.code, text: r.en, category: r.cat, mandatory: r.mandatory })), sourceConfig: {} });
    await runSvc.startSearchRun(actorWriter, histRun.id);
    await evalSvc.createSupplierCandidate(actorWriter, { searchRunId: histRun.id, supplierId: supplier.id, originSource: "HISTORICAL_SUCCESS" });
    await runSvc.completeSearchRun(actorWriter, histRun.id, { status: "ran", sources: {} });
    const failRun = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offB.id });
    const candB = failRun.candidate;
    ok(candB.originSource === "HISTORICAL_SUCCESS", "T19a：originSource 继承自本项目历史候选（服务端推导）", candB.originSource);
    ok((candB.offeringSnapshotJson as { unitPrice?: string }).unitPrice === "50", "T18a：这是最低价候选（50 CNY，已冻结）");
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: candB.id, requirementKey: "R-001", verdict: "UNKNOWN", evidence: [] });
    const detB = await evalRun.applyDeterministicMatch(actorWriter, { candidateId: candB.id, requirementKey: "R-002" });
    ok(detB.match.verdict === "FAIL", "G7：250 lb < 300 lb 规则判 FAIL");
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, candB.id);
    ok(g.snapshot.result === "FAIL" && g.recommendation === "NOT_ELIGIBLE", "T12：mandatory FAIL → 门 FAIL + NOT_ELIGIBLE");
    ok(g.rejectionReason === "R-002:MANDATORY_MATCH_FAIL", "§25：rejectionReason 是确定性原因码", g.rejectionReason ?? "null");
    ok(g.snapshot.result === "FAIL", "§22：FAIL 与 UNKNOWN（R-001）并存 → FAIL 优先");
    ok(true, "T18b：最低价 + mandatory FAIL → NOT_ELIGIBLE（同上）");
    ok(true, "T19b：历史合作 + mandatory FAIL → NOT_ELIGIBLE（同上）");
    const candBRow = await db.supplierCandidate.findUniqueOrThrow({ where: { id: candB.id } });
    ok(candBRow.totalScore === null && candBRow.technicalScore === null && candBRow.commercialScore === null && candBRow.reliabilityScore === null && candBRow.importRiskScore === null && candBRow.scoreBreakdownJson === null, "T28：评分字段全部 null");

    console.log("\n== T13/T14/T20/T21/T23：UNKNOWN / PARTIAL / 社媒 / CLAIMED / 过期 都不能硬门 PASS ==");
    const mk2 = async (offeringId: string | null, projectId = projB.id) => (await evalRun.createProjectEvaluationRun(actorWriter, { projectId, supplierId: supplier.id, offeringId })).candidate;
    let c = await mk2(offA.id);
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: c.id, requirementKey: "R-001", verdict: "UNKNOWN", evidence: [] });
    await evalRun.applyDeterministicMatch(actorWriter, { candidateId: c.id, requirementKey: "R-002" });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, c.id);
    ok(g.snapshot.result === "INCOMPLETE" && g.recommendation === "NEEDS_VERIFICATION", "T13：UNKNOWN → INCOMPLETE + NEEDS_VERIFICATION");
    c = await mk2(offA.id);
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: c.id, requirementKey: "R-001", verdict: "PARTIAL", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] });
    await evalRun.applyDeterministicMatch(actorWriter, { candidateId: c.id, requirementKey: "R-002" });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, c.id);
    ok(g.snapshot.result === "INCOMPLETE" && g.snapshot.items[0].reasonCode === "MANDATORY_MATCH_PARTIAL", "T14：PARTIAL → INCOMPLETE");
    c = await mk2(offA.id);
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: c.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "signal", signalId: sigLinked.id, snippet: "厂家自述 BIFMA certified" }] });
    await evalRun.applyDeterministicMatch(actorWriter, { candidateId: c.id, requirementKey: "R-002" });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, c.id);
    ok(g.snapshot.result === "INCOMPLETE" && g.snapshot.items[0].reasonCode === "EVIDENCE_NOT_VERIFIED", "T20/G5：社媒自述作为 PASS 证据 → 不可采信（INCOMPLETE）");
    c = await mk2(offA.id);
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: c.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaClaimed.id }] });
    await evalRun.applyDeterministicMatch(actorWriter, { candidateId: c.id, requirementKey: "R-002" });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, c.id);
    ok(g.snapshot.result === "INCOMPLETE" && g.snapshot.items[0].reasonCode === "CERT_NOT_VERIFIED", "T21/G2：CLAIMED 证书 → 不可采信（CERT_NOT_VERIFIED）");
    c = await mk2(offA.id, projA.id);
    const detUl = await evalRun.applyDeterministicMatch(actorWriter, { candidateId: c.id, requirementKey: "R-006" });
    ok(detUl.match.verdict === "UNKNOWN", "G3a：过期 UL 规则判 UNKNOWN（不是 PASS，也不是 FAIL）");
    const cH = await mk2(offA.id, projA.id);
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: cH.id, requirementKey: "R-006", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certUlExpired.id }] });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, cH.id);
    ok(g.snapshot.items.find((i) => i.requirementKey === "R-006")?.reasonCode === "CERT_EXPIRED_AT_EVALUATION", "T23/G3b：人工 PASS + 过期证书 → CERT_EXPIRED_AT_EVALUATION");
    ok(g.snapshot.items.find((i) => i.requirementKey === "R-005")?.reasonCode === "MANDATORY_MATCH_MISSING", "T16 前置：uncertain 且未判定 → 先报缺 Match");
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: cH.id, requirementKey: "R-005", verdict: "PASS", evidence: [{ kind: "archive", archiveItemId: archA.id }] });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, cH.id);
    ok(g.snapshot.items.find((i) => i.requirementKey === "R-005")?.reasonCode === "MANDATORY_STATUS_UNCERTAIN" && g.snapshot.result === "INCOMPLETE" && g.recommendation === "NEEDS_VERIFICATION", "T16/G9：mandatoryUncertain + 可采信 PASS → 仍 INCOMPLETE + NEEDS_VERIFICATION");
    c = await mk2(offB.id);
    r = await post(writer, c.id, { requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] });
    ok(r.status === 422 && ((await r.json()) as { code?: string }).code === "CERT_SCOPE_MISMATCH", "T8/G4：Offering A 的产品级证书不能支撑 Offering B 的候选（写入即拒）");
    c = await mk2(null);
    await evalRun.recordEvaluationMatch(actorWriter, { candidateId: c.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "archive", archiveItemId: archB.id }] });
    g = await evalRun.computeCandidateMandatoryGate(actorWriter, c.id);
    ok(g.snapshot.items.find((i) => i.requirementKey === "R-001")?.reasonCode === "OFFERING_REQUIRED", "§6.1：产品类要求 + 无 Offering → OFFERING_REQUIRED");
    ok(g.snapshot.result === "INCOMPLETE", "§6.1b：整体 INCOMPLETE");

    console.log("\n== FR3：新增 Match 必须在同一事务里使已算的门失效 ==");
    {
      // G2（人工写入使门失效）：先规则判 R-002 → 算门 INCOMPLETE（R-001 缺）→ 人工写 R-001 PASS → 门必须立刻 PENDING
      const fr = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
      await evalRun.applyDeterministicMatch(actorWriter, { candidateId: fr.candidate.id, requirementKey: "R-002" });
      let gg = await evalRun.computeCandidateMandatoryGate(actorWriter, fr.candidate.id);
      ok(gg.snapshot.result === "INCOMPLETE", "FR3-G2a：R-001 缺 → INCOMPLETE");
      await evalRun.recordEvaluationMatch(actorWriter, { candidateId: fr.candidate.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] });
      let row = await db.supplierCandidate.findUniqueOrThrow({ where: { id: fr.candidate.id } });
      ok(row.mandatoryGateResult === "PENDING" && row.mandatoryGateJson === null && row.recommendation === null && row.rejectionReason === null, "FR3-G2b：人工 Match 写入后候选立刻 PENDING、门快照 / 推荐 / 原因清空", `${row.mandatoryGateResult} json=${row.mandatoryGateJson === null} rec=${row.recommendation}`);
      await expectErr("GATE_PENDING", "FR3-G2c：门失效 → 不能收口", () => evalRun.completeEvaluationRun(actorWriter, fr.run.id));
      gg = await evalRun.computeCandidateMandatoryGate(actorWriter, fr.candidate.id);
      ok(gg.snapshot.result === "PASS" && gg.recommendation === null, "FR3-G2d：重算 → PASS，推荐 null");
      const done2 = await evalRun.completeEvaluationRun(actorWriter, fr.run.id);
      ok(done2.status === "COMPLETED", "FR3-G2e：重算后可以收口");
      // 收口后再写 Match：终态守卫先拦（T24），门不会被动
      row = await db.supplierCandidate.findUniqueOrThrow({ where: { id: fr.candidate.id } });
      ok(row.mandatoryGateResult === "PASS", "FR3-G2f：收口后门保持 PASS");

      // G1（规则写入使门失效 → 重算 FAIL）：人工 R-001 UNKNOWN → 算门 INCOMPLETE → 规则写 R-002（250 lb → FAIL）→ PENDING → 重算 FAIL/NOT_ELIGIBLE
      const fr1 = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offB.id });
      await evalRun.recordEvaluationMatch(actorWriter, { candidateId: fr1.candidate.id, requirementKey: "R-001", verdict: "UNKNOWN", evidence: [] });
      gg = await evalRun.computeCandidateMandatoryGate(actorWriter, fr1.candidate.id);
      ok(gg.snapshot.result === "INCOMPLETE" && gg.recommendation === "NEEDS_VERIFICATION", "FR3-G1a：R-002 缺 → INCOMPLETE + NEEDS_VERIFICATION");
      const detF = await evalRun.applyDeterministicMatch(actorWriter, { candidateId: fr1.candidate.id, requirementKey: "R-002" });
      ok(detF.match.verdict === "FAIL", "FR3-G1b：规则判 R-002 FAIL");
      row = await db.supplierCandidate.findUniqueOrThrow({ where: { id: fr1.candidate.id } });
      ok(row.mandatoryGateResult === "PENDING" && row.mandatoryGateJson === null && row.recommendation === null, "FR3-G3：规则（DETERMINISTIC）写入同样使门失效 → PENDING");
      await expectErr("GATE_PENDING", "FR3-G1c：收口被拒", () => evalRun.completeEvaluationRun(actorWriter, fr1.run.id));
      gg = await evalRun.computeCandidateMandatoryGate(actorWriter, fr1.candidate.id);
      ok(gg.snapshot.result === "FAIL" && gg.recommendation === "NOT_ELIGIBLE" && gg.rejectionReason === "R-002:MANDATORY_MATCH_FAIL", "FR3-G1d：重算 → FAIL + NOT_ELIGIBLE");
      const auditInv = await db.auditLog.findFirst({ where: { action: "supplier_intel.requirement_match.created", targetId: detF.match.id } });
      ok(Boolean(auditInv), "FR3：Match 审计存在（afterData 含 previousGateResult / gateInvalidated）");

      // G4（并发）：门计算 vs 新 Match 写入，无论谁先拿到 Run 锁，最终状态都不能是「门对应旧 Match 集且 != PENDING」
      let sawGateFirst = 0, sawMatchFirst = 0;
      for (let i = 0; i < 3; i++) {
        const cr = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
        await evalRun.applyDeterministicMatch(actorWriter, { candidateId: cr.candidate.id, requirementKey: "R-002" });
        const rs = await Promise.allSettled([
          evalRun.computeCandidateMandatoryGate(actorWriter, cr.candidate.id),
          evalRun.recordEvaluationMatch(actorWriter, { candidateId: cr.candidate.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] }),
        ]);
        ok(rs.every((x) => x.status === "fulfilled"), `FR3-G4-${i}a：门计算与 Match 写入并发都完成`, rs.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason)).join(" | "));
        const st = await db.supplierCandidate.findUniqueOrThrow({ where: { id: cr.candidate.id } });
        const gj = st.mandatoryGateJson as { items?: Array<{ requirementKey: string; matchId: string | null }> } | null;
        const gateSawMatch = Boolean(gj?.items?.find((it) => it.requirementKey === "R-001")?.matchId);
        if (st.mandatoryGateResult === "PENDING") sawGateFirst += 1;
        else if (gateSawMatch) sawMatchFirst += 1;
        ok(st.mandatoryGateResult === "PENDING" || gateSawMatch, `FR3-G4-${i}b：要么门已被置 PENDING（门先、Match 后），要么门包含该 Match（Match 先、门后）`, `${st.mandatoryGateResult} sawMatch=${gateSawMatch}`);
        await evalRun.computeCandidateMandatoryGate(actorWriter, cr.candidate.id);
        const fin = await db.supplierCandidate.findUniqueOrThrow({ where: { id: cr.candidate.id } });
        ok(fin.mandatoryGateResult === "PASS", `FR3-G4-${i}c：重算后 PASS`);
      }
      ok(true, `FR3-G4：观察到 gate-first=${sawGateFirst} match-first=${sawMatchFirst}（两种顺序都合法）`);
      // G4-alt：把 Match 先启动、门随后。Match 在进事务前还要读候选 / 校验证据 / 冻结证书快照，
      // 所以「谁先拿到 Run 锁」并不由启动顺序决定——这里断言的是不变量本身：
      // 终态要么 PENDING 且无快照（门先、Match 后使其失效），要么 PASS 且门含该 Match（Match 先）。
      // 绝不允许「门 != PENDING 且不含最新 Match」。
      {
        const cr = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
        await evalRun.applyDeterministicMatch(actorWriter, { candidateId: cr.candidate.id, requirementKey: "R-002" });
        const pMatch = evalRun.recordEvaluationMatch(actorWriter, { candidateId: cr.candidate.id, requirementKey: "R-001", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certBifmaA.id }] });
        await new Promise((r) => setTimeout(r, 1500));
        const pGate = evalRun.computeCandidateMandatoryGate(actorWriter, cr.candidate.id);
        const rs = await Promise.allSettled([pMatch, pGate]);
        ok(rs.every((x) => x.status === "fulfilled"), "FR3-G4-alt-a：Match 先起、门后起，都完成", rs.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason)).join(" | "));
        const st = await db.supplierCandidate.findUniqueOrThrow({ where: { id: cr.candidate.id } });
        const gj = st.mandatoryGateJson as { items?: Array<{ requirementKey: string; matchId: string | null }> } | null;
        const gateSawMatch = Boolean(gj?.items?.find((it) => it.requirementKey === "R-001")?.matchId);
        const gateFirst = st.mandatoryGateResult === "PENDING" && st.mandatoryGateJson === null && st.recommendation === null;
        const matchFirst = st.mandatoryGateResult === "PASS" && gateSawMatch;
        ok(gateFirst || matchFirst, `FR3-G4-alt-b：终态合法（${gateFirst ? "门先→已置 PENDING 无快照" : matchFirst ? "Match 先→门含该 Match→PASS" : "非法：陈旧门"}）`, `${st.mandatoryGateResult} sawMatch=${gateSawMatch} json=${st.mandatoryGateJson === null ? "null" : "set"}`);
        const stale = st.mandatoryGateResult !== "PENDING" && !gateSawMatch;
        ok(!stale, "FR3-G4-alt-c：不存在「门 != PENDING 且不含最新 Match」的陈旧终态");
      }
    }

    console.log("\n== T24/T25/T26：收口后不可变；历史不随 live 数据漂移 ==");
    const rid = evRun.id;
    const completeRes = await completeRoute.POST(await req(writer, `/api/supplier-intel/runs/${rid}/complete${q}`, { method: "POST" }), P({ id: rid }));
    ok(completeRes.status === 200, "§28：全部门已算 → 收口 COMPLETED", `实际 ${completeRes.status} ${await completeRes.clone().text()}`);
    const beforeCand = await db.supplierCandidate.findUniqueOrThrow({ where: { id: cand.id }, include: { matches: true } });
    // T24 必须在一个「该键此前没有 Match」的已收口 Run 上写——否则 409 可能只是撞了
    // (candidateId, requirementKey) 的 unique（负向控制 N3 抓出的掩盖），证明不了终态守卫。
    const t24 = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
    await evalRun.computeCandidateMandatoryGate(actorWriter, t24.candidate.id);
    await evalRun.completeEvaluationRun(actorWriter, t24.run.id);
    r = await post(writer, t24.candidate.id, { requirementKey: "R-001", verdict: "UNKNOWN", evidence: [] });
    const t24Body = (await r.json()) as { code?: string };
    ok(r.status === 409 && t24Body.code === "RUN_NOT_RUNNING", "T24：终态后写 Match → 409 RUN_NOT_RUNNING（该键此前无 Match）", `实际 ${r.status} ${t24Body.code}`);
    ok((await db.supplierRequirementMatch.count({ where: { candidateId: t24.candidate.id } })) === 0, "T24b：没有写入任何 Match");
    const gr = await gateRoute.POST(await req(writer, `/api/supplier-intel/candidates/${cand.id}/mandatory-gate${q}`, { method: "POST" }), P({ candidateId: cand.id }));
    ok(gr.status === 409 && ((await gr.json()) as { code?: string }).code === "RUN_IMMUTABLE", "T25：终态后重算门 → 409 RUN_IMMUTABLE", `实际 ${gr.status}`);
    await db.supplier.update({ where: { id: supplier.id }, data: { name: `改名后 ${tag}` } });
    await db.supplierOffering.update({ where: { id: offA.id }, data: { attributesJson: { 承重: "100 lb" }, unitPrice: 999, priceStatus: "KNOWN" } });
    await db.supplierCertification.update({ where: { id: certBifmaA.id }, data: { status: "EXPIRED", expiresAt: PAST } });
    await seedAnalysis(projB.id, [...SEED_B, { code: "R-009", mandatory: true, en: "New mandatory requirement added later.", zh: "后加的强制项。", cat: "technical" }], "s4a_b2");
    const afterCand = await db.supplierCandidate.findUniqueOrThrow({ where: { id: cand.id }, include: { matches: true } });
    ok(JSON.stringify(afterCand.supplierSnapshotJson) === JSON.stringify(beforeCand.supplierSnapshotJson), "T26a：供应商快照不变（live 改名无关）");
    ok(JSON.stringify(afterCand.offeringSnapshotJson) === JSON.stringify(beforeCand.offeringSnapshotJson), "T26b：offering 快照不变（live 属性/价格无关）");
    ok(JSON.stringify(afterCand.matches.map((m) => m.evidenceJson)) === JSON.stringify(beforeCand.matches.map((m) => m.evidenceJson)), "T26c：Match evidenceJson 不变（证书后来 EXPIRED 无关）");
    ok(JSON.stringify(afterCand.mandatoryGateJson) === JSON.stringify(beforeCand.mandatoryGateJson) && afterCand.mandatoryGateResult === "PASS" && afterCand.recommendation === null, "T26d：门快照 / 结果 / 推荐不变");
    const newEval = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
    const newSnap = newEval.run.requirementSnapshotJson as Array<{ code: string }>;
    ok(newSnap.some((s) => s.code === "R-009"), "T26e：新评估运行才反映新的 canonical 需求");
    ok((newEval.candidate.offeringSnapshotJson as { attributes?: { 承重?: string } })?.attributes?.承重 === "100 lb", "T26f：新评估运行冻结的是新的 offering 数据");
    const newDet = await evalRun.applyDeterministicMatch(actorWriter, { candidateId: newEval.candidate.id, requirementKey: "R-002" });
    ok(newDet.match.verdict === "FAIL", "T26g：新数据下规则判 FAIL（100 lb < 300 lb）——历史 PASS 与新 FAIL 并存，各自可回放");

    console.log("\n== §28：收口前置条件 ==");
    const pendingRun = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
    await expectErr("GATE_PENDING", "§28a：门未算 → 不能收口", () => evalRun.completeEvaluationRun(actorWriter, pendingRun.run.id));
    await evalRun.computeCandidateMandatoryGate(actorWriter, pendingRun.candidate.id);
    const done = await evalRun.completeEvaluationRun(actorWriter, pendingRun.run.id);
    ok(done.status === "COMPLETED" && (done.statusDetailJson as { status?: string })?.status === "evaluated", "§28b：门已算 → COMPLETED，statusDetail 记录 gates");
    await expectErr("RUN_IMMUTABLE", "§28c：重复收口被拒", () => evalRun.completeEvaluationRun(actorWriter, pendingRun.run.id));

    console.log("\n== §31/§32：ACL——项目级决策 ==");
    let a = await evaluationsRoute.POST(await req(viewer, `/api/supplier-intel/projects/${projB.id}/evaluations${q}`, { method: "POST", body: { supplierId: supplier.id, offeringId: offA.id } }), P({ projectId: projB.id }));
    ok(a.status === 403, "ACL a：项目只读成员不能创建评估运行（403）", `实际 ${a.status}`);
    a = await evaluationsRoute.POST(await req(outsider, `/api/supplier-intel/projects/${projB.id}/evaluations${q}`, { method: "POST", body: { supplierId: supplier.id, offeringId: offA.id } }), P({ projectId: projB.id }));
    ok(a.status === 403 || a.status === 404, "ACL b：org 成员无项目角色不能创建（供应商可编辑 ≠ 可评估任意项目）", `实际 ${a.status}`);
    const openRun = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier.id, offeringId: offA.id });
    a = await matchesRoute.POST(await req(viewer, `/api/supplier-intel/candidates/${openRun.candidate.id}/matches${q}`, { method: "POST", body: { requirementKey: "R-001", verdict: "UNKNOWN", evidence: [] } }), P({ candidateId: openRun.candidate.id }));
    ok(a.status === 403, "ACL c：只读成员不能写 Match", `实际 ${a.status}`);
    a = await gateRoute.POST(await req(viewer, `/api/supplier-intel/candidates/${openRun.candidate.id}/mandatory-gate${q}`, { method: "POST" }), P({ candidateId: openRun.candidate.id }));
    ok(a.status === 403, "ACL d：只读成员不能算门", `实际 ${a.status}`);
    a = await completeRoute.POST(await req(viewer, `/api/supplier-intel/runs/${openRun.run.id}/complete${q}`, { method: "POST" }), P({ id: openRun.run.id }));
    ok(a.status === 403, "ACL e：只读成员不能收口", `实际 ${a.status}`);
    a = await viewRoute.GET(await req(viewer, `/api/supplier-intel/runs/${openRun.run.id}/evaluation${q}`), P({ id: openRun.run.id }));
    const vb = (await a.json()) as { view?: { canWrite: boolean; candidates: Array<{ requirements: Array<{ entry: { code: string } }> }> } };
    ok(a.status === 200 && vb.view?.canWrite === false, "ACL f：只读成员可读视图，canWrite=false");
    ok((vb.view?.candidates[0]?.requirements.length ?? 0) === (openRun.run.requirementSnapshotJson as unknown[]).length, "视图：逐条要求与本 Run 的快照条数一致", `${vb.view?.candidates[0]?.requirements.length} vs ${(openRun.run.requirementSnapshotJson as unknown[]).length}`);
    const oq = `?orgId=${otherOrg.id}`;
    a = await viewRoute.GET(await req(stranger, `/api/supplier-intel/runs/${openRun.run.id}/evaluation${oq}`), P({ id: openRun.run.id }));
    ok(a.status === 404 && !(await a.text()).includes(supplier.name), "ACL g：他组织 → 404 零业务内容");
    const runsBeforeStranger = await db.supplierSearchRun.count({ where: { projectId: projB.id } });
    a = await evaluationsRoute.POST(await req(stranger, `/api/supplier-intel/projects/${projB.id}/evaluations${oq}`, { method: "POST", body: { supplierId: foreignSupplier.id } }), P({ projectId: projB.id }));
    ok(a.status === 403 || a.status === 404, "ACL h：他组织对本项目建评估被拒（canonical 项目门）", `实际 ${a.status}`);
    ok((await db.supplierSearchRun.count({ where: { projectId: projB.id } })) === runsBeforeStranger, "ACL h2：没有产生任何评估运行");
    await expectErr("NOT_FOUND", "ACL i：服务层跨 org 供应商 → NOT_FOUND", () => evalRun.createProjectEvaluationRun(actorOwner, { projectId: projB.id, supplierId: foreignSupplier.id }));

    console.log("\n== §6.2：来源无法证明 → fail closed ==");
    await expectErr("ORIGIN_SOURCE_UNRESOLVED", "supplier2 既未被搜到也无已关联线索 → 不能开始评估", () => evalRun.createProjectEvaluationRun(actorWriter, { projectId: projB.id, supplierId: supplier2.id }));
    ok((await db.supplierSearchRun.count({ where: { orgId: org.id, projectId: projB.id, status: "FAILED" } })) === 0, "来源判定在建 Run 之前，不留下 FAILED 残骸");

    console.log("\n== 列表：评估运行可按供应商过滤，且带门结果 ==");
    const lr = await evaluationsRoute.GET(await req(writer, `/api/supplier-intel/projects/${projB.id}/evaluations${q}&supplierId=${supplier.id}`), P({ projectId: projB.id }));
    const lb = (await lr.json()) as { runs: Array<{ id: string; candidates: Array<{ mandatoryGateResult: string; recommendation: string | null }> }> };
    ok(lr.status === 200 && lb.runs.some((x) => x.id === failRun.run.id && x.candidates[0]?.recommendation === "NOT_ELIGIBLE"), "列表包含 NOT_ELIGIBLE 的那次评估");
    ok(!lb.runs.some((x) => x.id === disc.id), "列表不含发现 Run");

    console.log(`\nS4-A 断言：${pass} 通过 / ${fail} 失败`);
  } finally {
    await db.supplierRequirementMatch.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCertification.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplier.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.tenderArchiveItem.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    const runs = await db.tenderAnalysisRun.findMany({ where: { orgId: { in: cleanupOrgs } }, select: { id: true } });
    const rids = runs.map((x) => x.id);
    await db.tenderAnalysisSection.deleteMany({ where: { runId: { in: rids } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { analysisRunId: { in: rids } } });
    await db.tenderAnalysisRun.deleteMany({ where: { id: { in: rids } } });
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

main().catch((e) => { console.error(e); process.exit(1); });
