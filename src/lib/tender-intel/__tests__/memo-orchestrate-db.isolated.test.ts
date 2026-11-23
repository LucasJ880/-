/**
 * CHAIN-2d 编排接线的行为测试——真实 DB（隔离库），跑真实的 runExternalIntelForProject（交叉验证 F3）
 *
 * 截获编排交给备忘模型的那一次请求（假的模型地址，fetch 被替换），检查：
 * - 输入里的报价演算（SCORING MODEL & DETERMINISTIC PRICE SCENARIOS 那一行）键集合恰好是允许的那些，
 *   与 buildMemoPricingAnalysis 对同一份调查室数据的结果逐字相同；整段请求里搜不到我方成本、目标毛利、
 *   成本来源的落地价、我方报价与由成本算出的任何数字；
 * - 调查室没有对手价、没有联邦对标、没有现任价格带时：对手价为 null，整段请求里搜不到我方报价（不拿我方报价顶替）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-intel/__tests__/memo-orchestrate-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。模型地址指向 .invalid，所有外部请求都被替换掉，没有真实出站。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-2d 编排接线 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-2d memo orchestrate wiring DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
/** 键排序后的 JSON（Postgres jsonb 会重排对象键，比较内容时不看键的先后） */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as Rec).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Rec)[k])}`).join(",")}}` : JSON.stringify(v);

const AI_BASE = "https://ai.fixture.invalid/v1";
const MEMO_MARKER = "senior bid strategist advising the BIDDER";
const PRICING_LINE = "SCORING MODEL & DETERMINISTIC PRICE SCENARIOS";
const OUR_COST = 87654.32;
const TARGET_MARGIN = 23.7;
const LANDED = 91234.56;
const OUR_PRICE = 96543.21;

const MEMO_JSON = {
  summaryZh: "摘要",
  scoringAnalysisZh: "评分演算",
  competitiveLandscapeZh: "竞争格局",
  riskGates: [{ gateZh: "保险", statusZh: "需解决", basisZh: "依据" }],
  pricingStrategyZh: "报价策略",
  strategicRfis: [{ questionZh: "请确认交货地点", whyZh: "影响运输" }],
  teamingAdviceZh: "teaming",
  dataGapsZh: "缺口",
};

