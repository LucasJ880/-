/**
 * S4-B：正式评分收口 + 项目级当前推荐 + 赛马 + 找厂优先级 —— 服务 + HTTP 集成（隔离库执行，否则跳过）。
 * 覆盖任务书 §63 S1–S3、§65 C7/C8、§66 R1/R3/R4、§67 I2/I5、§69 Q1–Q7、§70/§71 绕不过硬门、
 * §51/§52 1688 例子、§56 并发、§57 不变性、§58 审计、§59/§60 ACL、§16 零网络。
 * 「厂家」「报价」「证书」全部是合成夹具。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) { console.log("⏭  跳过 S4-B DB 测试（未提供 DATABASE_URL）"); process.exit(0); }
  if (process.env.NODE_ENV !== "test") { console.log("⏭  跳过 S4-B DB 测试（需 NODE_ENV=test）"); process.exit(0); }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") { console.log("⏭  跳过 S4-B DB 测试（需 DATABASE_ENVIRONMENT=isolated）"); process.exit(0); }
  assertSafeTestDatabase({ scriptName: "supplier-intel s4b scoring" });
}

let pass = 0; let fail = 0;
function ok(cond: boolean, name: string, detail?: string) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  requireIsolatedTestDb();
  process.env.SUPPLIER_INTEL_ENABLED = process.env.SUPPLIER_INTEL_ENABLED || "1";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "s4b-db-test-secret";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const evalRun = await import("../evaluation-run-service");
  const signalSvc = await import("../signal-service");
  const rankingSvc = await import("../project-supplier-ranking");
  const runSvc = await import("../run-service");
  const capVerify = await import("../capability-verification-service");
  const { buildCanonicalRisksStructuredJson } = await import("./fixtures/canonical-risks-writer");
  const { createSession } = await import("@/lib/auth/session");
  const rankingRoute = await import("@/app/api/supplier-intel/projects/[projectId]/ranking/route");
  const signalsRoute = await import("@/app/api/supplier-intel/signals/route");
  const completeRoute = await import("@/app/api/supplier-intel/runs/[id]/complete/route");
  const capRoute = await import("@/app/api/supplier-intel/suppliers/[supplierId]/capability-signals/[capabilityId]/route");

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try { await fn(); ok(false, `${name}（期望抛 ${code}，实际成功）`); }
    catch (e) { if (isSupplierIntelError(e, code as never)) ok(true, name); else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e)); }
  }

  const tag = `s4b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mk = (slug: string) => db.user.create({ data: { email: `${slug}_${tag}@test.qingyan.local`, name: slug, role: "user", status: "active" } });
  const owner = await mk("s4b_owner"); const writer = await mk("s4b_writer"); const viewer = await mk("s4b_viewer"); const outsider = await mk("s4b_outsider");
  const org = await db.organization.create({ data: { name: `S4B Org ${tag}`, code: `s4b_${tag}`, ownerId: owner.id, status: "active" } });
  await db.organizationMember.createMany({ data: [
    { orgId: org.id, userId: owner.id, role: "org_admin", status: "active" },
    { orgId: org.id, userId: writer.id, role: "org_member", status: "active" },
    { orgId: org.id, userId: viewer.id, role: "org_member", status: "active" },
    { orgId: org.id, userId: outsider.id, role: "org_member", status: "active" },
  ] });
  const mkProject = (name: string) => db.project.create({ data: { orgId: org.id, name: `${name} ${tag}`, ownerId: owner.id, workDomain: "tender", intakeStatus: "dispatched", status: "active" } });
  const proj = await mkProject("S4B 当前项目"); const hist1 = await mkProject("S4B 历史项目1"); const hist2 = await mkProject("S4B 历史项目2"); const other = await mkProject("S4B 无关项目"); const hidden = await mkProject("S4B writer 看不见的项目");
  for (const p of [proj, hist1, hist2]) {
    await db.projectMember.createMany({ data: [
      { projectId: p.id, userId: writer.id, role: "project_admin", status: "active" },
      { projectId: p.id, userId: viewer.id, role: "viewer", status: "active" },
    ] });
  }
  await db.projectMember.create({ data: { projectId: other.id, userId: writer.id, role: "project_admin", status: "active" } });

  type Spec = { code: string; mandatory: true | false | "uncertain"; en: string; zh: string; cat: string };
  const SEED: Spec[] = [
    { code: "R-001", mandatory: true, en: "Chairs shall be certified to ANSI/BIFMA X5.1.", zh: "须通过 BIFMA 认证。", cat: "safety" },
    { code: "R-002", mandatory: true, en: "Minimum weight capacity 300 lb.", zh: "最小承重 300 磅。", cat: "technical" },
    { code: "R-003", mandatory: false, en: "Mesh back preferred.", zh: "优先网布。", cat: "product" },
    { code: "R-004", mandatory: false, en: "Delivery DDP to Regina.", zh: "DDP 交付。", cat: "delivery" },
  ];
  const analysis = await db.tenderAnalysisRun.create({ data: { orgId: org.id, projectId: proj.id, status: "APPROVED", idempotencyKey: `s4b_${tag}`, sourceHashFingerprint: "s4b", summaryJson: { criticalFacts: {} } } });
  for (const r of SEED) await db.tenderExtractedRequirement.create({ data: { projectId: proj.id, analysisRunId: analysis.id, requirementCode: r.code, category: r.cat, originalRequirement: r.en, chineseTranslation: r.zh, mandatory: r.mandatory === true } });
  await db.tenderAnalysisSection.create({ data: { runId: analysis.id, sectionKey: "RISKS", contentZh: "x", structuredJson: buildCanonicalRisksStructuredJson(SEED.map((r) => ({ code: r.code, mandatory: r.mandatory, statement: r.en }))) as never } });

  // 供应商：A = 1688 便宜挂牌价、无 RFQ；B = 历史供应商、正式 RFQ、全证据；C = 最低正式价但门 FAIL；D = 新供应商无历史
  const mkSup = (name: string) => db.supplier.create({ data: { orgId: org.id, name: `${name} ${tag}`, createdById: owner.id } });
  const supA = await mkSup("S4B 1688 厂家 A"); const supB = await mkSup("S4B 历史供应商 B"); const supC = await mkSup("S4B 便宜但不合规 C"); const supD = await mkSup("S4B 新供应商 D");
  const arch = await db.tenderArchiveItem.create({ data: { orgId: org.id, projectId: proj.id, kind: "other", captureKey: `upload:s4b-${tag}`, capturedAt: new Date(), captureMethod: "upload", mimeType: "application/pdf", fileSize: 1, contentHash: `s4b_${tag}`, storageKey: `archive/${org.id}/s4b/${tag}`, createdById: owner.id } });
  const archHidden = await db.tenderArchiveItem.create({ data: { orgId: org.id, projectId: hidden.id, kind: "other", captureKey: `upload:s4b-hidden-${tag}`, capturedAt: new Date(), captureMethod: "upload", mimeType: "application/pdf", fileSize: 1, contentHash: `s4b_h_${tag}`, storageKey: `archive/${org.id}/s4b/h_${tag}`, createdById: owner.id } });
  const actorWriter = { orgId: org.id, userId: writer.id }; const actorViewer = { orgId: org.id, userId: viewer.id }; const actorOutsider = { orgId: org.id, userId: outsider.id };

  // 本项目先有过一次发现 Run（Brief 快照 = 找厂优先级的词源；真实链路里线索来自它）
  const disc = await runSvc.createSearchRun(actorWriter, { projectId: proj.id, brief: { productKeywords: ["办公椅", "网布椅"], productCategory: "办公家具", commercialSearchTermsZh: ["办公椅厂家"], capabilitySearchTermsZh: ["OEM"], searchTermsEn: ["office chair"] }, requirements: SEED.map((r) => ({ id: `d-${r.code}`, code: r.code, text: r.en, category: r.cat, mandatory: r.mandatory })), sourceConfig: { adapters: [] } });
  await runSvc.startSearchRun(actorWriter, disc.id); await runSvc.completeSearchRun(actorWriter, disc.id, { status: "skipped", sources: {} });

  // 线索（含 ONE688 平台线索 + 低信息线索）并关联
  const link = async (supplierId: string, rawText: string, url: string) => {
    const s = await signalSvc.createSubmittedSignal(actorWriter, { url, rawText, manualEntry: true, projectId: proj.id });
    await signalSvc.reviewSignal(actorWriter, s.id); await signalSvc.linkSignalToSupplier(actorWriter, s.id, { supplierId });
    return s;
  };
  const sigA = await link(supA.id, `${tag} 办公椅 网布椅 源头工厂 OEM 出口 加拿大 UL certified 挂牌价 ¥80`, `https://detail.1688.com/offer/${tag}.html`);
  const sigB = await link(supB.id, `${tag} 老供应商 办公椅`, `https://b.example/${tag}`);
  const sigC = await link(supC.id, `${tag} 便宜椅子`, `https://c.example/${tag}`);
  const sigD = await link(supD.id, `${tag} 新厂 办公椅 网布椅 厂家`, `https://d.example/${tag}`);
  await db.supplierDiscoverySignal.update({ where: { id: sigA.id }, data: { platform: "ONE688", title: "办公椅 网布椅 源头工厂 OEM 出口加拿大", description: "UL certified 厂家直销 ¥80" } });

  // 报盘：A 来自 1688 线索（挂牌价 80 CNY）；B/C/D 人工
  const offA = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supA.id, name: "1688 网布椅", sku: "A-1688", attributesJson: { 承重: "600 lb" }, unitPrice: 80, currency: "CNY", priceStatus: "KNOWN", sourceKind: "DISCOVERY", sourceUrl: `https://detail.1688.com/offer/${tag}.html`, sourceSignalId: sigA.id, leadTimeDays: 30, incoterm: "FOB", createdByUserId: owner.id } });
  const offB = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supB.id, name: "B 网布椅", sku: "B-1", attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 45, incoterm: "DDP", createdByUserId: owner.id } });
  const offC = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supC.id, name: "C 经济椅", sku: "C-1", attributesJson: { 承重: "250 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 20, incoterm: "FOB", createdByUserId: owner.id } });
  const offD = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supD.id, name: "D 网布椅", sku: "D-1", attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 40, incoterm: "FOB", createdByUserId: owner.id } });
  const FUTURE = new Date("2030-01-01T00:00:00.000Z");
  const mkCert = (supplierId: string, offeringId: string) => db.supplierCertification.create({ data: { orgId: org.id, supplierId, scope: "PRODUCT", offeringId, certificationType: "BIFMA", status: "VERIFIED", sourceKind: "USER_ENTRY", expiresAt: FUTURE, verifiedByUserId: owner.id, verifiedAt: new Date() } as never });
  const certA = await mkCert(supA.id, offA.id); const certB = await mkCert(supB.id, offB.id); const certC = await mkCert(supC.id, offC.id); const certD = await mkCert(supD.id, offD.id);

  // 历史询价（别项目）：B 两次联系两次回复一次入选；D 无；A 无；C 有很强历史（§71）
  const mkInquiry = async (projectId: string, round: number, items: Array<{ supplierId: string; status: string; sent?: boolean; replied?: boolean; unit?: number; total?: number; currency?: string; days?: number; validUntil?: Date; selected?: boolean }>) => {
    const inq = await db.projectInquiry.create({ data: { projectId, roundNumber: round, title: `round ${round}`, scope: "chairs", status: "in_progress", createdById: owner.id } });
    for (const it of items) await db.inquiryItem.create({ data: { inquiryId: inq.id, supplierId: it.supplierId, status: it.status, sentAt: it.sent ? new Date("2026-01-01") : null, repliedAt: it.replied ? new Date("2026-01-05") : null, unitPrice: it.unit ?? null, totalPrice: it.total ?? null, currency: it.currency ?? "CAD", deliveryDays: it.days ?? null, validUntil: it.validUntil ?? null, isSelected: it.selected ?? false, createdById: owner.id } });
    return inq;
  };
  await mkInquiry(hist1.id, 1, [{ supplierId: supB.id, status: "quoted", sent: true, replied: true, total: 1000, selected: true }, { supplierId: supC.id, status: "quoted", sent: true, replied: true, total: 900, selected: false }]);
  await mkInquiry(hist2.id, 1, [{ supplierId: supB.id, status: "quoted", sent: true, replied: true, total: 1100, selected: false }, { supplierId: supC.id, status: "quoted", sent: true, replied: true, total: 950, selected: true }]);
  await mkInquiry(hist2.id, 2, [{ supplierId: supC.id, status: "quoted", sent: true, replied: true, total: 940, selected: true }]);
  // 当前项目 RFQ round 1：B 与 C 正式报价（C 最低）；A / D 未询价
  const round1 = await mkInquiry(proj.id, 1, [
    { supplierId: supB.id, status: "quoted", sent: true, replied: true, total: 110000, currency: "CAD", days: 60, validUntil: new Date("2026-12-01") },
    { supplierId: supC.id, status: "quoted", sent: true, replied: true, total: 90000, currency: "CAD", days: 40, validUntil: new Date("2026-12-01") },
  ]);
  // 无关项目的报价：不能成为当前项目的可比组
  await mkInquiry(other.id, 1, [{ supplierId: supA.id, status: "quoted", sent: true, replied: true, total: 50000, currency: "CAD" }, { supplierId: supB.id, status: "quoted", sent: true, replied: true, total: 60000, currency: "CAD" }]);

  async function req(user: { id: string; email: string }, url: string, init?: { method?: string; body?: unknown }) {
    const token = await createSession({ sub: user.id, email: user.email, role: "user" });
    return new NextRequest(`http://localhost${url}`, { method: init?.method ?? "GET", headers: { cookie: `qy_session=${token}`, "content-type": "application/json" }, ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  }
  const P = (o: Record<string, string>) => ({ params: Promise.resolve(o) });
  const q = `?orgId=${org.id}`;
  const cand = (id: string) => db.supplierCandidate.findUniqueOrThrow({ where: { id } });
  const itemOf = async (inquiryId: string, supplierId: string) => (await db.inquiryItem.findFirstOrThrow({ where: { inquiryId, supplierId }, select: { id: true } })).id;
  const evaluate = async (supplierId: string, offeringId: string, verdicts: Record<string, "PASS" | "FAIL" | "UNKNOWN">, certId: string, commercialInquiryItemId: string | null = null) => {
    const r = await evalRun.createProjectEvaluationRun(actorWriter, { projectId: proj.id, supplierId, offeringId, commercialInquiryItemId });
    for (const [key, v] of Object.entries(verdicts)) {
      if (key === "R-002") await evalRun.applyDeterministicMatch(actorWriter, { candidateId: r.candidate.id, requirementKey: key });
      else await evalRun.recordEvaluationMatch(actorWriter, { candidateId: r.candidate.id, requirementKey: key, verdict: v, evidence: v === "UNKNOWN" ? [] : [{ kind: "certification", certificationId: certId }] });
    }
    await evalRun.computeCandidateMandatoryGate(actorWriter, r.candidate.id);
    return r;
  };

  // §16 零网络：整个套件把 fetch 换成炸弹——评分 / 收口 / 排名任何一处外呼都会红
  const realFetch = globalThis.fetch; let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("NETWORK_CALL_DURING_SCORING"); }) as typeof fetch;

  const cleanupOrgs = [org.id]; const cleanupUsers = [owner.id, writer.id, viewer.id, outsider.id];
  try {
    console.log("\n== 能力核验：唯一 VERIFIED 写路径（人工 + 档案证据）==");
    const capClaimedA = await signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigA.id, type: "CANADA_EXPORT", value: "1688 文案：出口加拿大", evidenceStatus: "CLAIMED", confidence: null, explanation: null, extractedBy: "HUMAN" });
    const capB = await signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigB.id, type: "CANADA_EXPORT", value: "出口加拿大", evidenceStatus: "CLAIMED", confidence: null, explanation: null, extractedBy: "HUMAN" });
    const capBpack = await signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigB.id, type: "EXPORT_PACKAGING", value: "出口包装", evidenceStatus: "OBSERVED", confidence: null, explanation: null, extractedBy: "HUMAN" });
    const capC = await signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigC.id, type: "CANADA_EXPORT", value: "x", evidenceStatus: "CLAIMED", confidence: null, explanation: null, extractedBy: "HUMAN" });
    const capD = await signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigD.id, type: "CANADA_EXPORT", value: "x", evidenceStatus: "CLAIMED", confidence: null, explanation: null, extractedBy: "HUMAN" });
    await expectErr("CAPABILITY_VERIFY_REQUIRES_EVIDENCE", "V1：无档案证据不能 VERIFIED", () => capVerify.verifyCapabilitySignal(actorWriter, capB.id, { archiveItemId: "" }));
    await expectErr("ARCHIVE_EVIDENCE_NOT_FOUND", "V2：看不见的项目里的档案不能当证据（有线索写权限也不行）", () => capVerify.verifyCapabilitySignal(actorWriter, capB.id, { archiveItemId: archHidden.id }));
    await expectErr("PROJECT_ACCESS_DENIED", "V2b：只读成员没有线索写权限，不能核验", () => capVerify.verifyCapabilitySignal(actorViewer, capB.id, { archiveItemId: arch.id }));
    await expectErr("PROJECT_ACCESS_DENIED", "V3：无项目写权限不能核验", () => capVerify.verifyCapabilitySignal(actorOutsider, capB.id, { archiveItemId: arch.id }));
    let vr = await capRoute.PATCH(await req(writer, `/api/supplier-intel/suppliers/${supA.id}/capability-signals/${capB.id}${q}`, { method: "PATCH", body: { action: "verify", archiveItemId: arch.id } }), P({ supplierId: supA.id, capabilityId: capB.id }));
    ok(vr.status === 404, "V4：借 A 的页面核验 B 的能力 → 404", `实际 ${vr.status}`);
    vr = await capRoute.PATCH(await req(writer, `/api/supplier-intel/suppliers/${supB.id}/capability-signals/${capB.id}${q}`, { method: "PATCH", body: { action: "verify", archiveItemId: arch.id, note: "海关出口记录" } }), P({ supplierId: supB.id, capabilityId: capB.id }));
    ok(vr.status === 200 && ((await vr.json()) as { capability: { evidenceStatus: string } }).capability.evidenceStatus === "VERIFIED", "V5：人工 + 档案 → VERIFIED（HTTP）", `实际 ${vr.status}`);
    await capVerify.verifyCapabilitySignal(actorWriter, capBpack.id, { archiveItemId: arch.id });
    await capVerify.verifyCapabilitySignal(actorWriter, capC.id, { archiveItemId: arch.id });
    await capVerify.verifyCapabilitySignal(actorWriter, capD.id, { archiveItemId: arch.id });
    ok(Boolean(await db.auditLog.findFirst({ where: { action: "supplier_intel.capability.verified", targetId: capB.id } })), "V6：审计 capability.verified");
    await expectErr("SOCIAL_VERIFIED_WRITE_BLOCKED", "V7：social 写路径仍然产不出 VERIFIED", () => signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigA.id, type: "OVERSEAS_EXPORT", value: null, evidenceStatus: "VERIFIED", confidence: null, explanation: null, extractedBy: "HUMAN" }));

    console.log("\n== 找厂优先级（signals GET 带 projectId 逐条标注；≠ 评分）==");
    const sr = await signalsRoute.GET(await req(writer, `/api/supplier-intel/signals${q}&projectId=${proj.id}&take=50`));
    const sb = (await sr.json()) as { signals: Array<{ id: string; platform: string; discoveryPriority: { bucket: string; total: number; reasons: { factoryTermsMatched: string[] } } | null }> };
    const pA = sb.signals.find((s) => s.id === sigA.id)?.discoveryPriority; const pB = sb.signals.find((s) => s.id === sigB.id)?.discoveryPriority;
    ok(sr.status === 200 && Boolean(pA) && Boolean(pB), "DP1：项目上下文下每条线索带 discoveryPriority", `${sr.status} ${JSON.stringify(pA)}`);
    ok((pA?.total ?? 0) > (pB?.total ?? 0) && (pA?.reasons.factoryTermsMatched.length ?? 0) > 0, "DP2：1688 线索（厂家 / OEM / 出口文本命中）优先级高于低信息线索", `${pA?.total} vs ${pB?.total}`);
    const srNoProj = await signalsRoute.GET(await req(writer, `/api/supplier-intel/signals${q}&take=50`));
    ok(!((await srNoProj.json()) as { signals: Array<{ discoveryPriority?: unknown }> }).signals.some((s) => s.discoveryPriority), "DP3：无项目上下文不标注（不猜 Brief）");
    ok((await db.supplierCandidate.count({ where: { orgId: org.id } })) === 0, "DP4：找厂优先级不写任何候选评分列（此时还没有候选）");

    console.log("\n== S1 / §70：便宜但门 FAIL → NOT_ELIGIBLE，评分列全 null，不计算正式评分 ==");
    const runC = await evaluate(supC.id, offC.id, { "R-001": "PASS", "R-002": "PASS" }, certC.id); // R-002 规则：250 lb < 300 → FAIL
    ok((await cand(runC.candidate.id)).mandatoryGateResult === "FAIL", "C 门 FAIL（250 lb < 300 lb）");
    await evalRun.completeEvaluationRun(actorWriter, runC.run.id);
    const cRow = await cand(runC.candidate.id);
    ok(cRow.recommendation === "NOT_ELIGIBLE" && cRow.totalScore === null && cRow.technicalScore === null && cRow.commercialScore === null && cRow.reliabilityScore === null && cRow.importRiskScore === null, "S1a：NOT_ELIGIBLE + 四维与总分全 null");
    const cBd = cRow.scoreBreakdownJson as { gateResult: string; commercial: unknown; reasonCodes: string[]; rankable: boolean };
    ok(cBd.gateResult === "FAIL" && cBd.commercial === null && cBd.reasonCodes.includes("GATE_FAIL") && cBd.rankable === false, "S1b / §70：门 FAIL 连组件都不算（最低正式价也救不了）");
    ok(cRow.rejectionReason === "R-002:MANDATORY_MATCH_FAIL", "S1c：rejectionReason 保持门给的确定性原因");

    console.log("\n== S2：门 INCOMPLETE → NEEDS_VERIFICATION，官方总分 null ==");
    const runDinc = await evaluate(supD.id, offD.id, { "R-002": "PASS" }, certD.id); // R-001 缺
    await evalRun.completeEvaluationRun(actorWriter, runDinc.run.id);
    const dIncRow = await cand(runDinc.candidate.id);
    ok(dIncRow.mandatoryGateResult === "INCOMPLETE" && dIncRow.recommendation === "NEEDS_VERIFICATION" && dIncRow.totalScore === null, "S2：INCOMPLETE → NEEDS_VERIFICATION，总分 null");

    console.log("\n== S3 / §51：A（1688 挂牌价 ¥80、门 PASS、无 RFQ）→ Commercial UNKNOWN → NEEDS_VERIFICATION，不可 PRIMARY ==");
    const runA = await evaluate(supA.id, offA.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certA.id);
    ok((await cand(runA.candidate.id)).mandatoryGateResult === "PASS", "A 门 PASS");
    const cr = await completeRoute.POST(await req(writer, `/api/supplier-intel/runs/${runA.run.id}/complete${q}`, { method: "POST", body: {} }), P({ id: runA.run.id }));
    ok(cr.status === 200, "A 收口（HTTP）200", `实际 ${cr.status} ${await cr.clone().text()}`);
    const aRow = await cand(runA.candidate.id);
    const aBd = aRow.scoreBreakdownJson as { commercial: { priceEvidenceTier: string; score: number | null; reasonCodes: string[]; offeringPriceEvidence: { listedPrice: string | null; sourceSignalPlatform: string | null } }; technical: { score: number | null }; importRisk: { score: number | null; reasonCodes: string[] }; reliability: { score: number | null }; officialTotalScore: number | null; normalizedKnownScore: number | null; unknownComponents: string[]; recommendation: string | null; reasonCodes: string[] };
    ok(aBd.commercial.priceEvidenceTier === "PLATFORM_LISTED" && aBd.commercial.score === null && aBd.commercial.reasonCodes.includes("COMMERCIAL_PLATFORM_LISTED_ONLY"), "§11 / §25：1688 挂牌价 = PLATFORM_LISTED，不产生正式 Commercial Score", JSON.stringify(aBd.commercial));
    ok(aBd.commercial.offeringPriceEvidence.listedPrice === "80" && aBd.commercial.offeringPriceEvidence.sourceSignalPlatform === "ONE688", "§74：挂牌价与来源平台冻结在快照里（历史挂牌证据保留）");
    ok(aBd.technical.score === 100 && aRow.technicalScore === 100, "A 技术分 100（R-001 safety / R-002 technical / R-003 product 全 PASS；R-004 delivery 不进分母）");
    ok(aBd.importRisk.score === null && aBd.importRisk.reasonCodes.includes("EXPORT_CLAIMED_ONLY"), "I3 / I4：1688 文案「出口加拿大」= CLAIMED → 进口准备度 null");
    ok(aBd.reliability.score === null, "R1：A 无内部历史 → 可靠性 null");
    ok(aRow.totalScore === null && aBd.officialTotalScore === null && aBd.normalizedKnownScore === 100, "P2：只知道技术 100 → 归一化分 100 只是分析值，官方总分 null");
    ok(aRow.recommendation === "NEEDS_VERIFICATION" && aBd.unknownComponents.join(",") === "commercial,reliability,importRisk", "§51：A → NEEDS_VERIFICATION（不可 PRIMARY）");
    ok(Boolean(await db.auditLog.findFirst({ where: { action: "supplier_intel.score.computed", targetId: runA.candidate.id } })) && Boolean(await db.auditLog.findFirst({ where: { action: "supplier_intel.evaluation.finalized", targetId: runA.run.id } })), "§58：审计 score.computed + evaluation.finalized");

    console.log("\n== B（历史供应商、正式 RFQ、VERIFIED 出口能力）→ 四维齐全 → 官方总分 → 可排名 ==");
    const itemB1 = await itemOf(round1.id, supB.id);
    const runB = await evaluate(supB.id, offB.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certB.id, itemB1);
    const runBcfg = (await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runB.run.id } })).sourceConfigJson as { commercialEvidenceBinding?: { inquiryItemId: string; offeringId: string; supplierId: string; confirmedByUserId: string; roundNumber: number } };
    ok(runBcfg.commercialEvidenceBinding?.inquiryItemId === itemB1 && runBcfg.commercialEvidenceBinding.offeringId === offB.id && runBcfg.commercialEvidenceBinding.supplierId === supB.id && runBcfg.commercialEvidenceBinding.confirmedByUserId === writer.id && runBcfg.commercialEvidenceBinding.roundNumber === 1, "FR1-F：绑定服务端重验后冻结进 sourceConfigJson.commercialEvidenceBinding（全部服务端读取）");
    await evalRun.completeEvaluationRun(actorWriter, runB.run.id);
    const bRow = await cand(runB.candidate.id);
    const bBd = bRow.scoreBreakdownJson as { commercial: { priceEvidenceTier: string; score: number | null; round: { roundNumber: number } | null; comparableGroup: Array<{ supplierId: string }>; sub: { price: number | null; delivery: number } }; reliability: { score: number | null; contacted: number; replied: number; selected: number; history: Array<{ projectId: string }> }; importRisk: { score: number | null; verified: Array<{ type: string }> }; contract: { totalScore: number | null; knownWeightShare: number }; officialTotalScore: number | null; recommendation: string | null; rankable: boolean };
    ok(bBd.commercial.priceEvidenceTier === "RFQ_CONFIRMED" && bBd.commercial.round?.roundNumber === 1 && bBd.commercial.comparableGroup.length === 2, "C1 / §22：绑定 round 1 → 可比组 = {B, C}（同轮两家已确认）", JSON.stringify(bBd.commercial));
    ok((bBd.commercial as { binding?: { inquiryItemId: string; status: string } }).binding?.inquiryItemId === itemB1 && (bBd.commercial as { binding?: { status: string } }).binding?.status === "BOUND_CONFIRMED" && (bBd.commercial as { candidate?: { itemId: string } }).candidate?.itemId === itemB1, "FR1：候选自己那条 = 绑定的 item（按 id）");
    ok(bBd.commercial.sub.price === Math.round((90000 / 110000) * 10000) / 100, "C3：B 价格分 = 最低 90000 / 110000 × 100", String(bBd.commercial.sub.price));
    ok(!bBd.commercial.comparableGroup.some((g) => g.supplierId === supA.id), "§60：无关项目里 A 的报价不进入当前可比组");
    ok(bBd.reliability.contacted === 3 && bBd.reliability.replied === 3 && bBd.reliability.selected === 1 && bBd.reliability.score === 85, "R2：B 别项目（含无关项目）3 次联系 3 次回复 1 次入选 → 0.7×100 + 0.3×50 = 85；当前项目自己的询价不算", JSON.stringify({ c: bBd.reliability.contacted, r: bBd.reliability.replied, s: bBd.reliability.selected, score: bBd.reliability.score }));
    ok(!bBd.reliability.history.some((h) => h.projectId === proj.id), "R2b：历史里没有当前项目的询价（不自己给自己制造历史）");
    ok(bBd.importRisk.score === 100 && bBd.importRisk.verified.map((v) => v.type).sort().join(",") === "CANADA_EXPORT,EXPORT_PACKAGING", "I2：CANADA_EXPORT + 包装 VERIFIED、DDP、交期已知 → 100");
    ok(bRow.technicalScore === 100 && bRow.commercialScore === bBd.commercial.score && bRow.reliabilityScore === 85 && bRow.importRiskScore === 100, "§40：四个组件落列");
    const { computeSupplierScore } = await import("../score-contract");
    const expectTotal = computeSupplierScore({ technical: 100, commercial: bBd.commercial.score, reliability: 85, importRisk: 100 }).totalScore;
    ok(bRow.totalScore === expectTotal && bBd.officialTotalScore === expectTotal && bBd.contract.knownWeightShare === 1, "P1 / §38：官方总分 == computeSupplierScore（唯一加权实现）", `${bRow.totalScore} vs ${expectTotal}`);
    ok(bRow.recommendation === null && bBd.rankable === true, "§41：四维齐全且无重大风险 → 候选不写 PRIMARY/BACKUP（read-model 派生），rankable=true");
    ok(bRow.scoreVersion === "supplier-score-v1", "版本 supplier-score-v1 冻结");

    console.log("\n== §71：C 历史很强但门 FAIL → 仍 NOT_ELIGIBLE（已在 S1 覆盖；这里确认历史确实很强）==");
    const { computeReliabilityScore } = await import("../score-components");
    const cHist = await db.inquiryItem.findMany({ where: { supplierId: supC.id, inquiry: { is: { projectId: { not: proj.id } } } }, include: { inquiry: { select: { projectId: true } } } });
    const cRel = computeReliabilityScore({ currentProjectId: proj.id, history: cHist.map((h) => ({ itemId: h.id, projectId: h.inquiry.projectId, status: h.status, sentAt: h.sentAt?.toISOString() ?? null, repliedAt: h.repliedAt?.toISOString() ?? null, isSelected: h.isSelected })) });
    ok(cRel.score === 100 && (await cand(runC.candidate.id)).recommendation === "NOT_ELIGIBLE", "§71：C 可靠性会是 100，但门 FAIL → NOT_ELIGIBLE 不变");

    console.log("\n== §43–§46：项目级当前排名（read-model）==");
    let view = await rankingSvc.loadProjectSupplierRanking(actorWriter, proj.id);
    ok(view.sections.PRIMARY.length === 1 && view.sections.PRIMARY[0].supplierId === supB.id && view.sections.PRIMARY[0].rank === 1, "Q5：B = PRIMARY（唯一四维齐全）");
    ok(view.sections.NEEDS_VERIFICATION.some((r) => r.supplierId === supA.id) && view.sections.NEEDS_VERIFICATION.some((r) => r.supplierId === supD.id), "Q2：A（1688 无 RFQ）与 D（门 INCOMPLETE）在 NEEDS VERIFICATION");
    ok(view.sections.NOT_ELIGIBLE.some((r) => r.supplierId === supC.id), "Q1：C 在 NOT ELIGIBLE");
    ok(!view.ranked.some((r) => r.supplierId === supA.id && r.rank !== null), "§51：A 没有名次——挂牌价再便宜也不 PRIMARY");
    const racingA = view.racing.find((r) => r.supplierId === supA.id);
    ok(racingA?.discoveryPriority?.bucket === "P1" && racingA.section === "NEEDS_VERIFICATION" && racingA.rfq === "NONE" && racingA.nextAction.label === "向厂家正式询价", "§49 / §50：赛马表 A：找厂优先级 P1 ≠ PRIMARY；下一步 = 向厂家正式询价", JSON.stringify(racingA));
    const racingB = view.racing.find((r) => r.supplierId === supB.id);
    ok(racingB?.state === "SCORED" && racingB.currentRank === 1 && racingB.rfq === "CONFIRMED", "赛马表 B：SCORED / #1 / 已报价");
    const racingC = view.racing.find((r) => r.supplierId === supC.id);
    ok(racingC?.state === "NOT_ELIGIBLE" && racingC.nextAction.code === "NOT_ELIGIBLE", "赛马表 C：NOT_ELIGIBLE");
    const rr = await rankingRoute.GET(await req(viewer, `/api/supplier-intel/projects/${proj.id}/ranking${q}`), P({ projectId: proj.id }));
    ok(rr.status === 200 && ((await rr.json()) as { view: { sections: { PRIMARY: unknown[] } } }).view.sections.PRIMARY.length === 1, "§59：只读成员可读排名（HTTP 200）");
    const rrOut = await rankingRoute.GET(await req(outsider, `/api/supplier-intel/projects/${proj.id}/ranking${q}`), P({ projectId: proj.id }));
    ok(rrOut.status === 403 || rrOut.status === 404, "§59：无项目权限成员 → 403/404", `实际 ${rrOut.status}`);

    console.log("\n== §52 / C7 / C8：A 正式回复 RFQ → 新 Run 才有 Commercial；旧 Run 不漂移 ==");
    const aOld = JSON.stringify(await cand(runA.candidate.id));
    const itemA1 = (await db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId: supA.id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), totalPrice: 80000, currency: "CAD", deliveryDays: 35, validUntil: new Date("2026-12-01"), createdById: owner.id } })).id;
    ok(JSON.stringify(await cand(runA.candidate.id)) === aOld, "C8 / §57：新报价进来，旧 Run 的候选一字不变");
    const runAunbound = await evaluate(supA.id, offA.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certA.id, null);
    await evalRun.completeEvaluationRun(actorWriter, runAunbound.run.id);
    const aUnb = (await cand(runAunbound.candidate.id)).scoreBreakdownJson as { commercial: { priceEvidenceTier: string; score: number | null; reasonCodes: string[] } };
    ok(aUnb.commercial.priceEvidenceTier === "PLATFORM_LISTED" && aUnb.commercial.score === null && aUnb.commercial.reasonCodes.includes("COMMERCIAL_NO_CONFIRMED_RFQ"), "FR1 §9：项目里已有 A 的正式报价，但评估没绑定 → 不自动 RFQ_CONFIRMED，Commercial 仍 null", JSON.stringify(aUnb.commercial));
    const runA2 = await evaluate(supA.id, offA.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certA.id, itemA1);
    await evalRun.completeEvaluationRun(actorWriter, runA2.run.id);
    const a2Row = await cand(runA2.candidate.id);
    const a2Bd = a2Row.scoreBreakdownJson as { commercial: { priceEvidenceTier: string; score: number | null; sub: { price: number | null } }; recommendation: string | null; unknownComponents: string[] };
    ok(a2Bd.commercial.priceEvidenceTier === "RFQ_CONFIRMED" && a2Bd.commercial.sub.price === 100 && a2Row.commercialScore !== null, "C7 / §52：新 Run：RFQ_CONFIRMED，A 最低正式价 → 价格分 100（正式报价覆盖挂牌价）", JSON.stringify(a2Bd.commercial));
    ok(a2Row.recommendation === "NEEDS_VERIFICATION" && a2Bd.unknownComponents.join(",") === "reliability,importRisk", "A 仍缺可靠性 / 进口准备度 → 仍 NEEDS_VERIFICATION（不因价格最低进排名）");
    view = await rankingSvc.loadProjectSupplierRanking(actorWriter, proj.id);
    ok(view.sections.PRIMARY[0]?.supplierId === supB.id && !view.ranked.some((r) => r.supplierId === supA.id && r.rank !== null), "§51 终态：A 正式最低价 ¥80000 < B ¥110000 仍不 PRIMARY（可靠性 / 出口未证）");
    const racingA2 = view.racing.find((r) => r.supplierId === supA.id);
    ok(racingA2?.runId === runA2.run.id && racingA2.nextAction.code === "BUILD_HISTORY", "赛马表取最新 COMPLETED 评估；下一步 = 新供应商需要更多交互");

    console.log("\n== Q4–Q7：第二家四维齐全（D 核验出口 + 补历史 + RFQ）→ PRIMARY / BACKUP 动态变化，旧候选不改写 ==");
    await mkInquiry(hist1.id, 2, [{ supplierId: supD.id, status: "quoted", sent: true, replied: true, total: 500 }]);
    await mkInquiry(hist2.id, 3, [{ supplierId: supD.id, status: "quoted", sent: true, replied: true, total: 520 }]);
    const itemD1 = (await db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId: supD.id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), totalPrice: 95000, currency: "CAD", deliveryDays: 50, validUntil: new Date("2026-12-01"), createdById: owner.id } })).id;
    const bBefore = JSON.stringify(await cand(runB.candidate.id));
    const runD = await evaluate(supD.id, offD.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certD.id, itemD1);
    await evalRun.completeEvaluationRun(actorWriter, runD.run.id);
    const dRow = await cand(runD.candidate.id);
    ok(dRow.totalScore !== null && dRow.recommendation === null, "D 四维齐全（可靠性 70 = 0.7×100 + 0.3×0）→ 可排名", JSON.stringify({ t: dRow.technicalScore, c: dRow.commercialScore, r: dRow.reliabilityScore, i: dRow.importRiskScore, total: dRow.totalScore, rec: dRow.recommendation }));
    ok(dRow.reliabilityScore === 70, "D 可靠性按公式（2/2 回复、0 入选 → 70）", String(dRow.reliabilityScore));
    view = await rankingSvc.loadProjectSupplierRanking(actorWriter, proj.id);
    const orderIds = view.ranked.filter((r) => r.rank !== null).map((r) => r.supplierId);
    const bTotal = (await cand(runB.candidate.id)).totalScore as number; const dTotal = dRow.totalScore as number;
    if (dRow.recommendation === "HIGH_RISK") {
      ok(view.sections.HIGH_RISK.some((r) => r.supplierId === supD.id) && !orderIds.includes(supD.id), "Q3：D 可靠性 < 40 → HIGH_RISK，永不 PRIMARY");
    } else {
      ok(orderIds.length === 2 && orderIds[0] === (bTotal >= dTotal ? supB.id : supD.id), "Q4 / Q6：两家 eligible 按 total 排序，#2 = BACKUP", `${orderIds.join(",")} B=${bTotal} D=${dTotal}`);
      ok(view.sections.BACKUP.length === 1 && view.sections.BACKUP[0].rank === 2, "Q6：BACKUP 带具体名次 #2");
    }
    ok(JSON.stringify(await cand(runB.candidate.id)) === bBefore, "Q7 / §42：新供应商完成评分后，B 的历史候选（含 recommendation）一字不变");
    ok(!(await db.supplierCandidate.findMany({ where: { orgId: org.id } })).some((c) => c.recommendation === "PRIMARY" || c.recommendation === "BACKUP"), "§42：数据库里永远没有 PRIMARY / BACKUP 落列");

    console.log("\n== §57 / I5：完成后改报价 / 能力 / 报盘，历史候选评分不变；重评估 = 新 Run ==");
    const bFrozen = JSON.stringify(await cand(runB.candidate.id));
    await db.inquiryItem.updateMany({ where: { inquiryId: round1.id, supplierId: supC.id }, data: { totalPrice: 10 } });
    await db.supplierCapabilitySignal.update({ where: { id: capB.id }, data: { evidenceStatus: "CLAIMED" } });
    await db.supplierOffering.update({ where: { id: offB.id }, data: { leadTimeDays: null, incoterm: null } });
    ok(JSON.stringify(await cand(runB.candidate.id)) === bFrozen, "§57：报价 / 能力 / 报盘变了，B 历史候选评分与快照一字不变");
    const runB2 = await evaluate(supB.id, offB.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certB.id, itemB1);
    await evalRun.completeEvaluationRun(actorWriter, runB2.run.id);
    const b2 = await cand(runB2.candidate.id);
    ok(b2.importRiskScore === 35 || b2.importRiskScore === null || (b2.importRiskScore as number) < 100, "I5：新 Run 反映新数据（出口能力回到 CLAIMED / 交期未知）", String(b2.importRiskScore));
    ok((await cand(runB.candidate.id)).totalScore === (JSON.parse(bFrozen) as { totalScore: number }).totalScore, "旧 Run 总分不变");

    console.log("\n== §56 并发：Match 写入 vs 评分收口共享 Run 锁；陈旧门不能被评分 ==");
    const runX = await evaluate(supB.id, offB.id, { "R-001": "PASS", "R-002": "PASS" }, certB.id);
    const rs = await Promise.allSettled([
      evalRun.completeEvaluationRun(actorWriter, runX.run.id),
      evalRun.recordEvaluationMatch(actorWriter, { candidateId: runX.candidate.id, requirementKey: "R-003", verdict: "PASS", evidence: [{ kind: "certification", certificationId: certB.id }] }),
    ]);
    const xRow = await cand(runX.candidate.id); const xRun = await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runX.run.id } });
    const completeOk = rs[0].status === "fulfilled"; const matchOk = rs[1].status === "fulfilled";
    ok((completeOk && !matchOk && xRun.status === "COMPLETED" && xRow.mandatoryGateResult === "PASS" && xRow.scoreBreakdownJson !== null) || (!completeOk && matchOk && xRun.status === "RUNNING" && xRow.mandatoryGateResult === "PENDING" && xRow.totalScore === null),
      "§56：要么收口先拿锁（Match 因终态被拒、评分对应门当时的 Match 集），要么 Match 先（门回 PENDING、收口因 GATE_PENDING 被拒、没有评分）",
      `complete=${completeOk} match=${matchOk} run=${xRun.status} gate=${xRow.mandatoryGateResult}`);
    ok(!(xRun.status === "COMPLETED" && xRow.mandatoryGateResult === "PENDING"), "§56：不存在「已收口但门 PENDING」");
    if (!completeOk) { const e = (rs[0] as PromiseRejectedResult).reason; ok(isSupplierIntelError(e, "GATE_PENDING" as never), "Match 先时收口错误码 = GATE_PENDING"); }

    console.log("\n== FR1 黄金测试：同一供应商两款 Offering，一张 RFQ ==");
    {
      const supT = await mkSup("S4B 两款产品厂 T");
      const sigT = await link(supT.id, `${tag} 两款产品 办公椅 厂家`, `https://t.example/${tag}`);
      void sigT;
      const offT1 = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supT.id, name: "T1 120V", sku: "T1", attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", createdByUserId: owner.id } });
      const offT2 = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supT.id, name: "T2 230V", sku: "T2", attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", createdByUserId: owner.id } });
      const certT1 = await mkCert(supT.id, offT1.id); const certT2 = await mkCert(supT.id, offT2.id);
      const q1 = (await db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId: supT.id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), totalPrice: 100000, currency: "CAD", deliveryDays: 45, validUntil: new Date("2026-12-01"), createdById: owner.id } })).id;
      const runT1 = await evaluate(supT.id, offT1.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certT1.id, q1);
      await evalRun.completeEvaluationRun(actorWriter, runT1.run.id);
      const t1 = await cand(runT1.candidate.id); const t1Bd = t1.scoreBreakdownJson as { commercial: { priceEvidenceTier: string; candidate: { itemId: string } | null } };
      ok(t1.commercialScore !== null && t1Bd.commercial.priceEvidenceTier === "RFQ_CONFIRMED" && t1Bd.commercial.candidate?.itemId === q1, "FR1-G1：T1 绑定 Q1 → Commercial 有分（按 Q1）", JSON.stringify({ c: t1.commercialScore, tier: t1Bd.commercial.priceEvidenceTier }));
      const runT2 = await evaluate(supT.id, offT2.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certT2.id, null);
      await evalRun.completeEvaluationRun(actorWriter, runT2.run.id);
      const t2 = await cand(runT2.candidate.id); const t2Bd = t2.scoreBreakdownJson as { commercial: { priceEvidenceTier: string; score: number | null; reasonCodes: string[]; round: unknown } };
      ok(t2.commercialScore === null && t2Bd.commercial.priceEvidenceTier !== "RFQ_CONFIRMED" && t2Bd.commercial.round === null && t2Bd.commercial.reasonCodes.includes("COMMERCIAL_NO_CONFIRMED_RFQ") && t2.recommendation === "NEEDS_VERIFICATION", "FR1-G2：T2 未绑定 → Commercial null + NEEDS_VERIFICATION（绝不复用 Q1）", JSON.stringify(t2Bd.commercial));
      // 拒绝：错供应商 / 错项目 / 未确认 / 无产品
      const qB = await itemOf(round1.id, supB.id);
      await expectErr("COMMERCIAL_EVIDENCE_BINDING_INVALID", "FR1-WS：绑定 B 的报价到 T 的评估 → 拒", () => evalRun.createProjectEvaluationRun(actorWriter, { projectId: proj.id, supplierId: supT.id, offeringId: offT1.id, commercialInquiryItemId: qB }));
      const otherInq = await db.projectInquiry.findFirstOrThrow({ where: { projectId: other.id } });
      const qOther = await itemOf(otherInq.id, supA.id);
      await expectErr("COMMERCIAL_EVIDENCE_BINDING_INVALID", "FR1-WP：其它项目的报价 → 拒", () => evalRun.createProjectEvaluationRun(actorWriter, { projectId: proj.id, supplierId: supA.id, offeringId: offA.id, commercialInquiryItemId: qOther }));
      // (inquiryId, supplierId) 唯一：未回复的报价放到第 2 轮
      const round2 = await mkInquiry(proj.id, 2, [{ supplierId: supT.id, status: "sent", sent: true, replied: false }]);
      const qSent2 = await itemOf(round2.id, supT.id);
      await expectErr("COMMERCIAL_EVIDENCE_BINDING_INVALID", "FR1-UC：已发送未回复的报价 → 拒（不能变成 RFQ_CONFIRMED）", () => evalRun.createProjectEvaluationRun(actorWriter, { projectId: proj.id, supplierId: supT.id, offeringId: offT1.id, commercialInquiryItemId: qSent2 }));
      await expectErr("COMMERCIAL_EVIDENCE_BINDING_INVALID", "FR1-NO：没有指定产品不能绑定报价", () => evalRun.createProjectEvaluationRun(actorWriter, { projectId: proj.id, supplierId: supT.id, offeringId: null, commercialInquiryItemId: q1 }));
      await expectErr("COMMERCIAL_EVIDENCE_BINDING_INVALID", "FR1-NX：不存在的报价 id → 拒", () => evalRun.createProjectEvaluationRun(actorWriter, { projectId: proj.id, supplierId: supT.id, offeringId: offT1.id, commercialInquiryItemId: "nope" }));
      ok((await db.supplierSearchRun.count({ where: { orgId: org.id, projectId: proj.id, status: "FAILED" } })) === 0, "FR1：绑定校验在建 Run 之前，不留下 FAILED 残骸");
      // 冻结：COMPLETED 之后 sourceConfig 不可改；绑定不随后来的报价变化
      await expectErr("RUN_IMMUTABLE", "FR1-FZ：COMPLETED Run 的工作数据 / 绑定不可改", () => runSvc.updateRunWorkingData(actorWriter, runT1.run.id, { statusDetail: { hacked: true } }));
      const cfgAfter = (await db.supplierSearchRun.findUniqueOrThrow({ where: { id: runT1.run.id } })).sourceConfigJson as { commercialEvidenceBinding?: { inquiryItemId: string } };
      ok(cfgAfter.commercialEvidenceBinding?.inquiryItemId === q1, "FR1-FZ2：绑定冻结不变");
      // 收口时绑定的报价已不再确认 → 不消费（fail closed），不报错
      const q3 = (await db.inquiryItem.create({ data: { inquiryId: round2.id, supplierId: supA.id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), totalPrice: 70000, currency: "CAD", createdById: owner.id } })).id;
      const runStale = await evaluate(supA.id, offA.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certA.id, q3);
      await db.inquiryItem.update({ where: { id: q3 }, data: { repliedAt: null, totalPrice: null, status: "sent" } });
      await evalRun.completeEvaluationRun(actorWriter, runStale.run.id);
      const st = (await cand(runStale.candidate.id)).scoreBreakdownJson as { commercial: { priceEvidenceTier: string; score: number | null; reasonCodes: string[]; binding: { status: string } | null } };
      ok(st.commercial.score === null && st.commercial.priceEvidenceTier !== "RFQ_CONFIRMED" && st.commercial.binding?.status === "BOUND_NOT_CONFIRMED" && st.commercial.reasonCodes.includes("COMMERCIAL_BINDING_NOT_CONFIRMED"), "FR1-ST：绑定的报价收口时已撤回 → 不消费、不 RFQ_CONFIRMED", JSON.stringify(st.commercial));
      // 列表选项：只列本项目该供应商的已确认报价（服务端算）
      const opts = await evalRun.listCommercialEvidenceOptions(actorViewer, proj.id, supT.id);
      ok(opts.length === 1 && opts[0].inquiryItemId === q1, "FR1-OP：绑定选项只含已确认报价（未回复的不在）", JSON.stringify(opts.map((o) => o.inquiryItemId)));
    }

    console.log("\n== FR2：跨项目 VERIFIED 能力不进正式分、不进赛马计数、不泄露 ==");
    {
      const actorOwner = { orgId: org.id, userId: owner.id };
      const supX = await mkSup("S4B 隐藏项目出口厂 X");
      const offX = await db.supplierOffering.create({ data: { orgId: org.id, supplierId: supX.id, name: "X 网布椅", sku: "X-1", attributesJson: { 承重: "600 lb" }, priceStatus: "UNKNOWN", sourceKind: "MANUAL", leadTimeDays: 30, incoterm: "FOB", createdByUserId: owner.id } });
      const sigXcur = await link(supX.id, `${tag} X 当前项目线索 办公椅`, `https://x-cur.example/${tag}`);
      const capXcurClaimed = await signalSvc.createCapabilitySignal(actorWriter, { discoverySignalId: sigXcur.id, type: "CANADA_EXPORT", value: "文案：出口加拿大", evidenceStatus: "CLAIMED", confidence: null, explanation: null, extractedBy: "HUMAN" });
      // 隐藏项目：owner 建（writer 无成员资格、intake 未派发 → writer 读不到）
      const sigXhidden = await signalSvc.createSubmittedSignal(actorOwner, { url: `https://x-hidden.example/${tag}`, rawText: `${tag} X 隐藏项目线索`, manualEntry: true, projectId: hidden.id });
      await signalSvc.reviewSignal(actorOwner, sigXhidden.id); await signalSvc.linkSignalToSupplier(actorOwner, sigXhidden.id, { supplierId: supX.id });
      const capXhidden = await db.supplierCapabilitySignal.create({ data: { orgId: org.id, discoverySignalId: sigXhidden.id, type: "CANADA_EXPORT", value: "隐藏项目已核验", evidenceStatus: "VERIFIED", extractedBy: "HUMAN", explanation: `[fixture] VERIFIED; archive=${archHidden.id}` } });
      await expectErr("PROJECT_ACCESS_DENIED", "FR2-前置：writer 确实读不到隐藏项目", async () => evalRun.loadEvaluationView(actorWriter, (await runSvc.createSearchRun(actorOwner, { projectId: hidden.id, brief: {}, requirements: [], sourceConfig: { runMode: "EVALUATION_ONLY" } })).id));
      // 赛马计数范围：X 此刻只有 隐藏项目 VERIFIED 能力 + 当前项目 CLAIMED（还没有证书）→ 必须是 OFFERING_READY，不是 EVIDENCE_READY
      const rowX0 = (await rankingSvc.loadProjectSupplierRanking(actorWriter, proj.id)).racing.find((r) => r.supplierId === supX.id);
      ok(rowX0?.state === "OFFERING_READY", "FR2-H5：赛马表不把隐藏项目的 VERIFIED 算成「已核验证据」（OFFERING_READY，非 EVIDENCE_READY）", JSON.stringify(rowX0));
      const certX = await mkCert(supX.id, offX.id);
      const runX = await evaluate(supX.id, offX.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certX.id, null);
      await evalRun.completeEvaluationRun(actorWriter, runX.run.id);
      const x = await cand(runX.candidate.id); const xBd = x.scoreBreakdownJson as { importRisk: { score: number | null; reasonCodes: string[]; verified: Array<{ id: string }>; unverified: Array<{ id: string; discoverySignalId: string | null }> }; provenance: { capabilityIds: string[] } };
      ok(x.importRiskScore === null && xBd.importRisk.score === null && xBd.importRisk.reasonCodes.includes("EXPORT_READINESS_UNVERIFIED") && xBd.importRisk.reasonCodes.includes("EXPORT_CLAIMED_ONLY"), "FR2-H1：隐藏项目的 VERIFIED CANADA_EXPORT 不进当前项目的进口准备度 → null", JSON.stringify(xBd.importRisk));
      ok(xBd.importRisk.verified.length === 0 && !JSON.stringify(x.scoreBreakdownJson).includes(capXhidden.id) && !JSON.stringify(x.scoreBreakdownJson).includes(sigXhidden.id) && !JSON.stringify(x.scoreBreakdownJson).includes(hidden.id), "FR2-H2：评分快照不含隐藏项目的能力 / 线索 / 项目 id");
      ok(xBd.importRisk.unverified.some((u) => u.id === capXcurClaimed.id && u.discoverySignalId === sigXcur.id), "FR2-H3：当前项目的 CLAIMED 能力作为「待核实」列出（带出处线索 id）");
      // 同一 Run 谁收口都一样：owner 能看隐藏项目，但评分范围由评估项目决定——owner 重跑一次同样 null
      const runXo = await evaluate(supX.id, offX.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certX.id, null);
      await evalRun.completeEvaluationRun(actorOwner, runXo.run.id);
      ok((await cand(runXo.candidate.id)).importRiskScore === null, "FR2-H4：能看到隐藏项目的 owner 收口 → 同样 null（不依赖 actor 可见集）");
      const rkX = await rankingSvc.loadProjectSupplierRanking(actorWriter, proj.id);
      const rkJson = JSON.stringify(rkX);
      ok(!rkJson.includes(sigXhidden.id) && !rkJson.includes(capXhidden.id) && !rkJson.includes(hidden.id) && !rkJson.includes(archHidden.id), "FR2-H6：ranking payload 不泄露隐藏线索 / 能力 / 项目 / 档案 id");
      const rkHttp = await rankingRoute.GET(await req(writer, `/api/supplier-intel/projects/${proj.id}/ranking${q}`), P({ projectId: proj.id }));
      ok(rkHttp.status === 200 && !(await rkHttp.text()).includes(sigXhidden.id), "FR2-H7：HTTP ranking 同样不泄露");
      // 当前项目人工 + 档案核验 → 新 Run 才反映
      await capVerify.verifyCapabilitySignal(actorWriter, capXcurClaimed.id, { archiveItemId: arch.id });
      ok((await cand(runX.candidate.id)).importRiskScore === null, "FR2-P1：核验之后旧 Run 不漂移");
      const runX2 = await evaluate(supX.id, offX.id, { "R-001": "PASS", "R-002": "PASS", "R-003": "PASS" }, certX.id, null);
      await evalRun.completeEvaluationRun(actorWriter, runX2.run.id);
      const x2 = await cand(runX2.candidate.id); const x2Bd = x2.scoreBreakdownJson as { importRisk: { verified: Array<{ id: string; discoverySignalId: string | null; projectScope: string }> } };
      ok(x2.importRiskScore === 80 && x2Bd.importRisk.verified.length === 1 && x2Bd.importRisk.verified[0].id === capXcurClaimed.id && x2Bd.importRisk.verified[0].discoverySignalId === sigXcur.id && x2Bd.importRisk.verified[0].projectScope === "CURRENT_PROJECT", "FR2-P2：当前项目 VERIFIED → 新 Run 进口准备度 80（50 + FOB 15 + 交期 15），快照记当前项目能力出处", JSON.stringify({ i: x2.importRiskScore, v: x2Bd.importRisk.verified }));
      const rowX2 = (await rankingSvc.loadProjectSupplierRanking(actorWriter, proj.id)).racing.find((r) => r.supplierId === supX.id);
      ok(rowX2?.runId === runX2.run.id, "FR2-P3：赛马取最新 COMPLETED");
    }

    console.log("\n== §14：COMPLETED Run 不能再评分 / 改分 ==");
    await expectErr("RUN_IMMUTABLE", "再次收口 COMPLETED Run → RUN_IMMUTABLE", () => evalRun.completeEvaluationRun(actorWriter, runB.run.id));

    console.log("\n== §16：整个套件 fetch 调用数 ==");
    ok(fetchCalls === 0, "评分 / 收口 / 排名 / 优先级全程零网络（fetch 炸弹未触发）", `fetchCalls=${fetchCalls}`);

    console.log(`\nS4-B 断言：${pass} 通过 / ${fail} 失败`);
  } finally {
    globalThis.fetch = realFetch;
    await db.supplierRequirementMatch.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCertification.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { project: { orgId: { in: cleanupOrgs } } } } });
    await db.projectInquiry.deleteMany({ where: { project: { orgId: { in: cleanupOrgs } } } });
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
