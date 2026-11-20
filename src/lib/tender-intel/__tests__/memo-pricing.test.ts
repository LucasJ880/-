/**
 * CHAIN-2d 投标策略备忘送进模型前去掉我方成本：纯函数、真实模型调用函数（假 invoker 捕获每一次请求）、源码断言
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts
 * 零 DB、零真实出站、零真实模型调用。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildScenarios, PRICING_MODEL_VERSION, type ScoringModel } from "../../tender-pricing/calc";
import { deriveAwardIntelligence } from "../award-intelligence";
import {
  BID_STRATEGY_MEMO_NO_COST_VERSION,
  BID_STRATEGY_MEMO_NO_COST_VERSIONS,
  LEGACY_MEMO_PRICING_NOTE_ZH,
  LEGACY_MEMO_REDACTED_ZH,
  MEMO_COST_EXCLUDED_ZH,
  buildMemoPricingAnalysis,
  isNoCostMemo,
  memoCompetitorPrice,
  redactLegacyMemo,
} from "../memo-pricing";
import { BID_STRATEGY_MEMO_PROMPT, BID_STRATEGY_MEMO_VERSION, synthesizeBidStrategyMemo } from "../strategy";
import type { LlmCallRequest, LlmInvoker } from "../../tender-understanding/llm";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : ""); }
}

const MODEL = {
  version: PRICING_MODEL_VERSION,
  priceWeightPct: 30,
  costFormula: "lowest_over_bid",
  otherCriteria: [{ key: "tech", nameZh: "技术", weightPct: 70, ourPct: 70, competitorPct: 75 }],
  source: "HUMAN",
  evidenceZh: [],
  derivedAt: "2026-11-20T00:00:00.000Z",
} as unknown as ScoringModel;
const OUR_COST = 87654.32;
const TARGET_MARGIN = 23.7;
const LANDED = 91234.56; // 成本来源里的落地价（少见数字）
const OUR_PRICE = 96543.21;
const ROOM = {
  pricingInputs: {
    competitorPriceCad: 100000,
    ourCostCad: OUR_COST,
    targetMarginPct: TARGET_MARGIN,
    ourCostSource: { kind: "compare_matrix", roundId: "round_fixture", landedTotalCad: LANDED, supplierName: "Fixture Supplier" },
    ourPriceCad: OUR_PRICE,
  },
  incumbentLead: { vendor: "Fixture Incumbent", priceBandCad: { low: 80000, high: 120000 } },
};

/** 改动前 orchestrate.ts 的装配（对照组）：带我方成本与目标毛利算情景，原样交给备忘 */
function oldAssembly(model: ScoringModel, rsj: typeof ROOM, bench: unknown) {
  const inputs = rsj.pricingInputs;
  const band = rsj.incumbentLead?.priceBandCad;
  const benchMedian = (bench as { median?: number | null } | null)?.median ?? null;
  const competitor = inputs.competitorPriceCad ?? benchMedian ?? (band?.low != null && band?.high != null ? Math.round((band.low + band.high) / 2) : null);
  const result = buildScenarios(model, { competitorPriceCad: competitor, ourCostCad: inputs.ourCostCad ?? null, targetMarginPct: inputs.targetMarginPct ?? null });
  return {
    model: { priceWeightPct: model.priceWeightPct, costFormula: model.costFormula, otherCriteria: model.otherCriteria, source: model.source },
    inputs: { competitorPriceCad: competitor, ourCostCad: inputs.ourCostCad ?? null, targetMarginPct: inputs.targetMarginPct ?? null },
    breakEvenPriceCad: result.breakEvenPriceCad,
    breakEvenNoteZh: result.breakEvenNoteZh,
    ourOtherPts: result.ourOtherPts,
    competitorOtherPts: result.competitorOtherPts,
    scenarios: result.scenarios.map((sc) => ({ key: sc.key, labelZh: sc.labelZh, priceCad: sc.priceCad, ourTotal: sc.ourTotal, competitorTotal: sc.competitorTotal, deltaPts: sc.deltaPts, marginPct: sc.marginPct })),
    assumptionsZh: result.assumptionsZh,
  };
}

