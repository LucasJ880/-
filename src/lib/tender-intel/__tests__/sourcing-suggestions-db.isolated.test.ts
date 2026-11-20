/**
 * CHAIN-2 寻源建议——真实 DB（隔离库）端到端：自动建候选池 / 推荐型号 / 财务权限 / 接口权限 / 情报推荐并入自动起草
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；外部请求一律被替换成计数后报错的假函数（不出站）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-2 寻源建议 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-2 sourcing suggestions DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  // 外部请求计数：任何出站都记一次并报错（本功能不应有任何外部请求）
  let outbound = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (!/^https?:\/\/localhost/.test(url)) { outbound += 1; throw new Error(`blocked outbound in test: ${url}`); }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;

  process.env.SUPPLIER_INTEL_ENABLED = "1";
  delete process.env.SUPPLIER_INTEL_ORG_ALLOWLIST;
  // 外部情报的开关与检索密钥都配着：证明自动建池仍然不外查
  process.env.TENDER_EXTERNAL_INTEL_ENABLED = "1";
  process.env.TAVILY_API_KEY = "fixture-not-a-key";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { __setAutoSupplierRunFaultForTest, maybeAutoSupplierRun, SUPPLIER_AUTO_RUN_AUDIT_ACTION } = await import("../auto-supplier-run");
  const { normalizeBuyerName } = await import("@/lib/corporate-memory/normalize");
  const { normalizeVendorName } = await import("../awards");
  const { maybeAutoDraftRfq } = await import("@/lib/tender-rfq/auto-draft-service");
  const { TENDER_SEND_RFQ_TYPE } = await import("@/lib/tender-rfq/types");
  type Payload = import("@/lib/tender-rfq/types").TenderSendRfqPayload;
  const approveRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/approve/route");
  const confirmRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/[requirementId]/confirm/route");
  const rejectRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/[requirementId]/reject/route");
  const sourcingRoute = await import("@/app/api/projects/[id]/tender-intel/sourcing/route");

  console.log("CHAIN-2 sourcing suggestions — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `ssowner_${stamp}`, ADMIN = `ssadmin_${stamp}`, OUTSIDER = `ssout_${stamp}`, MEMBER = `ssmember_${stamp}`, REMOVED = `ssremoved_${stamp}`, ORG = `ssorg_${stamp}`, ORG2 = `ssorg2_${stamp}`;
  const USERS = [OWNER, ADMIN, OUTSIDER, MEMBER, REMOVED];
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;
  for (const id of USERS) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `ss-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Org", code: `ss2-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_admin", status: "active" } });
  // 普通成员（没有财务查看权）与已被移出组织的人（组织成员记录已停用，项目成员记录还在）
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: REMOVED, role: "org_member", status: "inactive" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture", accountEmail: MAILBOX, grantedScopes: "gmail.compose gmail.readonly" } });
  const mkSupplier = (n: string) => db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: `sales-${n.toLowerCase()}-${stamp}@supplier.test`, status: "active", createdById: OWNER } });
  const [sA, sB, sC, sD] = [await mkSupplier("A"), await mkSupplier("B"), await mkSupplier("C"), await mkSupplier("D")];
  await db.organization.update({
    where: { id: ORG },
    data: { settingsJson: { tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail: MAILBOX }, museBridge: { userPrefs: { [OWNER]: { defaultSupplierIds: [sA.id, sB.id], defaultIncoterm: "FOB", chaseAfterDays: null, lastUpdatedAt: null } } } } },
  });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(opts: { runStatus: string; reqs: string[]; withRisks?: boolean }) {
    seq += 1;
    const projectId = `ssproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: "City of Fixture", closeDate: new Date("2026-12-15T00:00:00Z") } });
    const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, status: opts.runStatus, idempotencyKey: `ss-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    // canonical V2 分析必有 RISKS 章节（供应商情报读需求快照时要它）；旧分析可能没有
    if (opts.withRisks !== false) await db.tenderAnalysisSection.create({ data: { runId: run.id, sectionKey: "RISKS", contentZh: "无", structuredJson: { risks: [] } } });
    for (const userId of [MEMBER, REMOVED]) await db.projectMember.create({ data: { projectId, userId, role: "operator", status: "active" } });
    const reqIds: string[] = [];
    for (const [i, reviewStatus] of opts.reqs.entries()) {
      const r = await db.tenderExtractedRequirement.create({
        data: { projectId, analysisRunId: run.id, requirementCode: `R-${String(i + 1).padStart(3, "0")}`, category: "product", originalRequirement: `Sleeping bag requirement ${i + 1}: rated to -20C`, chineseTranslation: `睡袋要求 ${i + 1}：-20°C`, mandatory: true, reviewStatus },
      });
      reqIds.push(r.id);
    }
    return { projectId, runId: run.id, reqIds };
  }
  const searchRuns = (projectId: string) => db.supplierSearchRun.findMany({ where: { orgId: ORG, projectId }, orderBy: { createdAt: "asc" } });
  const liveRuns = async (projectId: string) => (await searchRuns(projectId)).filter((r) => r.status !== "CANCELLED" && r.status !== "FAILED" && (r.sourceConfigJson as Record<string, unknown>)?.runMode !== "EVALUATION_ONLY");
  /** 一个已完成的评估运行 + 若干候选（排名读模型只认这个） */
  async function mkEvaluations(projectId: string, cands: Array<{ supplierId: string; total: number; gate: "PASS" | "FAIL" | "INCOMPLETE"; recommendation?: string | null; gateItems: Array<{ requirementKey: string; gateVerdict: string; evidenceAdmissible: boolean }> }>) {
    const r = await db.supplierSearchRun.create({
      data: { orgId: ORG, projectId, status: "COMPLETED", completedAt: new Date(), briefSnapshotJson: {}, requirementSnapshotJson: {}, sourceConfigJson: { runMode: "EVALUATION_ONLY" }, queriesJson: [], scoreVersion: "fixture", evaluationVersion: "fixture", createdByUserId: OWNER },
    });
    for (const [i, c] of cands.entries()) {
      await db.supplierCandidate.create({
        data: {
          orgId: ORG, searchRunId: r.id, supplierId: c.supplierId, candidateKey: `ss-${stamp}-${projectId}-${i}`, originSource: "SAVED", supplierSnapshotJson: {}, scoreVersion: "fixture",
          technicalScore: c.total, commercialScore: c.total, reliabilityScore: c.total, importRiskScore: c.total, totalScore: c.total,
          mandatoryGateResult: c.gate, recommendation: c.recommendation ?? null, mandatoryGateJson: { items: c.gateItems },
        },
      });
    }
  }
  const cookieOf = async (id: string) => `qy_session=${await createSession({ sub: id, email: email(id), role: "user" })}`;
  const cookie = await cookieOf(OWNER);
  const post = (url: string) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  const approve = async (p: { projectId: string; runId: string }) => {
    const res = await approveRoute.POST(post(`/api/projects/${p.projectId}/tender-analysis/runs/${p.runId}/approve`), { params: Promise.resolve({ id: p.projectId, runId: p.runId }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const getSourcing = async (projectId: string, who: string | null = cookie) => {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/tender-intel/sourcing`, { headers: who ? { cookie: who } : {} });
    const res = await sourcingRoute.GET(req, { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const passItems = [{ requirementKey: "R-001", gateVerdict: "PASS", evidenceAdmissible: true }, { requirementKey: "R-002", gateVerdict: "PASS", evidenceAdmissible: true }];

  try {
    // —— 1. 开关关闭：不建池，接口 404 ——
    delete process.env.TENDER_AUTO_SUPPLIER_RUN_ENABLED;
    const pOff = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "CONFIRMED"] });
    const rOff = await approve(pOff);
    ok(rOff.status === 200 && (await searchRuns(pOff.projectId)).length === 0, "开关关闭：批准照常，没有搜索运行", rOff);
    ok((await getSourcing(pOff.projectId)).status === 404, "开关关闭：寻源建议接口 404");
    const keysBefore = Object.keys(rOff.json).sort().join();

    // —— 2. 开关打开：批准后自动建池 ——
    process.env.TENDER_AUTO_SUPPLIER_RUN_ENABLED = "1";
    const p1 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "CONFIRMED", "AI_EXTRACTED", "AI_EXTRACTED"] });
    const r1 = await approve(p1);
    const runs1 = await searchRuns(p1.projectId);
    const cfg = (runs1[0]?.sourceConfigJson ?? {}) as Record<string, unknown>;
    ok(r1.status === 200 && r1.json.status === "APPROVED" && runs1.length === 1 && runs1[0].status === "COMPLETED" && cfg.canonicalAnalysisRunId === p1.runId && runs1[0].createdByUserId === OWNER, "批准后自动建了一个以这份分析为需求来源、已完成的搜索运行，建池人是操作者", { r1, runs1: runs1.map((r) => ({ status: r.status, cfg: r.sourceConfigJson })) });
    ok(Object.keys(r1.json).sort().join() === keysBefore, "批准接口的响应字段与开关关闭时相同", Object.keys(r1.json));
    const generator = ((runs1[0]?.briefSnapshotJson ?? {}) as { generator?: { llm?: unknown } }).generator;
    ok(!!generator && generator.llm === null && runs1[0]?.promptName === null && outbound === 0, "检索简报没有调模型（简报的模型来源为空）、外部请求（含模型调用）0 次", { generator, promptName: runs1[0]?.promptName, outbound });
    const pool = await db.supplierCandidate.count({ where: { orgId: ORG, searchRunId: runs1[0]?.id } });
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, projectId: p1.projectId, action: SUPPLIER_AUTO_RUN_AUDIT_ACTION } });
    const ad = (typeof audits[0]?.afterData === "string" ? JSON.parse(audits[0].afterData) : audits[0]?.afterData) as Record<string, unknown> | undefined;
    const srcs = (ad?.sources ?? {}) as Record<string, { status?: string }>;
    ok(audits.length === 1 && audits[0].targetId === runs1[0]?.id && audits[0].userId === OWNER && ad?.analysisRunId === p1.runId && ad?.candidatesCreated === pool && ad?.external === "none" && ad?.llm === "none" && !JSON.stringify(ad).includes("@supplier.test"), "审计恰好一条：记搜索运行、需求来源分析、候选数；不记供应商联系方式", { audits: audits.length, ad });
    ok(["memory", "historical", "saved"].every((k) => typeof srcs[k]?.status === "string") && Object.keys(srcs).every((k) => ["memory", "historical", "saved"].includes(k)), "审计记下三个内部来源各自的结果，没有外部来源", srcs);
    ok(pool >= 4, "候选池里有本组织在用的供应商（内部来源：已存供应商）", pool);

    // —— 3. 每份分析只建一次 ——
    const base1 = `/api/projects/${p1.projectId}/tender-analysis/runs/${p1.runId}`;
    const c1 = await confirmRoute.POST(post(`${base1}/requirements/${p1.reqIds[2]}/confirm`), { params: Promise.resolve({ id: p1.projectId, runId: p1.runId, requirementId: p1.reqIds[2] }) });
    const j1 = await rejectRoute.POST(post(`${base1}/requirements/${p1.reqIds[3]}/reject`), { params: Promise.resolve({ id: p1.projectId, runId: p1.runId, requirementId: p1.reqIds[3] }) });
    ok(c1.status === 200 && j1.status === 200 && (await searchRuns(p1.projectId)).length === 1, "批准后又确认、驳回：两个动作都成功，仍然只有一个搜索运行", [c1.status, j1.status]);

    // —— 4. 分析还没批准：不建 ——
    const p2 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "AI_EXTRACTED"] });
    const base2 = `/api/projects/${p2.projectId}/tender-analysis/runs/${p2.runId}`;
    const c2 = await confirmRoute.POST(post(`${base2}/requirements/${p2.reqIds[1]}/confirm`), { params: Promise.resolve({ id: p2.projectId, runId: p2.runId, requirementId: p2.reqIds[1] }) });
    ok(c2.status === 200 && (await searchRuns(p2.projectId)).length === 0, "分析还在等待审核时确认要求：不建候选池");

    // —— 4b. 旧分析没有 RISKS 章节：供应商情报读不出需求快照 → 不建池，批准照常 ——
    const pLegacy = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED"], withRisks: false });
    const rLegacy = await approve(pLegacy);
    ok(rLegacy.status === 200 && rLegacy.json.status === "APPROVED" && (await searchRuns(pLegacy.projectId)).filter((r) => r.status !== "CANCELLED").length === 0, "旧分析缺 RISKS 章节：不建池，批准照常", rLegacy);

    // —— 5. 建池出错：批准仍然成功 ——
    const p3 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED"] });
    process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED = "1";
    __setAutoSupplierRunFaultForTest((stage) => { if (stage === "before_create") throw new Error("injected"); });
    const r3 = await approve(p3);
    __setAutoSupplierRunFaultForTest(null);
    delete process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED;
    const run3 = await db.tenderAnalysisRun.findUnique({ where: { id: p3.runId }, select: { status: true } });
    const ad3 = r3.json.rfqAutoDraft as { drafted?: boolean } | undefined;
    ok(r3.status === 200 && run3?.status === "APPROVED" && (await searchRuns(p3.projectId)).length === 0, "建池出错：批准仍然成功，状态为已批准", r3);
    ok(ad3?.drafted === true, "建池出错时自动起草照常判定（照常起草了第 1 轮）", ad3);

    // —— 5b. 执行途中出错：运行标为失败，批准照常；下一次审核动作重建 ——
    const p4 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "AI_EXTRACTED"] });
    __setAutoSupplierRunFaultForTest((stage) => { if (stage === "execute") throw new Error("injected during execute"); });
    const r4 = await approve(p4);
    __setAutoSupplierRunFaultForTest(null);
    const runs4 = await searchRuns(p4.projectId);
    ok(r4.status === 200 && r4.json.status === "APPROVED" && runs4.length === 1 && runs4[0].status === "FAILED" && !((runs4[0].statusDetailJson ?? {}) as Record<string, unknown>).executionClaim, "执行途中出错：批准照常，这个运行标为失败、不留执行声明", runs4.map((r) => ({ status: r.status, detail: r.statusDetailJson })));
    const base4 = `/api/projects/${p4.projectId}/tender-analysis/runs/${p4.runId}`;
    const c4 = await confirmRoute.POST(post(`${base4}/requirements/${p4.reqIds[1]}/confirm`), { params: Promise.resolve({ id: p4.projectId, runId: p4.runId, requirementId: p4.reqIds[1] }) });
    const runs4b = await searchRuns(p4.projectId);
    ok(c4.status === 200 && runs4b.length === 2 && runs4b[1].status === "COMPLETED", "失败的不算「已经有了」：之后确认一条要求时重建，这次成功", runs4b.map((r) => r.status));

    // —— 5c. 并发两次触发：只留一个 ——
    const p5 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    const both = await Promise.all([1, 2].map(() => maybeAutoSupplierRun({ orgId: ORG, projectId: p5.projectId, runId: p5.runId, userId: OWNER })));
    const live5 = await liveRuns(p5.projectId);
    ok(live5.length === 1 && both.filter((o) => o.created).length === 1, "并发两次触发：只有一个运行在算数，另一次没有建或已取消", { both, runs: (await searchRuns(p5.projectId)).map((r) => r.status) });

    // —— 5c'. 进程中途死掉留下的「执行中、声明已过期」运行不算已有 ——
    const p7 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    const stale = await db.supplierSearchRun.create({
      data: { orgId: ORG, projectId: p7.projectId, status: "RUNNING", startedAt: new Date("2026-11-01T00:00:00Z"), briefSnapshotJson: {}, requirementSnapshotJson: {}, sourceConfigJson: { canonicalAnalysisRunId: p7.runId }, queriesJson: [], scoreVersion: "fixture", evaluationVersion: "fixture", createdByUserId: OWNER,
        statusDetailJson: { executionClaim: { claimId: "stale-claim", claimedAt: "2026-11-01T00:00:00.000Z", expiresAt: "2026-11-01T00:10:00.000Z", byUserId: OWNER } } },
    });
    const o7 = await maybeAutoSupplierRun({ orgId: ORG, projectId: p7.projectId, runId: p7.runId, userId: OWNER });
    ok(o7.created === true && (await liveRuns(p7.projectId)).some((r) => r.id !== stale.id && r.status === "COMPLETED"), "执行中但声明已过期的运行不算已有：照常重建", o7);

    // —— 5d. 供应商情报关闭 / 触发人已被移出组织：不建 ——
    const p6 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    process.env.SUPPLIER_INTEL_ENABLED = "0";
    const o6 = await maybeAutoSupplierRun({ orgId: ORG, projectId: p6.projectId, runId: p6.runId, userId: OWNER });
    process.env.SUPPLIER_INTEL_ENABLED = "1";
    const o6b = await maybeAutoSupplierRun({ orgId: ORG, projectId: p6.projectId, runId: p6.runId, userId: REMOVED });
    ok(!o6.created && o6.reason === "SUPPLIER_INTEL_OFF" && !o6b.created && o6b.reason === "NOT_ORG_MEMBER" && (await searchRuns(p6.projectId)).length === 0, "供应商情报关闭、触发人已被移出组织：都不建候选池", [o6, o6b]);

    // —— 6. 寻源建议：没有评估 → 照实说并提到候选池家数 ——
    const s1 = await getSourcing(p1.projectId);
    const rec1 = s1.json.recommendations as { status: string; messageZh: string; href: string; hrefLabelZh: string; poolNoteZh: string | null };
    ok(s1.status === 200 && rec1.status === "not_evaluated" && rec1.messageZh.startsWith("还没有评估过的候选。") && rec1.poolNoteZh === `系统已在批准分析后从内部供应商库建了候选池（${pool} 家，未筛选）。` && rec1.href.includes(encodeURIComponent(p1.projectId)) && rec1.hrefLabelZh === "去供应链页评估 →", "没有评估：照实说，写自动建的候选池家数，给「去供应链页评估」", s1.json);
    const s2pending = await getSourcing(p2.projectId);
    const rec2p = s2pending.json.recommendations as { status: string; messageZh: string; href: string | null };
    ok(rec2p.status === "not_evaluated" && rec2p.messageZh.startsWith("招标分析还没有批准（") && rec2p.href === null, "分析还没批准：照实说，不催人去评估", rec2p);

    // —— 7. 有评估：推荐主选 / 备选、强制闸通过的，按名次 ——
    await mkEvaluations(p1.projectId, [
      { supplierId: sB.id, total: 90, gate: "PASS", gateItems: passItems },
      { supplierId: sC.id, total: 80, gate: "PASS", gateItems: [passItems[0], { requirementKey: "R-002", gateVerdict: "PASS", evidenceAdmissible: false }] },
      { supplierId: sD.id, total: 95, gate: "FAIL", gateItems: [{ requirementKey: "R-002", gateVerdict: "FAIL", evidenceAdmissible: false }] },
      { supplierId: sA.id, total: 85, gate: "PASS", recommendation: "NEEDS_VERIFICATION", gateItems: passItems },
    ]);
    const s2 = await getSourcing(p1.projectId);
    type Item = { supplierName: string; section: string; rank: number | null; mandatoryZh: string; scores: Record<string, number | null> };
    const rec2 = s2.json.recommendations as { status: string; items: Item[]; hrefLabelZh: string };
    ok(rec2.status === "ready" && rec2.items.length === 2 && rec2.items[0].supplierName === sB.name && rec2.items[0].section === "PRIMARY" && rec2.items[0].rank === 1 && rec2.items[1].supplierName === sC.name && rec2.items[1].section === "BACKUP" && rec2.items[1].rank === 2 && rec2.hrefLabelZh === "查看完整排名 →", "推荐 2 个：B 首选、C 备选，按名次（D 没过强制项、A 待核实不进）", rec2);
    const sc = rec2.status === "ready" ? rec2.items[0].scores : {};
    ok(rec2.status === "ready" && rec2.items[0].mandatoryZh === "强制项全部通过（2 条，都有可采信的证据）" && rec2.items[1].mandatoryZh === "强制项判定通过（2 条，其中 1 条有可采信的证据）" && sc.technical === 90 && sc.commercial === 90 && sc.reliability === 90 && sc.importRisk === 90 && sc.total === 90, "带强制项那一句与五项分数", rec2.items);
    // 只有「过了强制项但待核实」的候选：不说成「都没通过」
    const pNR = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    await mkEvaluations(pNR.projectId, [{ supplierId: sA.id, total: 85, gate: "PASS", recommendation: "NEEDS_VERIFICATION", gateItems: passItems }]);
    const recNR = (await getSourcing(pNR.projectId)).json.recommendations as { status: string; messageZh: string };
    ok(recNR.status === "not_ranked" && recNR.messageZh === "评估过 1 个候选，暂时没有可推荐的：1 个强制项已通过，但处于「待核实」或「重大风险」。", "只有过了强制项但待核实的：照实分开说", recNR);

    // —— 8. 价格：落地价只给有财务查看权的人 ——
    const prices = s2.json.prices as Record<string, { status: string; messageZh?: string }>;
    ok("landed" in prices && prices.landed.status === "missing" && prices.landed.messageZh === "我方落地价还没有接通（需管理员开启比价矩阵成本来源）。", "项目负责人：有我方落地价一栏；比价矩阵成本来源开关关闭时写没接通", prices);
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "1";
    const pricesOn = (await getSourcing(p1.projectId)).json.prices as Record<string, { status: string; messageZh?: string }>;
    ok(pricesOn.landed?.messageZh?.startsWith("比价矩阵里还没有选定供应商——"), "开关打开、还没选定报价：照实说", pricesOn.landed);
    ok(prices.market?.messageZh === "还没有做过外部情报检索（可在情报室发起）。" && prices.awards?.messageZh === "授标记录还没有接通（需管理员开启）。", "市场基准与可比授标两栏照常给出（授标记录未接通时照实说）", prices);
    const sMember = await getSourcing(p1.projectId, await cookieOf(MEMBER));
    const sAdmin = await getSourcing(p1.projectId, await cookieOf(ADMIN));
    ok(sMember.status === 200 && !("landed" in (sMember.json.prices as Record<string, unknown>)) && sAdmin.status === 200 && !("landed" in (sAdmin.json.prices as Record<string, unknown>)), "只是项目成员、或只是组织管理员（都没有财务查看权）：响应里没有我方落地价这个键", [sMember.json.prices, sAdmin.json.prices]);

    // —— 8b. 可比授标：只取本项目采购方的，剔除我方结果 ——
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
    let awardSeq = 0;
    const mkAward = async (winner: string, amount: number, o: { projectId?: string | null; sourceKey?: string } = {}) => {
      awardSeq += 1;
      const rec = await db.awardRecord.create({
        data: { orgId: ORG, buyerNameRaw: "CITY OF FIXTURE", buyerNameNormalized: normalizeBuyerName("CITY OF FIXTURE"), projectId: o.projectId ?? null, winnerName: winner, winnerNameNormalized: normalizeVendorName(winner), contractAmount: amount, currency: "CAD", scopeSummary: "Sleeping bags", awardDate: new Date("2025-03-01T00:00:00Z"), confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED", status: "ACTIVE", createdByType: "user", createdById: OWNER },
      });
      await db.awardRecordSource.create({ data: { orgId: ORG, awardRecordId: rec.id, sourceType: o.sourceKey?.startsWith("canadabuys:") ? "CANADABUYS_OPEN_DATA" : "USER_ENTRY", sourceKey: o.sourceKey ?? `manual:${stamp}-${awardSeq}`, capturedAt: new Date("2025-03-02T00:00:00Z"), createdById: OWNER } });
    };
    await mkAward("Rival One", 100);
    await mkAward("Rival Two", 200, { projectId: p1.projectId, sourceKey: `canadabuys:${stamp}-REF-2` }); // 人工确认的公开授标，挂在项目上
    await mkAward("Rival Three", 300);
    await mkAward("Fixture Buyer Inc.", 999, { projectId: p1.projectId, sourceKey: `own-result:${p1.projectId}` }); // 我方中标
    await mkAward("Rival Four", 5000, { projectId: p2.projectId, sourceKey: `tender-result-winner:${p2.projectId}` }); // 我方没中时回灌的对手中标（金额取自我方项目）
    const awards = (await getSourcing(p1.projectId)).json.prices as { awards: { status: string; groups?: Array<{ sampleSize: number; min: number; median: number; max: number; currency: string }> } };
    const ag = awards.awards.groups?.[0];
    ok(awards.awards.status === "ok" && awards.awards.groups?.length === 1 && ag?.sampleSize === 3 && ag.min === 100 && ag.median === 200 && ag.max === 300 && ag.currency === "CAD", "同采购方（写法大小写不同）3 条（含挂在项目上的公开授标）：样本 3、最低 100、中位 200、最高 300；我方中标与我方结果回灌的不算", awards.awards);

    // —— 9. 接口权限 ——
    const sOut = await getSourcing(p1.projectId, await cookieOf(OUTSIDER));
    const sAnon = await getSourcing(p1.projectId, null);
    const sRemoved = await getSourcing(p1.projectId, await cookieOf(REMOVED));
    ok(sOut.status === 404 && sAnon.status === 401 && sRemoved.status === 404, "别的组织 404；没登录 401；已被移出组织（项目成员记录还在）404", [sOut.status, sAnon.status, sRemoved.status]);

    // —— 10. 情报推荐并入自动起草的收件人 ——
    process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED = "1";
    delete process.env.TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST;
    const now = new Date("2026-11-20T12:00:00Z");
    const recipientsOf = async (projectId: string) => {
      const card = await db.pendingAction.findFirst({ where: { orgId: ORG, projectId, type: TENDER_SEND_RFQ_TYPE } });
      const p = card?.payload as unknown as Payload | undefined;
      return { names: (p?.items ?? []).map((i) => i.supplierName), preview: card?.preview ?? "" };
    };
    // 开关关：只有操作者的常用供应商 A、B
    delete process.env.TENDER_RFQ_INTEL_RECIPIENTS_ENABLED;
    const pR0 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    await mkEvaluations(pR0.projectId, [{ supplierId: sB.id, total: 90, gate: "PASS", gateItems: passItems }, { supplierId: sC.id, total: 80, gate: "PASS", gateItems: passItems }, { supplierId: sD.id, total: 99, gate: "FAIL", gateItems: [] }]);
    const d0 = await maybeAutoDraftRfq({ orgId: ORG, projectId: pR0.projectId, runId: pR0.runId, userId: OWNER, trigger: "approve_run", now });
    const rc0 = await recipientsOf(pR0.projectId);
    ok(d0?.drafted === true && rc0.names.join() === [sA.name, sB.name].join() && !rc0.preview.includes("供应商情报推荐") && d0.messageZh.startsWith("已为你起草第 1 轮询价：2 家常用供应商。"), "情报推荐开关关闭：收件人只有 A、B，摘要与结果说明与之前相同", { d0, rc0 });
    // 开关开、但该组织的供应商情报关着：不并入
    process.env.TENDER_RFQ_INTEL_RECIPIENTS_ENABLED = "1";
    process.env.SUPPLIER_INTEL_ENABLED = "0";
    const pRoff = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    await mkEvaluations(pRoff.projectId, [{ supplierId: sC.id, total: 80, gate: "PASS", gateItems: passItems }]);
    const dOff = await maybeAutoDraftRfq({ orgId: ORG, projectId: pRoff.projectId, runId: pRoff.runId, userId: OWNER, trigger: "approve_run", now });
    process.env.SUPPLIER_INTEL_ENABLED = "1";
    ok(dOff?.drafted === true && (await recipientsOf(pRoff.projectId)).names.join() === [sA.name, sB.name].join(), "情报推荐开关开、供应商情报关：不并入", dOff);
    // 开关开：A、B 之后并入 C（B 已在名单里不重复；D 没过闸不进）
    const pR1 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    await mkEvaluations(pR1.projectId, [{ supplierId: sB.id, total: 90, gate: "PASS", gateItems: passItems }, { supplierId: sC.id, total: 80, gate: "PASS", gateItems: passItems }, { supplierId: sD.id, total: 99, gate: "FAIL", gateItems: [] }]);
    const d1 = await maybeAutoDraftRfq({ orgId: ORG, projectId: pR1.projectId, runId: pR1.runId, userId: OWNER, trigger: "approve_run", now });
    const rc1 = await recipientsOf(pR1.projectId);
    ok(d1?.drafted === true && rc1.names.join() === [sA.name, sB.name, sC.name].join(), "情报推荐开关打开：收件人依次是 A、B、C（不含没过闸的 D）", { d1, rc1 });
    ok(rc1.preview.includes(`的常用供应商，另加 1 家供应商情报推荐（首选 / 备选）：${sC.name}；`) && !!d1 && d1.drafted && d1.messageZh.includes(`3 家供应商——2 家常用供应商，另加 1 家供应商情报推荐（首选 / 备选）：${sC.name}。`), "卡摘要与结果说明写明另外补了哪一家情报推荐", { preview: rc1.preview, msg: d1 && d1.drafted ? d1.messageZh : null });
    const draftAudit = await db.auditLog.findFirst({ where: { orgId: ORG, projectId: pR1.projectId, action: "tender.rfq_auto_draft" }, orderBy: { createdAt: "desc" } });
    const dad = (typeof draftAudit?.afterData === "string" ? JSON.parse(draftAudit.afterData) : draftAudit?.afterData) as Record<string, unknown> | undefined;
    ok(Array.isArray(dad?.intelRecommendedSupplierIds) && (dad?.intelRecommendedSupplierIds as string[]).join() === sC.id, "自动起草审计记下并入的情报推荐", dad);
    // 操作者名单里没有能发的：只有推荐也不起草（与之前相同）
    const settingsBefore = (await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson as Record<string, unknown>;
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: { ...settingsBefore, museBridge: { userPrefs: { [OWNER]: { defaultSupplierIds: [], defaultIncoterm: "FOB", chaseAfterDays: null, lastUpdatedAt: null } } } } } });
    const pR2 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    await mkEvaluations(pR2.projectId, [{ supplierId: sC.id, total: 80, gate: "PASS", gateItems: passItems }]);
    const d2 = await maybeAutoDraftRfq({ orgId: ORG, projectId: pR2.projectId, runId: pR2.runId, userId: OWNER, trigger: "approve_run", now });
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: settingsBefore as object } });
    ok(d2?.drafted === false && d2.reason === "NO_DEFAULT_SUPPLIERS" && (await db.pendingAction.count({ where: { orgId: ORG, projectId: pR2.projectId } })) === 0, "操作者名单为空、只有情报推荐：不起草，原因与之前相同", d2);
    ok(outbound === 0, "整个过程外部请求 0 次", outbound);
  } finally {
    __setAutoSupplierRunFaultForTest(null);
    globalThis.fetch = realFetch;
    for (const k of ["TENDER_AUTO_SUPPLIER_RUN_ENABLED", "TENDER_RFQ_INTEL_RECIPIENTS_ENABLED", "TENDER_RFQ_AUTO_DRAFT_ENABLED", "SUPPLIER_INTEL_ENABLED", "TENDER_EXTERNAL_INTEL_ENABLED", "TAVILY_API_KEY", "TENDER_PRICING_COMPARE_SOURCE_ENABLED", "T4_AWARD_INTELLIGENCE_SCHEMA_READY"]) delete process.env[k];
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.awardRecord.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    const runIds = (await db.supplierSearchRun.findMany({ where: { orgId: ORG }, select: { id: true } })).map((r) => r.id);
    await db.supplierRequirementMatch.deleteMany({ where: { candidate: { searchRunId: { in: runIds } } } }).catch(() => undefined);
    await db.supplierCandidate.deleteMany({ where: { searchRunId: { in: runIds } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.supplierSearchRun.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: USERS } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { projectId: { in: projectIds } } } }).catch(() => undefined);
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.emailProvider.deleteMany({ where: { userId: OWNER } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
    await db.$disconnect();
  }
  console.log(`CHAIN-2 sourcing suggestions DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
