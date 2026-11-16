/**
 * FLOW-H5 两道闸生效——真实 DB（隔离库）+ 真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-decision-gates/__tests__/decision-gates-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不调任何模型（起草的合成不在这里跑），不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H5 两道闸 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H5 decision gates DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const entryRoute = await import("@/app/api/projects/[id]/tender-rfq/entry/route");
  const draftRoute = await import("@/app/api/projects/[id]/bid-draft/route");
  const { gatherBidDraftInputsWithBasis } = await import("@/lib/tender-bid-draft");
  const { PENDING_ANALYSIS_DRAFT_HINT_ZH } = await import("../gates");

  console.log("FLOW-H5 decision gates — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `h5owner_${stamp}`, OUTSIDER = `h5out_${stamp}`;
  const ORG = `h5org_${stamp}`, ORG_B = `h5orgb_${stamp}`;
  const users = [OWNER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { goDecision?: string | null; runStatus?: string | null } = {}) {
    seq += 1;
    const id = `h5proj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", closeDate: new Date(Date.now() + 10 * DAY) } });
    if (o.goDecision !== undefined) await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: id, goDecision: o.goDecision, goDecidedAt: o.goDecision ? new Date("2026-11-10T17:00:00Z") : null, goDecisionById: o.goDecision ? OWNER : null } as never });
    if (o.runStatus) {
      const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: id, status: o.runStatus, idempotencyKey: `h5-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER, completedAt: new Date() } });
      await db.tenderExtractedRequirement.create({ data: { projectId: id, analysisRunId: run.id, requirementCode: "R-001", category: "submission", originalRequirement: "Submit the form of tender", chineseTranslation: "提交投标书", mandatory: true, reviewStatus: "AI_EXTRACTED" } as never });
      return { id, runId: run.id };
    }
    return { id, runId: null as string | null };
  }
  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const call = async (h: unknown, url: string, projectId: string, userId = OWNER) => {
    const res = await (h as (r: unknown, c: unknown) => Promise<Response>)(new NextRequest(url, { headers: { cookie: await cookie(userId) } }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const entry = (pid: string, uid?: string) => call(entryRoute.GET, `http://localhost/api/projects/${pid}/tender-rfq/entry`, pid, uid);
  const draft = (pid: string, uid?: string) => call(draftRoute.GET, `http://localhost/api/projects/${pid}/bid-draft`, pid, uid);
  const warningsOf = (e: { body: Rec }) => (rec(e.body.state).warnings as string[] | undefined) ?? [];
  const noGoWarn = (e: { body: Rec }) => warningsOf(e).find((w) => w.startsWith("投标决定是不投"));
  const stateCore = (e: { body: Rec }) => JSON.stringify({ enabled: rec(e.body.state).enabled, reason: rec(e.body.state).reason, message: rec(e.body.state).message });
  const snapshot = async (pid: string) => JSON.stringify({
    room: await db.bidIntelligenceRoom.findUnique({ where: { projectId: pid }, select: { goDecision: true, goDecidedAt: true, updatedAt: true } }),
    runs: await db.tenderAnalysisRun.findMany({ where: { projectId: pid }, select: { id: true, status: true, updatedAt: true } }),
    reqs: await db.tenderExtractedRequirement.findMany({ where: { projectId: pid }, select: { id: true, reviewStatus: true } }),
    pa: await db.pendingAction.count({ where: { projectId: pid } }),
    audits: await db.auditLog.count({ where: { projectId: pid } }),
  });

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
    // 组织时区设成上海（与默认的不同）：2026-11-10T17:00Z 在上海是 11 月 11 日、在多伦多与 UTC 是 11 月 10 日
    await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `h5-${stamp}`, ownerId: OWNER, settingsJson: { timezone: "Asia/Shanghai" } as never } });
    await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `h5b-${stamp}`, ownerId: OUTSIDER } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

    /* ---------- 开关关闭：与原来相同 ---------- */
    const P = await mkProject({ goDecision: "NO_GO", runStatus: "REVIEW_REQUIRED" });
    delete process.env.TENDER_DECISION_GATES_ENABLED;
    const offEntry = await entry(P.id), offDraft = await draft(P.id);
    ok(offEntry.status === 200 && !noGoWarn(offEntry) && offDraft.status === 200 && !("gates" in offDraft.body), "开关关闭：询价入口没有这条提醒，起草元信息没有 gates", { w: warningsOf(offEntry), keys: Object.keys(offDraft.body) });

    /* ---------- No-Go ---------- */
    process.env.TENDER_DECISION_GATES_ENABLED = "1";
    delete process.env.TENDER_DECISION_GATES_ORG_ALLOWLIST;
    const before = await snapshot(P.id);
    const onEntry = await entry(P.id), onDraft = await draft(P.id);
    ok(noGoWarn(onEntry) === "投标决定是不投（No-Go，2026年11月11日定的）：照常可以询价，请确认是否还要问供应商要价" && onEntry.body.decisionNoGoZh === noGoWarn(onEntry), "No-Go：询价入口多一条提醒，写明哪天定的（按组织时区：上海 11 月 11 日），并单独返回给「下一步」卡片", warningsOf(onEntry));
    ok(!("decisionNoGoZh" in offEntry.body), "开关关闭时没有单独返回的那一项");
    ok(stateCore(onEntry) === stateCore(offEntry) && warningsOf(onEntry).length === warningsOf(offEntry).length + 1, "入口可用与否、原因、说明都没变，只是多一条提醒", [stateCore(onEntry), stateCore(offEntry)]);
    const g = rec(onDraft.body.gates);
    ok(g.noGoZh === "投标决定是不投（No-Go，2026年11月11日定的）：照常可以起草，请确认是否还要准备投标文件" && g.pendingAnalysisZh === PENDING_ANALYSIS_DRAFT_HINT_ZH, "起草元信息：No-Go 提醒（按组织时区）+ 当前分析还没批准的提示", g);
    ok((await snapshot(P.id)) === before, "读取前后：投标决定、分析、要求、审批卡、审计都没有变化");
    ok((await entry(P.id, OUTSIDER)).status === 403 && (await draft(P.id, OUTSIDER)).status === 403, "别的组织的人：两个接口都 403");

    /* ---------- 改回投、暂缓、没决定、没有情报室 ---------- */
    await db.bidIntelligenceRoom.update({ where: { projectId: P.id }, data: { goDecision: "GO" } });
    ok(!noGoWarn(await entry(P.id)) && rec((await draft(P.id)).body.gates).noGoZh === null, "改回 GO：提醒消失");
    const PH = await mkProject({ goDecision: "HOLD", runStatus: "APPROVED" });
    const PN = await mkProject({ goDecision: null, runStatus: "APPROVED" });
    const PR = await mkProject({ runStatus: "APPROVED" });
    for (const [label, p] of [["暂缓", PH], ["没决定", PN], ["没有情报室", PR]] as const) {
      const d = rec((await draft(p.id)).body.gates);
      ok(!noGoWarn(await entry(p.id)) && d.noGoZh === null && d.pendingAnalysisZh === null, `${label}、分析已批准：没有提醒，也没有「还没批准」的提示`, d);
    }

    /* ---------- 情报室记在别的组织名下（不该有的数据）：两处都不提醒 ---------- */
    const PX = await mkProject({ runStatus: "APPROVED" });
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG_B, projectId: PX.id, goDecision: "NO_GO", goDecidedAt: new Date("2026-11-10T17:00:00Z") } as never });
    ok(!noGoWarn(await entry(PX.id)) && rec((await draft(PX.id)).body.gates).noGoZh === null, "情报室记在别的组织名下、决定是 NO_GO：询价入口与起草都不提醒（同一个规则）");

    /* ---------- 名单 ---------- */
    process.env.TENDER_DECISION_GATES_ORG_ALLOWLIST = ORG_B;
    await db.bidIntelligenceRoom.update({ where: { projectId: P.id }, data: { goDecision: "NO_GO" } });
    ok(!noGoWarn(await entry(P.id)) && !("gates" in (await draft(P.id)).body), "组织不在名单里：同开关关闭");
    delete process.env.TENDER_DECISION_GATES_ORG_ALLOWLIST;

    /* ---------- 起草取数：所用分析与是否已批准 ---------- */
    const g1 = await gatherBidDraftInputsWithBasis({ projectId: P.id, orgId: ORG, userId: OWNER });
    ok(!!g1 && g1.basis.runId === P.runId && g1.basis.approved === false && g1.inputs.requirements.length === 1 && !JSON.stringify(g1.inputs).includes(P.runId!), "等待审核时起草：取到的就是这一份、没批准；所用分析不进起草的输入", g1?.basis);
    await new Promise((r) => setTimeout(r, 20));
    const newer = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P.id, status: "APPROVED", idempotencyKey: `h5-${stamp}-newer`, sourceHashFingerprint: "fixture", createdById: OWNER, completedAt: new Date() } });
    const g2 = await gatherBidDraftInputsWithBasis({ projectId: P.id, orgId: ORG, userId: OWNER });
    ok(!!g2 && g2.basis.runId === newer.id && g2.basis.approved === true, "之后有一份已批准的新分析：取的是新的这份、已批准", g2?.basis);
    ok(rec((await draft(P.id)).body.gates).pendingAnalysisZh === null, "当前分析已批准：起草前不再提示");
    /* ---------- 起草整段（假的合成，不调模型）：横幅与情报室里的元信息 ---------- */
    const { buildBidDraftDocument } = await import("@/lib/tender-bid-draft/generate");
    const { synthesizeBidDraft } = await import("@/lib/tender-bid-draft");
    const fakeSynth = (i: Parameters<typeof synthesizeBidDraft>[0]) => synthesizeBidDraft(i, { invoker: async () => ({ content: JSON.stringify({ coverLetterEn: "Hello", executiveSummaryEn: "S", complianceResponses: [], technicalApproachEn: "T", companyProfileEn: "C", socialValueGuidanceEn: "G", pricingSummaryEn: "P", internalNotesZh: ["注"] }), model: "fake", elapsedMs: 1 }) });
    const metaOf = async (pid: string) => rec(rec((await db.bidIntelligenceRoom.findUnique({ where: { projectId: pid }, select: { summaryJson: true } }))?.summaryJson).bidDraft);
    const PD = await mkProject({ goDecision: "GO", runStatus: "REVIEW_REQUIRED" });
    const htmlOn = await buildBidDraftDocument({ projectId: PD.id, orgId: ORG, userId: OWNER }, { synthesize: fakeSynth });
    const mOn = await metaOf(PD.id);
    ok(htmlOn.includes('data-basis="unconfirmed"') && htmlOn.includes("BASED ON UNCONFIRMED REQUIREMENTS") && mOn.analysisRunId === PD.runId && mOn.basedOnApprovedAnalysis === false, "开关开着、分析等待审核时起草：草稿里有横幅；情报室里记下所用分析、基于未批准的", mOn);
    ok(rec((await draft(PD.id)).body.draft).basedOnApprovedAnalysis === false, "起草元信息接口把这份草稿的标注带给卡片");
    delete process.env.TENDER_DECISION_GATES_ENABLED;
    const htmlOff = await buildBidDraftDocument({ projectId: PD.id, orgId: ORG, userId: OWNER }, { synthesize: fakeSynth });
    const mOff = await metaOf(PD.id);
    ok(!htmlOff.includes('data-basis="unconfirmed"') && !("analysisRunId" in mOff) && !("basedOnApprovedAnalysis" in mOff) && typeof mOff.generatedAt === "string", "开关关闭时起草：没有横幅，元信息与原来的键相同", Object.keys(mOff));
    process.env.TENDER_DECISION_GATES_ENABLED = "1";
    await db.tenderAnalysisRun.update({ where: { id: PD.runId! }, data: { status: "APPROVED" } });
    const htmlOk = await buildBidDraftDocument({ projectId: PD.id, orgId: ORG, userId: OWNER }, { synthesize: fakeSynth });
    ok(!htmlOk.includes('data-basis="unconfirmed"') && (await metaOf(PD.id)).basedOnApprovedAnalysis === true, "分析已批准时起草：没有横幅，记下基于已批准的");

    const PE = await mkProject({ goDecision: "NO_GO" });
    ok((await gatherBidDraftInputsWithBasis({ projectId: PE.id, orgId: ORG, userId: OWNER })) === null && rec((await draft(PE.id)).body.gates).pendingAnalysisZh === null, "没有可用的分析：取不到（与原来一样不能起草），也不提示「还没批准」");
  } finally {
    delete process.env.TENDER_DECISION_GATES_ENABLED;
    delete process.env.TENDER_DECISION_GATES_ORG_ALLOWLIST;
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H5 decision gates DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