// 由我方成本算出来的所有数字（从 calc.ts 现算，不手写）
const withCost = buildScenarios(MODEL, { competitorPriceCad: 100000, ourCostCad: OUR_COST, targetMarginPct: TARGET_MARGIN });
const derived = new Set<string>([String(OUR_COST), String(TARGET_MARGIN), String(LANDED), String(OUR_PRICE)]);
for (const sc of withCost.scenarios) {
  if (sc.marginPct != null) derived.add(String(sc.marginPct));
  if (sc.key === "floor" || sc.key === "cost") derived.add(String(sc.priceCad));
}
const FORBIDDEN = [...derived];
const leaks = (text: string) => FORBIDDEN.filter((n) => text.includes(n));

function capturingInvoker() {
  const calls: LlmCallRequest[] = [];
  const invoker: LlmInvoker = async (req) => {
    calls.push(req);
    return {
      model: "fixture-model",
      elapsedMs: 1,
      content: JSON.stringify({
        summaryZh: "摘要",
        scoringAnalysisZh: "评分演算",
        competitiveLandscapeZh: "竞争格局",
        riskGates: [{ gateZh: "保险", statusZh: "需解决", basisZh: "依据" }],
        pricingStrategyZh: "报价策略",
        strategicRfis: [{ questionZh: "问题", whyZh: "理由" }],
        teamingAdviceZh: "teaming",
        dataGapsZh: "缺口",
      }),
    };
  };
  return { calls, invoker };
}
const memoInput = (pricingAnalysis: unknown, invoker: LlmInvoker) => ({
  project: { nameZh: "Fixture Tender", buyer: "Fixture Buyer", closeDate: "2026-12-01", estimatedValue: null, currency: "CAD" },
  facts: [{ kind: "FACT", contentZh: "价格占 30%" }],
  mandatoryRequirements: ["提供保险证明"],
  analystBrief: { summaryZh: "fixture" },
  intelligence: deriveAwardIntelligence([]),
  incumbentLead: ROOM.incumbentLead,
  vendorPriceBenchmark: null,
  pricingAnalysis,
  existingClarifications: [],
  invoker,
});
const wholeInput = (calls: LlmCallRequest[]) => calls.map((c) => `${c.systemPrompt}\n${c.userPrompt}`).join("\n");

