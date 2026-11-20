/**
 * CHAIN-2d 旧版投标策略备忘的裁剪——真实 DB（隔离库），调用真实路由与投标文件草稿的输入装配
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-intel/__tests__/memo-legacy-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。外部请求一律被替换成计数后报错的假函数；不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-2d 旧版策略备忘裁剪 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-2d legacy memo redaction DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

const OUR_COST = "87654.32";
const FLOOR = "114881.15";
const MARGIN = "12.35";

async function main() {
  let outbound = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (!/^https?:\/\/localhost/.test(url)) { outbound += 1; throw new Error(`blocked outbound in test: ${url}`); }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
  const savedFlag = process.env.TENDER_EXTERNAL_INTEL_ENABLED;
  process.env.TENDER_EXTERNAL_INTEL_ENABLED = "1";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const awardHistory = await import("@/app/api/projects/[id]/external-intel/award-history/route");
  const workbench = await import("@/app/api/projects/[id]/workbench-summary/route");
  const { gatherBidDraftInputs } = await import("@/lib/tender-bid-draft/gather");
  const { LEGACY_MEMO_REDACTED_ZH, LEGACY_MEMO_WORKBENCH_ZH } = await import("@/lib/tender-intel/memo-pricing");

  console.log("CHAIN-2d legacy memo redaction — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `mlowner_${stamp}`, VIEWER = `mlviewer_${stamp}`;
  const ORG = `mlorg_${stamp}`;
  const users = [OWNER, VIEWER];
  const email = (id: string) => `${id}@fixture.test`;
  await db.user.create({ data: { id: OWNER, email: email(OWNER), name: "Fixture Owner", role: "user" } });
  await db.user.create({ data: { id: VIEWER, email: email(VIEWER), name: "Fixture Viewer", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `ml-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });

  const memo = (version: string) => ({
    version,
    label: "AI_INFERRED",
    generatedAt: "2026-11-01T00:00:00.000Z",
    model: "fixture",
    summaryZh: `按我方成本 ${OUR_COST} 计，跟价毛利 ${MARGIN}%`,
    scoringAnalysisZh: `成本 + 目标毛利底价 ${FLOOR}`,
    competitiveLandscapeZh: "现任是 Fixture Incumbent",
    riskGates: [{ gateZh: "保险", statusZh: "需解决", basisZh: "要 500 万保险" }, { gateZh: "价格", statusZh: "高风险", basisZh: `低于 ${FLOOR} 亏毛利` }],
    pricingStrategyZh: `不要低于底价 ${FLOOR}`,
    strategicRfis: [{ questionZh: "请确认交货地点", whyZh: "影响运输" }, { questionZh: "成本评分公式是最低价除以本标价吗？", whyZh: "影响报价" }],
    teamingAdviceZh: "与本地分包商合作",
    dataGapsZh: "缺对手价",
  });
  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(memoVersion: string) {
    seq += 1;
    const id = `mlproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", clientOrganization: "Fixture Buyer" } as never });
    await db.projectMember.create({ data: { projectId: id, userId: VIEWER, role: "viewer", status: "active" } });
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: id, summaryJson: { bidStrategyMemo: memo(memoVersion), pricingInputs: { competitorPriceCad: 100000, ourCostCad: Number(OUR_COST), targetMarginPct: 23.7 } } as never } });
    await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: id, status: "REVIEW_REQUIRED", idempotencyKey: `mlrun_${stamp}_${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER, summaryJson: {} } });
    return id;
  }
  const cookieOf = async (u: string) => `qy_session=${await createSession({ sub: u, email: email(u), role: "user" })}`;
  const getJson = async (mod: { GET: (r: never, c: never) => Promise<Response> }, path: string, id: string, u: string) => {
    const res = await mod.GET(new NextRequest(`http://localhost${path}`, { headers: { cookie: await cookieOf(u) } }) as never, { params: Promise.resolve({ id }) } as never);
    const text = await res.text();
    return { status: res.status, text, json: rec(JSON.parse(text || "{}")) };
  };
  const costHits = (text: string) => [OUR_COST, FLOOR, MARGIN].filter((n) => text.includes(n));

  try {
    const pOld = await mkProject("tender-bid-strategy-memo/v2");
    const pNew = await mkProject("tender-bid-strategy-memo/v3");

    // —— 情报页签（只读成员）——
    const ahOld = await getJson(awardHistory, `/api/projects/${pOld}/external-intel/award-history`, pOld, VIEWER);
    const mOld = rec(ahOld.json.bidStrategyMemo);
    ok(ahOld.status === 200 && mOld.legacyCostRedacted === true && mOld.scoringAnalysisZh === "" && mOld.pricingStrategyZh === "" && mOld.summaryZh === LEGACY_MEMO_REDACTED_ZH && mOld.competitiveLandscapeZh === "现任是 Fixture Incumbent", "情报页签：旧版备忘两段为空、带标记，碰到成本的摘要换掉，其余照旧", mOld);
    ok(costHits(ahOld.text).length === 0, "情报页签：整个响应里搜不到成本、成本底价与毛利", costHits(ahOld.text));
    const ahNew = await getJson(awardHistory, `/api/projects/${pNew}/external-intel/award-history`, pNew, VIEWER);
    const mNew = rec(ahNew.json.bidStrategyMemo);
    ok(ahNew.status === 200 && mNew.legacyCostRedacted === undefined && String(mNew.pricingStrategyZh).includes(FLOOR), "情报页签：v3 备忘原样给出", mNew);

    // —— 工作台摘要 ——
    const wbOld = await getJson(workbench, `/api/projects/${pOld}/workbench-summary`, pOld, VIEWER);
    const strategy = rec(rec(wbOld.json.intel).strategy);
    const points = (strategy.keyPoints as Array<{ pointZh: string }>) ?? [];
    ok(wbOld.status === 200 && strategy.strategyZh === LEGACY_MEMO_WORKBENCH_ZH && strategy.legacyCostRedacted === true && points.length === 2 && points.every((p) => !p.pointZh.includes(LEGACY_MEMO_REDACTED_ZH)) && costHits(wbOld.text).length === 0, "工作台摘要：旧版写固定说明、带标记、风险门照列（名称没被隐藏），整个响应里搜不到成本数字", { status: wbOld.status, strategy, hits: costHits(wbOld.text) });
    const wbNew = await getJson(workbench, `/api/projects/${pNew}/workbench-summary`, pNew, VIEWER);
    const sNew = rec(rec(wbNew.json.intel).strategy);
    ok(wbNew.status === 200 && String(sNew.strategyZh).includes(OUR_COST) && sNew.legacyCostRedacted === undefined, "工作台摘要：v3 备忘原样", sNew);

    // —— 投标文件草稿的输入（交给起草模型的那一份）——
    const inputs = await gatherBidDraftInputs({ projectId: pOld, orgId: ORG, userId: OWNER });
    const inText = JSON.stringify(inputs?.memo ?? null);
    ok(!!inputs?.memo && costHits(inText).length === 0 && !inText.includes(LEGACY_MEMO_REDACTED_ZH) && inputs.memo.summaryZh === null && inputs.memo.riskGates.every((g) => g.basisZh === null) && inputs.memo.riskGates[0].gateZh === "保险" && inputs.memo.teamingAdviceZh === "与本地分包商合作" && inputs.rfiCount === 1, "投标文件草稿的输入：旧版备忘裁剪后再交给起草模型——被隐藏的段落是 null、不送占位句，碰到成本的 RFI 不计", inputs?.memo);
    const inputsNew = await gatherBidDraftInputs({ projectId: pNew, orgId: ORG, userId: OWNER });
    ok(inputsNew?.rfiCount === 2 && String(inputsNew?.memo?.summaryZh).includes(OUR_COST), "投标文件草稿的输入：v3 备忘原样");

    ok(outbound === 0, "整个过程外部请求 0 次", outbound);
  } finally {
    globalThis.fetch = realFetch;
    if (savedFlag === undefined) delete process.env.TENDER_EXTERNAL_INTEL_ENABLED;
    else process.env.TENDER_EXTERNAL_INTEL_ENABLED = savedFlag;
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nCHAIN-2d legacy memo DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
