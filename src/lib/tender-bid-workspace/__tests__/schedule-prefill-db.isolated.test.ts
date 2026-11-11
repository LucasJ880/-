/**
 * FIX-2 价格表从招标分析带入——真实 DB（隔离库）：真实的入库映射与入库 → 真实的路由处理函数
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 招标内容）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-2 价格表带入 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-2 schedule prefill DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : ""); }
}

type Row = { lineNo: number; description: string; quantity: string; uom: string; quantityText: string | null; unitText: string | null; page: number | null; source: string };
type Body = { state?: string; messageZh?: string; text?: string; rows?: Row[]; skipped?: Array<{ description: string; quantityText: string | null; reasonZh: string; page: number | null }>; error?: string };

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { mapV2Result } = await import("@/lib/tender-auto-analysis/v2-map");
  const { persistV2CanonicalTx } = await import("@/lib/tender-auto-analysis/v2-persist-core");
  const { CRITICAL_FACT_TYPES } = await import("@/lib/tender-understanding/contract");
  const { parseSchedulePaste } = await import("../paste-import");
  const route = await import("@/app/api/projects/[id]/bid-workspace/schedule-candidates/route");
  type V2 = Parameters<typeof mapV2Result>[0];
  type PersistTx = Parameters<typeof persistV2CanonicalTx>[0];

  console.log("FIX-2 schedule prefill — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `spowner_${stamp}`, VIEWER = `spviewer_${stamp}`, OUTSIDER = `spout_${stamp}`;
  const ORG = `sporg_${stamp}`, ORG_B = `sporgb_${stamp}`;
  const users = [OWNER, VIEWER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  process.env.TENDER_BID_WORKSPACE_ENABLED = "1";
  delete process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `sp-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `spb-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(orgId = ORG, ownerId = OWNER) {
    seq += 1;
    const projectId = `spproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name: `Fixture Tender ${stamp}-${seq}`, orgId, ownerId, workDomain: "tender", intakeStatus: "dispatched" } });
    return projectId;
  }
  let runSeq = 0;
  const mkRun = async (projectId: string, status: string, orgId = ORG) => {
    runSeq += 1;
    return (await db.tenderAnalysisRun.create({ data: { orgId, projectId, status, idempotencyKey: `sp-${stamp}-${runSeq}`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: new Date(Date.now() - 600_000 + runSeq * 1000) } })).id;
  };

  const ev = (pageNumber: number) => [{ documentId: "fixture-doc", pageNumber, snippet: "fixture" }];
  type ReqIn = { id: string; object: string; quantity?: string | null; unit?: string | null; status?: string; page?: number };
  type FactIn = { claim: string; rawValue?: string | null; page?: number };
  function analysis(reqs: ReqIn[], facts: FactIn[] = []): V2 {
    const criticalFacts = Object.fromEntries(CRITICAL_FACT_TYPES.map((k) => [k, { status: "UNKNOWN" }]));
    const base = { category: "PRODUCT", actor: null, action: null, mandatory: true, mandatorySignal: null, deadline: null, submissionStage: null, technicalArea: null, addendumDisposition: "NEW", supersededById: null, confidence: "HIGH" };
    return {
      contractVersion: "tender-analysis-result-v2",
      manifest: { documents: [{ documentId: "fixture-doc", name: "Fixture.pdf", sourceRole: "BASE_TENDER" }] },
      projectSummary: "Fixture supply tender.",
      criticalFacts,
      facts: facts.map((f, i) => ({ id: `f${i + 1}`, factType: "quantity", claim: f.claim, rawValue: f.rawValue ?? null, normalizedValue: null, confidence: "HIGH", evidence: ev(f.page ?? 9), sourceRole: "BASE_TENDER", status: "ACTIVE" })),
      requirements: reqs.map((r) => ({ ...base, id: r.id, statement: `Supply ${r.object}.`, object: r.object, quantity: r.quantity ?? null, unit: r.unit ?? null, status: r.status ?? "ACTIVE", evidence: ev(r.page ?? 12) })),
      mandatoryRequirementIds: [], submissionChecklist: [], risks: [], conflicts: [], clarifications: [], resolvedAmbiguities: [], addendumChanges: [], nextActions: [], limitations: [], unknowns: [],
      evidenceCoverage: { factsWithEvidence: facts.length, factsTotal: facts.length, requirementsWithEvidence: reqs.length, requirementsTotal: reqs.length },
      metadata: { analyzerVersion: "tender-understanding-v2", resultVersion: "tender-analysis-result-v2", projectId: "fixture", startedAt: "", finishedAt: "", wallTimeMs: 0, llmCalls: 1, llmFailures: 0, models: ["fixture"], promptUsages: [], pages: 14, windows: 1, rejectedCandidates: [], inputChars: 0, outputChars: 0 },
    } as unknown as V2;
  }
  /** 走真实的入库映射与真实的入库（与分析跑完时相同的两个函数） */
  const persist = (projectId: string, runId: string, result: V2) =>
    db.$transaction((tx) => persistV2CanonicalTx(tx as unknown as PersistTx, { runId, projectId, mapped: mapV2Result(result), model: "fixture" }));

  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const url = (projectId: string) => `http://localhost/api/projects/${projectId}/bid-workspace/schedule-candidates`;
  const call = async (projectId: string, userId: string | null = OWNER) => {
    const res = await route.GET(new NextRequest(url(projectId), { headers: userId ? { cookie: await cookieOf(userId) } : {} }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: (await res.json()) as Body };
  };
  /** 这个组织与这些项目名下所有可能被写到的东西的一个快照 */
  const snapshot = async () =>
    JSON.stringify({
      audits: await db.auditLog.count({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } }),
      projects: (await db.project.findMany({ where: { id: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } })).map((p) => [p.id, p.updatedAt.toISOString()]),
      runs: (await db.tenderAnalysisRun.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } })).map((r) => [r.id, r.status, r.updatedAt.toISOString()]),
      sections: (await db.tenderAnalysisSection.findMany({ where: { run: { projectId: { in: projectIds } } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } })).map((s) => [s.id, s.updatedAt.toISOString()]),
      requirements: (await db.tenderExtractedRequirement.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, reviewStatus: true, updatedAt: true } })).map((r) => [r.id, r.reviewStatus, r.updatedAt.toISOString()]),
      orgs: (await db.organization.findMany({ where: { id: { in: [ORG, ORG_B] } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } })).map((o) => [o.id, o.updatedAt.toISOString()]),
    });

  try {
    // —— 1. 有数量线索：带入、没带入、被驳回的不出现 ——
    const p1 = await mkProject();
    await db.projectMember.create({ data: { projectId: p1, userId: VIEWER, role: "viewer", status: "active" } });
    const run1 = await mkRun(p1, "REVIEW_REQUIRED");
    await persist(p1, run1, analysis(
      [
        { id: "REQ-001", object: "Twin Mattress Cover", quantity: "2,367", unit: "Each", page: 12 },
        { id: "REQ-002", object: "Pillow Protector", quantity: "100-200", unit: "EA", page: 13 },
        { id: "REQ-003", object: "Bath Towel", quantity: "500", unit: "pcs", page: 14 },
        { id: "REQ-004", object: "Flame retardant fabric" },
        { id: "REQ-005", object: "Old Blanket", quantity: "80", unit: "EA", status: "SUPERSEDED" },
      ],
      [{ claim: "Estimated annual laundry bags", rawValue: "approx. 120 per year", page: 9 }],
    ));
    const stored = await db.tenderAnalysisSection.findFirst({ where: { runId: run1, sectionKey: "PRICING_EVALUATION" }, select: { structuredJson: true } });
    const storedItems = ((stored?.structuredJson as { scheduleCandidates?: { version?: number; items?: Array<{ code: string | null; quantityText: string | null; unitText: string | null }> } } | null)?.scheduleCandidates);
    ok(storedItems?.version === 1 && storedItems.items?.length === 4 && storedItems.items[0].quantityText === "2,367" && storedItems.items[0].unitText === "Each" && storedItems.items[2].unitText === "pcs" && !storedItems.items.some((i) => i.code === "REQ-004" || i.code === "REQ-005"), "分析入库后，「价格与评标」一节里存着 4 条数量线索：数量与单位是原文（2,367 / Each / pcs），不带数量的与被取代的不在其中", storedItems);
    const reqRows = await db.tenderExtractedRequirement.findMany({ where: { analysisRunId: run1 }, select: { requirementCode: true } });
    ok(reqRows.length === 4 && reqRows.some((r) => r.requirementCode === "REQ-003"), "入库的要求照旧（4 条有效的；要求编号就是线索里记的编号）", reqRows);

    // 一条要求被人驳回
    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: run1, requirementCode: "REQ-003" }, data: { reviewStatus: "REJECTED" } });
    const before = await snapshot();
    const r1 = await call(p1);
    const b1 = r1.body;
    ok(r1.status === 200 && b1.state === "ready" && b1.rows?.map((r) => `${r.lineNo}|${r.description}|${r.quantity}|${r.uom}`).join(";") === "1|Twin Mattress Cover|2367|Each;2|Estimated annual laundry bags|120|", "带入 2 行：2,367 → 2367、Each；估计量取 120、没有单位", b1);
    ok(b1.rows?.[0].quantityText === "2,367" && b1.rows[0].unitText === "Each" && b1.rows[0].page === 12 && b1.rows[1].quantityText === "approx. 120 per year" && b1.rows[1].page === 9 && b1.rows[1].source === "fact", "每一行带着原文数量与页码供核对");
    ok(b1.skipped?.length === 1 && b1.skipped[0].description === "Pillow Protector" && b1.skipped[0].quantityText === "100-200" && b1.skipped[0].reasonZh === "数量是一个范围", "数量是范围的那条不带入，并写明原因", b1.skipped);
    ok(!JSON.stringify(b1).includes("Bath Towel"), "已被人驳回的那条要求，线索不出现（带入的行与没带入的清单里都没有）");
    ok(!JSON.stringify(b1).includes("Old Blanket") && !JSON.stringify(b1).includes("Flame retardant"), "被取代的、不带数量的要求不出现");
    ok(b1.text === "1\tTwin Mattress Cover\t2367\tEach\n2\tEstimated annual laundry bags\t120\t", "粘贴文本：行号 ⇥ 说明 ⇥ 数量 ⇥ 单位", b1.text);
    const parsed = parseSchedulePaste(b1.text ?? "");
    ok(parsed.lines.length === 1 && parsed.lines[0].lineNo === 1 && parsed.lines[0].quantity === "2367" && parsed.lines[0].uom === "Each" && parsed.issues.length === 1 && parsed.issues[0].messageZh.includes("缺少单位"), "这段文本交给既有的粘贴解析：有单位的那行原样解析出来；没有单位的那行照常报「缺少单位」，由人补", parsed);
    ok((b1.messageZh ?? "").includes("带入了 2 行") && (b1.messageZh ?? "").includes("1 行没有单位") && (b1.messageZh ?? "").includes("逐行核对") && (b1.messageZh ?? "").includes("还没有保存"), "说明文字写明带入几行、几行没有单位、要逐行核对、还没有保存", b1.messageZh);
    ok(Object.keys(b1).sort().join() === "messageZh,rows,skipped,state,text" && !/price|cost|margin|amount|金额|单价/i.test(JSON.stringify(b1)), "响应里只有这五个字段，没有任何金额");
    ok((await snapshot()) === before, "调用前后：审计记录数、项目、分析、分析的各节、要求、组织，都没有被写过");

    // 只读成员也能带入（它只是读）
    const rViewer = await call(p1, VIEWER);
    ok(rViewer.status === 200 && rViewer.body.rows?.length === 2, "项目里的只读成员：可以带入（接口只读）", { status: rViewer.status });

    // —— 2. 权限与开关 ——
    const rAnon = await call(p1, null);
    const rOut = await call(p1, OUTSIDER);
    ok(rAnon.status === 401 && !("rows" in rAnon.body), "没登录：401，不返回任何行", rAnon);
    ok(rOut.status >= 400 && rOut.status < 500 && !("rows" in rOut.body) && !JSON.stringify(rOut.body).includes("Mattress"), "别的组织的人：被拒，拿不到任何招标内容", rOut);
    const pOrgOnly = await mkProject();
    await persist(pOrgOnly, await mkRun(pOrgOnly, "REVIEW_REQUIRED"), analysis([{ id: "REQ-001", object: "Member Only Item", quantity: "5", unit: "EA" }]));
    const rNotMember = await call(pOrgOnly, VIEWER);
    ok(rNotMember.status >= 400 && rNotMember.status < 500 && !JSON.stringify(rNotMember.body).includes("Member Only Item"), "本组织的普通成员但不是这个项目的成员：被拒", { status: rNotMember.status });

    delete process.env.TENDER_BID_WORKSPACE_ENABLED;
    const rOff = await call(p1);
    ok(rOff.status === 404 && rOff.body.error === "投标工作区未启用" && !("rows" in rOff.body), "功能开关关闭：404，不返回任何行", rOff);
    process.env.TENDER_BID_WORKSPACE_ENABLED = "1";
    process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST = ORG_B;
    const rNotListed = await call(p1);
    ok(rNotListed.status === 404, "功能只对别的组织开放：404");
    process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST = `${ORG_B},${ORG}`;
    ok((await call(p1)).status === 200, "组织在名单里：照常");
    delete process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST;

    // —— 3. 没有可用的分析 ——
    const p2 = await mkProject();
    const rNone = await call(p2);
    ok(rNone.status === 200 && rNone.body.state === "no_analysis" && rNone.body.rows?.length === 0 && rNone.body.text === "" && (rNone.body.messageZh ?? "").includes("还没有可用的招标分析"), "项目没有任何分析：说明「还没有可用的招标分析」，带入 0 行", rNone.body);
    for (const status of ["PENDING", "RUNNING", "FAILED", "SUPERSEDED", "REJECTED"]) {
      await persist(p2, await mkRun(p2, status), analysis([{ id: "REQ-001", object: `Item from ${status} run`, quantity: "9", unit: "EA" }]));
    }
    const rNotUsable = await call(p2);
    ok(rNotUsable.body.state === "no_analysis" && rNotUsable.body.rows?.length === 0, "只有排队中、进行中、失败、被取代、被驳回的分析：同样当作没有可用的分析（它们的内容不拿来用）", rNotUsable.body);

    // —— 4. 分析是在本功能之前做的 ——
    const p3 = await mkProject();
    const run3 = await mkRun(p3, "APPROVED");
    await persist(p3, run3, analysis([{ id: "REQ-001", object: "Legacy Item", quantity: "7", unit: "EA" }]));
    await db.tenderAnalysisSection.update({ where: { runId_sectionKey: { runId: run3, sectionKey: "PRICING_EVALUATION" } }, data: { structuredJson: {} } }); // 旧版本入库时这一节就是这样
    const rLegacy = await call(p3);
    ok(rLegacy.status === 200 && rLegacy.body.state === "legacy_analysis" && rLegacy.body.rows?.length === 0 && (rLegacy.body.messageZh ?? "").includes("重新分析后才能带入"), "旧的分析（这一节里没有数量线索这个键）：说明要重新分析，带入 0 行", rLegacy.body);
    const p3b = await mkProject();
    await mkRun(p3b, "APPROVED"); // 有分析但连这一节都没有
    ok((await call(p3b)).body.state === "legacy_analysis", "分析里连「价格与评标」这一节都没有：同样按旧的分析处理");

    // 分析是新的，但一条带数量的都没有
    const p4 = await mkProject();
    await persist(p4, await mkRun(p4, "REVIEW_REQUIRED"), analysis([{ id: "REQ-001", object: "Flame retardant fabric" }]));
    const rEmpty = await call(p4);
    ok(rEmpty.body.state === "ready" && rEmpty.body.rows?.length === 0 && (rEmpty.body.messageZh ?? "").includes("没有抽到带数量的行"), "新的分析但没有任何数量线索：照实说没有抽到，不说成「要重新分析」", rEmpty.body);

    // —— 5. 取哪一份：最新一份等待审核或已批准的 ——
    const p5 = await mkProject();
    await persist(p5, await mkRun(p5, "APPROVED"), analysis([{ id: "REQ-001", object: "Older Approved Item", quantity: "10", unit: "EA" }]));
    await persist(p5, await mkRun(p5, "REVIEW_REQUIRED"), analysis([{ id: "REQ-001", object: "Newer Review Item", quantity: "20", unit: "Box" }]));
    await persist(p5, await mkRun(p5, "FAILED"), analysis([{ id: "REQ-001", object: "Newest Failed Item", quantity: "30", unit: "EA" }]));
    const r5 = await call(p5);
    ok(r5.body.rows?.length === 1 && r5.body.rows[0].description === "Newer Review Item" && r5.body.rows[0].quantity === "20" && r5.body.rows[0].uom === "Box", "一个项目有三份分析：用最新一份等待审核或已批准的；更新但失败的那份不用，更早的那份也不用", r5.body.rows);
    // 同一个要求编号在旧分析里被驳回，不影响新分析里的同号要求
    const older = await db.tenderAnalysisRun.findFirst({ where: { projectId: p5, status: "APPROVED" }, select: { id: true } });
    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: older?.id, requirementCode: "REQ-001" }, data: { reviewStatus: "REJECTED" } });
    ok((await call(p5)).body.rows?.length === 1, "旧的那份分析里同号的要求被驳回：不影响当前这份分析的线索（驳回只看当前这份）");

    // —— 6. 不串项目、不串组织 ——
    const pB = await mkProject(ORG_B, OUTSIDER);
    await persist(pB, await mkRun(pB, "APPROVED", ORG_B), analysis([{ id: "REQ-001", object: "Other Org Secret Item", quantity: "77", unit: "EA" }]));
    const rMine = await call(p1);
    ok(!JSON.stringify(rMine.body).includes("Other Org Secret Item") && !JSON.stringify(rMine.body).includes("Newer Review Item"), "带入自己的项目：别的项目、别的组织的线索不会出现");
    const rCross = await call(pB, OWNER);
    ok(rCross.status >= 400 && rCross.status < 500 && !JSON.stringify(rCross.body).includes("Other Org Secret Item"), "去调别的组织的项目：被拒，拿不到它的内容", { status: rCross.status });
    ok((await call(pB, OUTSIDER)).body.rows?.[0]?.description === "Other Org Secret Item", "那个组织自己的人调自己的项目：正常");
    // 一条分析记录的组织与项目的组织对不上（数据错位）→ 不拿来用
    const p6 = await mkProject();
    await persist(p6, await mkRun(p6, "APPROVED", ORG_B), analysis([{ id: "REQ-001", object: "Mismatched Org Item", quantity: "3", unit: "EA" }]));
    const r6 = await call(p6);
    ok(r6.body.state === "no_analysis" && !JSON.stringify(r6.body).includes("Mismatched Org Item"), "分析记录上的组织不是这个项目的组织：不拿来用", r6.body);

    // —— 7. 数量很多、带入有上限 ——
    const p7 = await mkProject();
    await persist(p7, await mkRun(p7, "REVIEW_REQUIRED"), analysis(Array.from({ length: 320 }, (_, i) => ({ id: `REQ-${String(i + 1).padStart(3, "0")}`, object: `Bulk Item ${i + 1}`, quantity: String(i + 1), unit: "EA" }))));
    const r7 = await call(p7);
    const parsed7 = parseSchedulePaste(r7.body.text ?? "");
    ok(r7.body.rows?.length === 300 && r7.body.rows[299].lineNo === 300 && parsed7.lines.length === 300 && parsed7.issues.length === 0, "分析里有 320 条带数量的要求：入库存 300 条，带入 300 行（价格表的上限），解析无误", { rows: r7.body.rows?.length, skipped: r7.body.skipped?.length, parsed: parsed7.lines.length });
  } finally {
    delete process.env.TENDER_BID_WORKSPACE_ENABLED;
    delete process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST;
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }] } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } }); // 各节、事实、来源随之删除
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFIX-2 schedule prefill DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