async function main() {
  console.log("报价演算（纯函数）");
  {
    ok("对照：由成本算出的数字至少有成本、目标毛利、成本底价与 5 个情景毛利", FORBIDDEN.length >= 8 && withCost.scenarios.some((s) => s.key === "floor"), FORBIDDEN);
    const a = buildMemoPricingAnalysis({ model: MODEL, roomSummary: ROOM, vendorPriceBenchmark: null });
    const text = JSON.stringify(a);
    ok("新的演算：搜不到我方成本、目标毛利、落地价、我方报价与任何由成本算出的数字", leaks(text).length === 0, leaks(text));
    ok("新的演算：没有毛利字段、没有成本底价情景、没有成本类输入字段", !/marginPct|ourCostCad|targetMarginPct|ourCostSource|ourPriceCad/.test(text) && !a.scenarios.some((s) => s.key === "floor" || s.key === "cost"));
    const noCost = buildScenarios(MODEL, { competitorPriceCad: 100000, ourCostCad: null, targetMarginPct: null });
    ok("对手价情景与打平价与不传成本时相同", JSON.stringify(a.scenarios) === JSON.stringify(noCost.scenarios.map((s) => ({ key: s.key, labelZh: s.labelZh, priceCad: s.priceCad, ourTotal: s.ourTotal, competitorTotal: s.competitorTotal, deltaPts: s.deltaPts }))) && a.breakEvenPriceCad === noCost.breakEvenPriceCad && a.scenarios.map((s) => s.key).sort().join() === "breakeven,match,under10,under15,under5");
    ok("假设里不写「未填我方成本」，另附一句成本不提供", !a.assumptionsZh.some((x) => x.includes("未填我方成本")) && a.costExcludedZh === "我方成本、目标毛利与成本底价只给有财务查看权的人看，这里不提供；不要推测。" && a.costExcludedZh === MEMO_COST_EXCLUDED_ZH);
    ok("对照组：改动前的装配里搜得到成本与由成本算出的数字", leaks(JSON.stringify(oldAssembly(MODEL, ROOM, null))).length >= 7, leaks(JSON.stringify(oldAssembly(MODEL, ROOM, null))));
    ok("对手价顺序：人工 > 联邦对标中位 > 现任价格带中位", memoCompetitorPrice(ROOM, { median: 5 }) === 100000 && memoCompetitorPrice({ ...ROOM, pricingInputs: {} }, { median: 5 }) === 5 && memoCompetitorPrice({ ...ROOM, pricingInputs: {} }, null) === 100000 && memoCompetitorPrice({}, null) === null);
  }

  console.log("交给备忘模型的整段输入（假 invoker 捕获每一次请求）");
  {
    const neu = capturingInvoker();
    const r = await synthesizeBidStrategyMemo(memoInput(buildMemoPricingAnalysis({ model: MODEL, roomSummary: ROOM, vendorPriceBenchmark: null }), neu.invoker));
    const whole = wholeInput(neu.calls);
    ok("模型只调用一次（没有多出的模型调用）", neu.calls.length === 1, neu.calls.length);
    ok("整段输入（系统提示 + 用户输入）里搜不到成本与由成本算出的任何数字", leaks(whole).length === 0, leaks(whole));
    ok("新备忘的版本是 v3、提示词版本 4", r.memo?.version === "tender-bid-strategy-memo/v3" && BID_STRATEGY_MEMO_VERSION === BID_STRATEGY_MEMO_NO_COST_VERSION && BID_STRATEGY_MEMO_NO_COST_VERSIONS.has(r.memo!.version) && neu.calls[0].promptVersion === "4" && BID_STRATEGY_MEMO_PROMPT.version === "4");
    const old = capturingInvoker();
    await synthesizeBidStrategyMemo(memoInput(oldAssembly(MODEL, ROOM, null), old.invoker));
    const oldWhole = wholeInput(old.calls);
    ok("对照组：用改动前的装配，整段输入里搜得到成本、成本底价与情景毛利", oldWhole.includes(String(OUR_COST)) && leaks(oldWhole).length >= 7, leaks(oldWhole));
    const sys = neu.calls[0].systemPrompt;
    ok("提示词：逐字引用那一条不再提毛利", sys.includes("each scenario's price and total-score delta") && !/delta\/margin/.test(sys) && /quote its numbers verbatim/.test(sys) && /do NOT recompute/.test(sys));
    ok("提示词：写明演算不含成本，不得陈述、估算或推测成本、毛利、成本底价，也不得把缺成本列为数据缺口", sys.includes("deliberately excludes our cost, our target margin and cost-floor scenarios") && sys.includes("Never state, estimate or infer our cost, our margin or a cost floor anywhere in the memo") && sys.includes("do NOT list our missing cost or margin as a data gap"));
  }

  console.log("旧版备忘的裁剪");
  {
    const legacy = {
      version: "tender-bid-strategy-memo/v2",
      label: "AI_INFERRED",
      summaryZh: `我方成本 ${OUR_COST}，跟价毛利 12.35%`,
      scoringAnalysisZh: `成本价 ${OUR_COST} 时总分落后`,
      competitiveLandscapeZh: "现任是 Fixture Incumbent",
      riskGates: [{ gateZh: "保险", statusZh: "需解决", basisZh: "要 500 万保险" }, { gateZh: "价格", statusZh: "高风险", basisZh: "让价 15% 后毛利为负" }],
      pricingStrategyZh: `底价 ${withCost.scenarios.find((s) => s.key === "floor")!.priceCad}`,
      strategicRfis: [{ questionZh: "请确认交货地点", whyZh: "影响运输" }, { questionZh: "Is the cost formula lowest/bid?", whyZh: "影响报价" }],
      teamingAdviceZh: "与本地分包商合作",
      dataGapsZh: "缺我方成本",
    };
    const r = redactLegacyMemo(legacy);
    const text = JSON.stringify(r);
    ok("v2：评分演算、报价策略置空，带标记", r.scoringAnalysisZh === "" && r.pricingStrategyZh === "" && (r as Record<string, unknown>).legacyCostRedacted === true);
    ok("v2：碰到成本类字眼的段落换成固定的话，其余照旧", r.summaryZh === LEGACY_MEMO_REDACTED_ZH && r.dataGapsZh === LEGACY_MEMO_REDACTED_ZH && r.competitiveLandscapeZh === "现任是 Fixture Incumbent" && r.teamingAdviceZh === "与本地分包商合作" && r.riskGates[0].basisZh === "要 500 万保险" && r.riskGates[1].basisZh === LEGACY_MEMO_REDACTED_ZH && LEGACY_MEMO_REDACTED_ZH === "（旧版备忘的这一段可能提到我方成本或毛利，已隐藏。）");
    ok("v2：碰到成本类字眼的 RFI 整条去掉（不放占位句进澄清问题文件）", r.strategicRfis.length === 1 && r.strategicRfis[0].questionZh === "请确认交货地点");
    ok("v2：裁剪结果里搜不到成本与由成本算出的数字", leaks(text).length === 0 && !text.includes("12.35"), leaks(text));
    const v3 = { ...legacy, version: "tender-bid-strategy-memo/v3" };
    ok("v3：原样（同一个对象）", redactLegacyMemo(v3) === v3 && isNoCostMemo(v3) && !isNoCostMemo(legacy));
    ok("没有版本号的按旧版处理；不是对象原样", (redactLegacyMemo({ summaryZh: "毛利" }) as Record<string, unknown>).legacyCostRedacted === true && redactLegacyMemo(null) === null && redactLegacyMemo("x") === "x");
    ok("卡片那句话", LEGACY_MEMO_PRICING_NOTE_ZH === "报价策略：这份策略备忘是旧版生成的，可能含我方成本或毛利，已隐藏；请有编辑权限的同事重新检索外部情报，会生成新的。");
  }

  console.log("接线（源码断言）");
  {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const orch = strip(read("src/lib/tender-intel/orchestrate.ts"));
    ok("编排：报价演算改用纯函数，不再读我方成本、目标毛利、不再自己调 buildScenarios", orch.includes("buildMemoPricingAnalysis({ model, roomSummary: rsj, vendorPriceBenchmark })") && !/ourCostCad|targetMarginPct|ourCostSource/.test(orch) && !/buildScenarios\(/.test(orch));
    const readers: Array<[string, RegExp]> = [
      ["src/app/api/projects/[id]/external-intel/award-history/route.ts", /bidStrategyMemo: redactLegacyMemo\(sj\.bidStrategyMemo \?\? null\)/],
      ["src/app/api/projects/[id]/workbench-summary/route.ts", /const memo = redactLegacyMemo\(sj\.bidStrategyMemo \?\? null\)/],
      ["src/lib/projects/generate/generate-docs.ts", /const memo = redactLegacyMemo\(\(\(roomForRfi\?\.summaryJson as Record<string, unknown>\) \?\? \{\}\)\.bidStrategyMemo \?\? null\)/],
      ["src/lib/tender-bid-draft/gather.ts", /const memoRaw = redactLegacyMemo\(rsj\.bidStrategyMemo \?\? null\)/],
    ];
    for (const [f, re] of readers) ok(`${f}：读备忘先过 redactLegacyMemo`, re.test(read(f)) && (read(f).match(/\.bidStrategyMemo/g) ?? []).length === (read(f).match(/redactLegacyMemo\(/g) ?? []).length);
    const expected = ["src/components/tender-intel/org-award-intel-slots.tsx", ...readers.map((r) => r[0])].sort();
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(p); }
        else if (/\.(ts|tsx)$/.test(e.name) && read(p).includes("bidStrategyMemo")) found.push(p);
      }
    };
    walk("src");
    const others = found.filter((p) => !["src/lib/tender-intel/orchestrate.ts", "src/lib/tender-intel/strategy.ts", "src/lib/tender-intel/memo-pricing.ts"].includes(p)).sort();
    ok("没有别的读备忘的地方漏掉（src 下除编排、提示词与本模块外只有这几处）", JSON.stringify(others) === JSON.stringify(expected), others);
    const card = read("src/components/tender-intel/org-award-intel-slots.tsx");
    ok("卡片：旧版时报价策略一行写那句话", card.includes("{memo.legacyCostRedacted ? LEGACY_MEMO_PRICING_NOTE_ZH : `报价策略：${memo.pricingStrategyZh.slice(0, 160)}`}"));
    const lib = read("src/lib/tender-intel/memo-pricing.ts");
    ok("纯函数模块不碰库、不出站、不调模型", !/@\/lib\/db|fetch\(|callStructured|createUnifiedRuntimeInvoker/.test(strip(lib)));
    const e2e = read("scripts/bid-strategy-memo-e2e.ts");
    ok("E2E 脚本认 v3", e2e.includes('String(memo.version) === "tender-bid-strategy-memo/v3"'));
  }

  console.log(`\nmemo-pricing: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
