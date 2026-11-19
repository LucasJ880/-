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
  const { __setAutoSupplierRunFaultForTest, SUPPLIER_AUTO_RUN_AUDIT_ACTION } = await import("../auto-supplier-run");
  const { maybeAutoDraftRfq } = await import("@/lib/tender-rfq/auto-draft-service");
  const { TENDER_SEND_RFQ_TYPE } = await import("@/lib/tender-rfq/types");
  type Payload = import("@/lib/tender-rfq/types").TenderSendRfqPayload;
  const approveRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/approve/route");
  const confirmRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/[requirementId]/confirm/route");
  const rejectRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/[requirementId]/reject/route");
  const sourcingRoute = await import("@/app/api/projects/[id]/tender-intel/sourcing/route");

  console.log("CHAIN-2 sourcing suggestions — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `ssowner_${stamp}`, ADMIN = `ssadmin_${stamp}`, OUTSIDER = `ssout_${stamp}`, ORG = `ssorg_${stamp}`, ORG2 = `ssorg2_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;
  for (const id of [OWNER, ADMIN, OUTSIDER]) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `ss-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Org", code: `ss2-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_admin", status: "active" } });
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
    ok(runs1[0]?.promptName === null && outbound === 0, "检索简报没有调模型（promptName 为空）、外部请求 0 次", { promptName: runs1[0]?.promptName, outbound });
    const pool = await db.supplierCandidate.count({ where: { orgId: ORG, searchRunId: runs1[0]?.id } });
    const audit = await db.auditLog.findFirst({ where: { orgId: ORG, action: SUPPLIER_AUTO_RUN_AUDIT_ACTION, targetId: runs1[0]?.id } });
    const ad = (typeof audit?.afterData === "string" ? JSON.parse(audit.afterData) : audit?.afterData) as Record<string, unknown> | undefined;
    ok(!!audit && ad?.analysisRunId === p1.runId && typeof ad?.candidatesCreated === "number" && ad?.external === "none" && ad?.llm === "none" && !JSON.stringify(ad).includes("@supplier.test"), "审计一条：记搜索运行、需求来源分析、候选数；不记供应商联系方式", ad);
    ok(pool >= 4, "候选池里有本组织在用的供应商（内部来源：已存供应商）", pool);

    // —— 3. 每份分析只建一次 ——
    const base1 = `/api/projects/${p1.projectId}/tender-analysis/runs/${p1.runId}`;
    await confirmRoute.POST(post(`${base1}/requirements/${p1.reqIds[2]}/confirm`), { params: Promise.resolve({ id: p1.projectId, runId: p1.runId, requirementId: p1.reqIds[2] }) });
    await rejectRoute.POST(post(`${base1}/requirements/${p1.reqIds[3]}/reject`), { params: Promise.resolve({ id: p1.projectId, runId: p1.runId, requirementId: p1.reqIds[3] }) });
    ok((await searchRuns(p1.projectId)).length === 1, "批准后又确认、驳回：仍然只有一个搜索运行");

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
    __setAutoSupplierRunFaultForTest(() => { throw new Error("injected"); });
    const r3 = await approve(p3);
    __setAutoSupplierRunFaultForTest(null);
    const run3 = await db.tenderAnalysisRun.findUnique({ where: { id: p3.runId }, select: { status: true } });
    ok(r3.status === 200 && run3?.status === "APPROVED" && (await searchRuns(p3.projectId)).length === 0, "建池出错：批准仍然成功，状态为已批准", r3);

    // —— 6. 寻源建议：没有评估 → 照实说并提到候选池家数 ——
    const s1 = await getSourcing(p1.projectId);
    const rec1 = s1.json.recommendations as { status: string; messageZh: string; href: string };
    ok(s1.status === 200 && rec1.status === "not_evaluated" && rec1.messageZh.includes(`系统已在批准分析后建了候选池（${pool} 家）`) && rec1.href.includes(encodeURIComponent(p1.projectId)), "没有评估：照实说，提到自动建的候选池家数，给供应链页链接", s1.json);

    // —— 7. 有评估：推荐主选 / 备选、强制闸通过的，按名次 ——
    await mkEvaluations(p1.projectId, [
      { supplierId: sB.id, total: 90, gate: "PASS", gateItems: passItems },
      { supplierId: sC.id, total: 80, gate: "PASS", gateItems: [passItems[0], { requirementKey: "R-002", gateVerdict: "PASS", evidenceAdmissible: false }] },
      { supplierId: sD.id, total: 95, gate: "FAIL", gateItems: [{ requirementKey: "R-002", gateVerdict: "FAIL", evidenceAdmissible: false }] },
      { supplierId: sA.id, total: 85, gate: "PASS", recommendation: "NEEDS_VERIFICATION", gateItems: passItems },
    ]);
    const s2 = await getSourcing(p1.projectId);
    const rec2 = s2.json.recommendations as { status: string; items: Array<{ supplierName: string; section: string; mandatoryEvidence: { withEvidence: number; total: number }; scores: { total: number } }> };
    ok(rec2.status === "ready" && rec2.items.length === 2 && rec2.items[0].supplierName === sB.name && rec2.items[0].section === "PRIMARY" && rec2.items[1].supplierName === sC.name && rec2.items[1].section === "BACKUP", "推荐 2 个：B 主选、C 备选（D 没过闸、A 待核实不进）", rec2);
    ok(rec2.status === "ready" && rec2.items[0].mandatoryEvidence.withEvidence === 2 && rec2.items[0].mandatoryEvidence.total === 2 && rec2.items[1].mandatoryEvidence.withEvidence === 1 && rec2.items[0].scores.total === 90, "带「x / y 条」证据与分数");

    // —— 8. 价格：落地价只给有财务查看权的人 ——
    const prices = s2.json.prices as Record<string, { status: string; messageZh?: string }>;
    ok("landed" in prices && prices.landed.status === "missing" && prices.landed.messageZh === "比价矩阵里还没有选定报价。", "项目负责人：有我方落地价一栏（还没选定时照实说）", prices);
    ok(prices.market?.messageZh === "还没有跑过外部情报。" && typeof prices.awards?.status === "string", "市场基准与可比授标两栏照常给出");
    const sAdmin = await getSourcing(p1.projectId, await cookieOf(ADMIN));
    ok(sAdmin.status === 200 && !("landed" in (sAdmin.json.prices as Record<string, unknown>)), "只是组织管理员、没有财务查看权：响应里没有我方落地价这个键", sAdmin.json.prices);

    // —— 9. 接口权限 ——
    const sOut = await getSourcing(p1.projectId, await cookieOf(OUTSIDER));
    const sAnon = await getSourcing(p1.projectId, null);
    ok(sOut.status === 404 && sAnon.status === 401, "别的组织 404；没登录 401", [sOut.status, sAnon.status]);

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
    ok(d0?.drafted === true && rc0.names.join() === [sA.name, sB.name].join() && !rc0.preview.includes("供应商情报推荐"), "情报推荐开关关闭：收件人只有 A、B", { d0, rc0 });
    // 开关开：A、B 之后并入 C（B 已在名单里不重复；D 没过闸不进）
    process.env.TENDER_RFQ_INTEL_RECIPIENTS_ENABLED = "1";
    const pR1 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    await mkEvaluations(pR1.projectId, [{ supplierId: sB.id, total: 90, gate: "PASS", gateItems: passItems }, { supplierId: sC.id, total: 80, gate: "PASS", gateItems: passItems }, { supplierId: sD.id, total: 99, gate: "FAIL", gateItems: [] }]);
    const d1 = await maybeAutoDraftRfq({ orgId: ORG, projectId: pR1.projectId, runId: pR1.runId, userId: OWNER, trigger: "approve_run", now });
    const rc1 = await recipientsOf(pR1.projectId);
    ok(d1?.drafted === true && rc1.names.join() === [sA.name, sB.name, sC.name].join(), "情报推荐开关打开：收件人依次是 A、B、C（不含没过闸的 D）", { d1, rc1 });
    ok(rc1.preview.includes(`其中 1 家来自供应商情报推荐：${sC.name}`) && !!d1 && d1.drafted && d1.messageZh.includes(`其中 1 家来自供应商情报推荐：${sC.name}`), "卡摘要与结果说明写明哪一家来自情报推荐", { preview: rc1.preview, msg: d1 && d1.drafted ? d1.messageZh : null });
    const draftAudit = await db.auditLog.findFirst({ where: { orgId: ORG, projectId: pR1.projectId, action: "tender.rfq_auto_draft" }, orderBy: { createdAt: "desc" } });
    const dad = (typeof draftAudit?.afterData === "string" ? JSON.parse(draftAudit.afterData) : draftAudit?.afterData) as Record<string, unknown> | undefined;
    ok(Array.isArray(dad?.intelRecommendedSupplierIds) && (dad?.intelRecommendedSupplierIds as string[]).join() === sC.id, "自动起草审计记下并入的情报推荐", dad);
    ok(outbound === 0, "整个过程外部请求 0 次", outbound);
  } finally {
    __setAutoSupplierRunFaultForTest(null);
    globalThis.fetch = realFetch;
    for (const k of ["TENDER_AUTO_SUPPLIER_RUN_ENABLED", "TENDER_RFQ_INTEL_RECIPIENTS_ENABLED", "TENDER_RFQ_AUTO_DRAFT_ENABLED", "SUPPLIER_INTEL_ENABLED", "TENDER_EXTERNAL_INTEL_ENABLED", "TAVILY_API_KEY"]) delete process.env[k];
    const runIds = (await db.supplierSearchRun.findMany({ where: { orgId: ORG }, select: { id: true } })).map((r) => r.id);
    await db.supplierRequirementMatch.deleteMany({ where: { candidate: { searchRunId: { in: runIds } } } }).catch(() => undefined);
    await db.supplierCandidate.deleteMany({ where: { searchRunId: { in: runIds } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.supplierSearchRun.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: [OWNER, ADMIN, OUTSIDER] } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { projectId: { in: projectIds } } } }).catch(() => undefined);
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.emailProvider.deleteMany({ where: { userId: OWNER } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, ADMIN, OUTSIDER] } } });
    await db.$disconnect();
  }
  console.log(`CHAIN-2 sourcing suggestions DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