async function main() {
  const saved = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = "sk-fixture-not-a-real-key";
  process.env.OPENAI_BASE_URL = AI_BASE;

  const aiCalls: Array<{ system: string; user: string; raw: string }> = [];
  let blocked = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? String(input);
    if (url.startsWith(AI_BASE)) {
      const raw = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
      const body = rec(JSON.parse(raw || "{}"));
      const messages = (body.messages as Array<{ content?: unknown }>) ?? [];
      const system = String(messages[0]?.content ?? "");
      aiCalls.push({ system, user: String(messages[1]?.content ?? ""), raw });
      if (!system.includes(MEMO_MARKER)) {
        return new Response(JSON.stringify({ error: { message: "fixture: only the memo call is answered", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-fixture",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: String(body.model ?? "fixture-model"),
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(MEMO_JSON) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (/^https?:\/\/localhost/.test(url)) return realFetch(input as RequestInfo, init);
    blocked += 1;
    throw new Error(`blocked outbound in test: ${url}`);
  }) as typeof fetch;

  const { db } = await import("@/lib/db");
  const { runExternalIntelForProject } = await import("@/lib/tender-intel/orchestrate");
  const { buildMemoPricingAnalysis, BID_STRATEGY_MEMO_NO_COST_VERSION } = await import("@/lib/tender-intel/memo-pricing");
  const { buildScenarios, PRICING_MODEL_VERSION } = await import("@/lib/tender-pricing/calc");
  type ScoringModel = import("@/lib/tender-pricing/calc").ScoringModel;

  const MODEL = {
    version: PRICING_MODEL_VERSION,
    priceWeightPct: 30,
    costFormula: "lowest_over_bid",
    otherCriteria: [{ key: "tech", nameZh: "技术", weightPct: 70, ourPct: 70, competitorPct: 75 }],
    source: "HUMAN",
    evidenceZh: [],
    derivedAt: "2026-11-20T00:00:00.000Z",
  } as unknown as ScoringModel;
  const COST_INPUTS = {
    ourCostCad: OUR_COST,
    targetMarginPct: TARGET_MARGIN,
    ourCostSource: { kind: "compare_matrix", roundId: "round_fixture", landedTotalCad: LANDED, supplierName: "Fixture Supplier" },
    ourPriceCad: OUR_PRICE,
    ourPrice: OUR_PRICE,
    ourPriceCurrency: "CAD",
    ourPriceSource: "quote:fixture:v1",
    ourPriceStatus: "AUTHORITATIVE",
  };
  // 由我方成本算出来的数字（从 calc.ts 现算，不手写）
  const withCost = buildScenarios(MODEL, { competitorPriceCad: 100000, ourCostCad: OUR_COST, targetMarginPct: TARGET_MARGIN });
  const FORBIDDEN = new Set<string>([String(OUR_COST), String(TARGET_MARGIN), String(LANDED), String(OUR_PRICE), "96543", "96,543", "87654", "87,654"]);
  for (const sc of withCost.scenarios) {
    if (sc.marginPct != null) FORBIDDEN.add(String(sc.marginPct));
    if (sc.key === "floor" || sc.key === "cost") FORBIDDEN.add(String(sc.priceCad));
  }
  const leaks = (text: string) => [...FORBIDDEN].filter((n) => text.includes(n));
  const ALLOWED_KEYS = ["assumptionsZh", "breakEvenNoteZh", "breakEvenPriceCad", "competitorOtherPts", "costExcludedZh", "inputs", "model", "ourOtherPts", "scenarios"];
  const SCENARIO_KEYS = ["competitorTotal", "deltaPts", "key", "labelZh", "ourTotal", "priceCad"];
  const keysOf = (v: unknown) => Object.keys(rec(v)).sort();
  const pricingOf = (user: string): unknown => {
    const lines = user.split("\n");
    const i = lines.findIndex((l) => l.startsWith(PRICING_LINE));
    if (i < 0) return undefined;
    try { return JSON.parse(lines[i + 1] ?? ""); } catch { return "UNPARSABLE"; }
  };

  console.log("CHAIN-2d memo orchestrate wiring — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `moowner_${stamp}`;
  const ORG = `moorg_${stamp}`;
  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `mo-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(summaryJson: Rec) {
    seq += 1;
    const id = `moproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", clientOrganization: "Fixture Buyer" } as never });
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: id, summaryJson: summaryJson as never } });
    await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: id, status: "REVIEW_REQUIRED", idempotencyKey: `morun_${stamp}_${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER, summaryJson: {} } });
    return id;
  }
  async function runOnce(projectId: string) {
    const before = aiCalls.length;
    const outcome = await runExternalIntelForProject({ projectId, trigger: "manual", env: { TENDER_EXTERNAL_INTEL_ENABLED: "1" } });
    const memoCalls = aiCalls.slice(before).filter((c) => c.system.includes(MEMO_MARKER));
    const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true } });
    return { outcome, memoCalls, stored: rec(rec(room?.summaryJson).bidStrategyMemo) };
  }

  try {
    // —— 有对手价（人工填的）——
    const roomA = { pricingModel: MODEL, pricingInputs: { competitorPriceCad: 100000, ...COST_INPUTS }, incumbentLead: { priceBandCad: { low: 80000, high: 120000 } } };
    const a = await runOnce(await mkProject(roomA));
    ok(a.outcome.strategyGenerated === true && a.memoCalls.length === 1 && a.stored.version === BID_STRATEGY_MEMO_NO_COST_VERSION, "有对手价：编排跑完、合成一次备忘并存成 v3", { outcome: a.outcome, memoCalls: a.memoCalls.length, version: a.stored.version });
    const pa = pricingOf(a.memoCalls[0]?.user ?? "");
    ok(JSON.stringify(keysOf(pa)) === JSON.stringify(ALLOWED_KEYS) && JSON.stringify(keysOf(rec(pa).inputs)) === JSON.stringify(["competitorPriceCad"]) && JSON.stringify(keysOf(rec(pa).model)) === JSON.stringify(["costFormula", "otherCriteria", "priceWeightPct", "source"]) && ((rec(pa).scenarios as unknown[]) ?? []).length > 0 && ((rec(pa).scenarios as unknown[]) ?? []).every((sc) => JSON.stringify(keysOf(sc)) === JSON.stringify(SCENARIO_KEYS)), "有对手价：交给模型的报价演算键集合恰好是允许的那些（输入只有对手价）", pa);
    ok(canon(pa) === canon(buildMemoPricingAnalysis({ model: MODEL, roomSummary: roomA, vendorPriceBenchmark: null })) && rec(rec(pa).inputs).competitorPriceCad === 100000, "有对手价：报价演算与 buildMemoPricingAnalysis 对同一份调查室数据的结果相同（不看键的先后）", pa);
    ok(a.memoCalls.length > 0 && a.memoCalls.every((c) => leaks(c.raw).length === 0), "有对手价：整段请求里搜不到我方成本、目标毛利、落地价、我方报价与由成本算出的数字", a.memoCalls.map((c) => leaks(c.raw)));

    // —— 没有对手价、没有联邦对标、没有现任价格带（只有我方成本与我方报价）——
    const roomB = { pricingModel: MODEL, pricingInputs: { ...COST_INPUTS } };
    const b = await runOnce(await mkProject(roomB));
    const pb = pricingOf(b.memoCalls[0]?.user ?? "");
    ok(b.outcome.strategyGenerated === true && b.memoCalls.length === 1, "没有对手价：编排照样合成一次备忘", { outcome: b.outcome, memoCalls: b.memoCalls.length });
    ok(JSON.stringify(keysOf(pb)) === JSON.stringify(ALLOWED_KEYS) && rec(rec(pb).inputs).competitorPriceCad === null && JSON.stringify(keysOf(rec(pb).inputs)) === JSON.stringify(["competitorPriceCad"]), "没有对手价：对手价为 null，不拿我方报价或成本顶替；键集合不变", pb);
    ok(b.memoCalls.length > 0 && b.memoCalls.every((c) => leaks(c.raw).length === 0), "没有对手价：整段请求里搜不到我方报价、我方成本与由成本算出的数字", b.memoCalls.map((c) => leaks(c.raw)));

    ok(aiCalls.every((c) => c.raw.length > 0), `模型请求都指向假的模型地址（${aiCalls.length} 次，其中备忘 ${a.memoCalls.length + b.memoCalls.length} 次）；其余外部请求全部被挡（${blocked} 次，没有发出）`);
  } finally {
    globalThis.fetch = realFetch;
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = saved.base;
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: OWNER }, { projectId: { in: projectIds } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }

  console.log(`\nCHAIN-2d memo orchestrate DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
