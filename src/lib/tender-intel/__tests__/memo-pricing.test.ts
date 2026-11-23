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
  LEGACY_MEMO_CARD_NOTE_ZH,
  LEGACY_MEMO_PRICING_LINE_ZH,
  LEGACY_MEMO_REDACTED_ZH,
  LEGACY_MEMO_WORKBENCH_ZH,
  MEMO_COST_EXCLUDED_ZH,
  MEMO_COST_POINTER_ZH,
  buildMemoPricingAnalysis,
  isNoCostMemo,
  legacyRfiWithheldNoteZh,
  looksCostRelated,
  memoCompetitorPrice,
  normalizeForCostCheck,
  placeholderToNull,
  redactLegacyMemo,
} from "../memo-pricing";
import { buildRfiItems, renderRfiHtml } from "../../projects/generate/rfi-export";
import { BID_STRATEGY_MEMO_PROMPT, BID_STRATEGY_MEMO_VERSION, synthesizeBidStrategyMemo } from "../strategy";
import type { LlmCallRequest, LlmInvoker } from "../../tender-understanding/llm";
import { LEGACY_PROBES } from "./fixtures/legacy-memo-probes";

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
// 改动前的装配会带出的恰好这 8 个：成本、目标毛利、成本底价、跟价 / 让价 5% / 10% / 15% / 打平价五个情景的毛利
const OLD_EXPOSED = new Set<string>([String(OUR_COST), String(TARGET_MARGIN)]);
for (const sc of withCost.scenarios) {
  if (sc.key === "floor") OLD_EXPOSED.add(String(sc.priceCad));
  else if (sc.marginPct != null) OLD_EXPOSED.add(String(sc.marginPct));
}
const leaks = (text: string) => FORBIDDEN.filter((n) => text.includes(n));

function capturingInvoker(invalidFirst = 0) {
  const calls: LlmCallRequest[] = [];
  const invoker: LlmInvoker = async (req) => {
    calls.push(req);
    if (calls.length <= invalidFirst) return { model: "fixture-model", elapsedMs: 1, content: "not json at all" };
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
    ok("假设里不写「未填我方成本」，另附一句成本不提供", !a.assumptionsZh.some((x) => x.includes("未填我方成本")) && a.costExcludedZh === "我方成本、成本底价与毛利不在这里提供；不要推测。" && a.costExcludedZh === MEMO_COST_EXCLUDED_ZH);
    const oldLeaks = new Set(leaks(JSON.stringify(oldAssembly(MODEL, ROOM, null))));
    ok("对照组：改动前的装配恰好带出成本、目标毛利、成本底价与五个情景毛利这 8 个数", OLD_EXPOSED.size === 8 && oldLeaks.size === 8 && [...OLD_EXPOSED].every((n) => oldLeaks.has(n)), { expected: [...OLD_EXPOSED], got: [...oldLeaks] });
    ok("没有对手价、联邦对标与价格带时对手价为 null：不拿我方报价、成本或落地价顶替", memoCompetitorPrice({ pricingInputs: { ...ROOM.pricingInputs, competitorPriceCad: null } }, null) === null && memoCompetitorPrice({ pricingInputs: { ...ROOM.pricingInputs, competitorPriceCad: undefined } }, { vendor: "x" }) === null && buildMemoPricingAnalysis({ model: MODEL, roomSummary: { pricingInputs: { ...ROOM.pricingInputs, competitorPriceCad: null } }, vendorPriceBenchmark: null }).inputs.competitorPriceCad === null);
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
    const oldWhole = new Set(leaks(wholeInput(old.calls)));
    ok("对照组：用改动前的装配，整段输入里恰好搜得到那 8 个数", oldWhole.size === 8 && [...OLD_EXPOSED].every((n) => oldWhole.has(n)), [...oldWhole]);
    const retry = capturingInvoker(1);
    const rr = await synthesizeBidStrategyMemo(memoInput(buildMemoPricingAnalysis({ model: MODEL, roomSummary: ROOM, vendorPriceBenchmark: null }), retry.invoker));
    ok("第一次输出不合格时有界重试一次：共两次请求，两次的整段输入里都搜不到成本类数字", !!rr.memo && retry.calls.length === 2 && leaks(wholeInput(retry.calls)).length === 0, { calls: retry.calls.length, leaks: leaks(wholeInput(retry.calls)) });
    const sys = neu.calls[0].systemPrompt;
    ok("提示词：逐字引用那一条不再提毛利", sys.includes("each scenario's price and total-score delta") && !/delta\/margin/.test(sys) && /quote its numbers verbatim/.test(sys) && /do NOT recompute/.test(sys));
    ok("提示词：写明演算不含成本，不得陈述、估算或推测成本、毛利、成本底价，也不得把缺成本列为数据缺口、不得提成本被隐去", sys.includes("deliberately excludes our cost, our target margin and cost-floor scenarios") && sys.includes("Never state, estimate or infer our cost, our margin or a cost floor anywhere in the memo") && sys.includes("do NOT list our missing cost or margin as a data gap") && sys.includes("Do not mention that cost data was withheld or who may see it."));
  }

  console.log("旧版备忘的裁剪");
  {
    const legacy = {
      version: "tender-bid-strategy-memo/v2",
      label: "AI_INFERRED",
      summaryZh: "这一段不提任何数字也会整段换掉",
      scoringAnalysisZh: `成本价 ${OUR_COST} 时总分落后`,
      competitiveLandscapeZh: "现任是 Fixture Incumbent",
      riskGates: [{ gateZh: "保险", statusZh: "需解决", basisZh: "要保险证明" }, { gateZh: "价格", statusZh: "高风险", basisZh: "让价 15% 后亏" }],
      pricingStrategyZh: `底价 ${withCost.scenarios.find((s) => s.key === "floor")!.priceCad}`,
      strategicRfis: [{ questionZh: "请确认交货地点", whyZh: "影响运输" }, { questionZh: "Is the cost formula lowest/bid?", whyZh: "影响报价" }, "请确认是否接受 15% 的预付款"],
      teamingAdviceZh: "与本地分包商合作",
      dataGapsZh: "缺对手价",
    };
    const r = redactLegacyMemo(legacy) as typeof legacy & { legacyCostRedacted?: boolean; legacyRfisRemoved?: number };
    ok("v2：评分演算、报价策略置空，带标记", r.scoringAnalysisZh === "" && r.pricingStrategyZh === "" && r.legacyCostRedacted === true);
    ok("v2：摘要与每条风险门依据整段换成短句（不看字眼）", r.summaryZh === LEGACY_MEMO_REDACTED_ZH && r.riskGates.every((g) => g.basisZh === LEGACY_MEMO_REDACTED_ZH) && LEGACY_MEMO_REDACTED_ZH === "（内容涉及成本，已隐藏）");
    ok("v2：竞争格局、teaming、数据缺口与每条风险门名称也整段换掉（不看字眼）；风险门状态照旧；版本等结构化字段照旧", r.competitiveLandscapeZh === LEGACY_MEMO_REDACTED_ZH && r.teamingAdviceZh === LEGACY_MEMO_REDACTED_ZH && r.dataGapsZh === LEGACY_MEMO_REDACTED_ZH && r.riskGates.every((g) => g.gateZh === LEGACY_MEMO_REDACTED_ZH) && r.riskGates.map((g) => g.statusZh).join() === "需解决,高风险" && r.version === legacy.version && r.label === "AI_INFERRED", r);
    ok("v2：碰到的 RFI 整条去掉（对象与字符串都算），记下去掉几条；留下的 RFI 理由去掉（null）", r.strategicRfis.length === 1 && (r.strategicRfis[0] as { questionZh: string }).questionZh === "请确认交货地点" && (r.strategicRfis[0] as { whyZh: unknown }).whyZh === null && !JSON.stringify(r).includes("影响运输") && r.legacyRfisRemoved === 2);
    const probes = ["底线是多少", "保本价", "盈亏平衡", "低于这个价会亏", "落地价偏高", "进价太高", "加价空间", "加成 10", "我们的报价偏高", "我司报的价", "利潤偏低", "底線", "盈虧", "落地價", "profit is thin", "Markup is low", "price FLOOR", "Landed cost", "不低于 CAD 114,881", "约 98000", "让价 7.5%", "让价 8％", "$95k 起"];
    const missed = probes.filter((p) => !looksCostRelated(p));
    ok("探针：成本类字眼（简繁、英文不分大小写）与像金额 / 百分比的数字都算", missed.length === 0, missed);
    const viaField = probes.filter((p) => (redactLegacyMemo({ ...legacy, competitiveLandscapeZh: p }) as typeof legacy).competitiveLandscapeZh !== LEGACY_MEMO_REDACTED_ZH);
    ok("探针放进竞争格局：每一句都整段换掉", viaField.length === 0, viaField);
    const viaRfi = probes.filter((p) => (redactLegacyMemo({ ...legacy, strategicRfis: [{ questionZh: p, whyZh: "x" }] }) as typeof legacy).strategicRfis.length !== 0);
    ok("探针放进 RFI：每一条都去掉", viaRfi.length === 0, viaRfi);
    ok("不碰成本、没有金额的话不算", ["请确认交货地点", "现任是 Fixture Incumbent", "需提供 3 份推荐信", "请确认交货期是否为 30 天", "Please confirm the delivery address.", "是否接受 4K 显示器", "请千万确认截标时间", "评分是否按 70/30 计"].every((t) => !looksCostRelated(t)), ["请确认交货地点", "需提供 3 份推荐信", "请确认交货期是否为 30 天", "Please confirm the delivery address.", "是否接受 4K 显示器", "请千万确认截标时间", "评分是否按 70/30 计"].filter((t) => looksCostRelated(t)));
    // 每条规则单独一句（句子里只碰这一条），去掉任一条规则这里就失败
    const singleRule = ["亏损", "虧損", "进货", "進貨", "采购价", "採購價", "供应商报价", "供應商的報價", "盈利", "赚", "賺", "让利", "讓利", "让价", "讓價", "下限", "bottom line", "mark-up", "markup", "COGS", "the GP is thin", "我方报价", "我方的报价", "我们报价", "我們報價", "$95", "C$95", "共 87654", "6 万", "6 萬", "61 元", "95k", "1.2k", "5 dollars", "十一万", "捌万", "伍佰", "百分之十五", "8 个百分点", "十二个点", "几個點", "18%", "18 pts", "18 bps", "18 percent"];
    ok("每条规则单独一句都算", singleRule.every((t) => looksCostRelated(t)), singleRule.filter((t) => !looksCostRelated(t)));
    ok("GP 区分大小写、整词", looksCostRelated("GP") && !looksCostRelated("gp") && !looksCostRelated("GPS 定位"));
    ok("判断前的归一：全角转半角，数字里的空格、千分位逗号与三位一组的点去掉，小数不动", normalizeForCostCheck("８７６５４") === "87654" && normalizeForCostCheck("约 87 654 加元") === "约 87654 加元" && normalizeForCostCheck("87,654") === "87654" && normalizeForCostCheck("87.654") === "87654" && normalizeForCostCheck("１８％") === "18%" && normalizeForCostCheck("9.6 万") === "9.6 万");
    const v3 = { ...legacy, version: "tender-bid-strategy-memo/v3" };
    ok("v3：原样（同一个对象）", redactLegacyMemo(v3) === v3 && isNoCostMemo(v3) && !isNoCostMemo(legacy));
    ok("没有版本号的按旧版处理；不是对象原样", (redactLegacyMemo({ summaryZh: "x" }) as Record<string, unknown>).legacyCostRedacted === true && redactLegacyMemo(null) === null && redactLegacyMemo("x") === "x");
    ok("交给模型的地方：短句换成 null", placeholderToNull(LEGACY_MEMO_REDACTED_ZH) === null && placeholderToNull("与本地分包商合作") === "与本地分包商合作" && placeholderToNull(undefined) === null);
    ok("固定文字", LEGACY_MEMO_CARD_NOTE_ZH === "旧版备忘可能写了我方成本或毛利，部分内容已隐藏。有编辑权限的成员可在本页上方「历史授标检索」点「立即检索外部情报」生成新版，完成后刷新页面。" && LEGACY_MEMO_PRICING_LINE_ZH === "报价策略：已隐藏（旧版）" && MEMO_COST_POINTER_ZH === "成本与毛利情景见工作台「报价表助手」（需要财务查看权）。" && LEGACY_MEMO_WORKBENCH_ZH === "旧版策略备忘可能写了我方成本或毛利，摘要已隐藏；到情报页点「立即检索外部情报」生成新版。" && legacyRfiWithheldNoteZh(2) === "旧版策略备忘里有 2 条问题可能涉及我方成本，未列入；重新检索外部情报后再导出可补齐。");
  }

  console.log("旧版备忘：33 句探针 × 6 个位置（交叉验证 F1）");
  {
    const P = LEGACY_MEMO_REDACTED_ZH;
    const base = {
      version: "tender-bid-strategy-memo/v2",
      label: "AI_INFERRED",
      generatedAt: "2026-11-01T00:00:00.000Z",
      model: "fixture",
      summaryZh: "s",
      scoringAnalysisZh: "x",
      competitiveLandscapeZh: "ok",
      riskGates: [{ gateZh: "保险", statusZh: "需解决", basisZh: "b" }],
      pricingStrategyZh: "p",
      strategicRfis: [{ questionZh: "请确认交货地点", whyZh: "影响运输" }],
      teamingAdviceZh: "ok",
      dataGapsZh: "ok",
    };
    type Legacy = typeof base & { legacyRfisRemoved?: number };
    const POSITIONS = ["competitiveLandscapeZh", "teamingAdviceZh", "dataGapsZh", "gateZh", "rfiQ", "rfiWhy"] as const;
    const place = (pos: (typeof POSITIONS)[number], probe: string): Legacy => {
      const m = JSON.parse(JSON.stringify(base)) as Legacy;
      if (pos === "gateZh") m.riskGates[0].gateZh = probe;
      else if (pos === "rfiQ") m.strategicRfis = [{ questionZh: probe, whyZh: "x" }, { questionZh: "请确认交货地点", whyZh: "影响运输" }];
      else if (pos === "rfiWhy") m.strategicRfis = [{ questionZh: "请确认交货地点", whyZh: probe }];
      else m[pos] = probe;
      return m;
    };
    // 情报页签原样给出裁剪结果；澄清问题文件 = generate-docs 的同一组调用（buildRfiItems → renderRfiHtml）
    const surfaces = (m: Legacy) => {
      const r = redactLegacyMemo(m) as Legacy;
      const html = renderRfiHtml({ projectName: "Fixture", tenderNumber: null, buyer: null, questionDeadline: null, closing: null, submitChannel: null, generatedAt: "2026-11-20 10:00", items: buildRfiItems({ memoRfis: r.strategicRfis, synthesisClarifications: [] }), withheldMemoRfis: r.legacyRfisRemoved ?? 0 });
      return { r, out: `${JSON.stringify(r)}\n${html}` };
    };
    const leaked: string[] = [];
    for (const probe of LEGACY_PROBES) for (const pos of POSITIONS) if (surfaces(place(pos, probe)).out.includes(probe)) leaked.push(`${pos}: ${probe}`);
    ok(`${LEGACY_PROBES.length} 句探针放进 ${POSITIONS.length} 个位置：情报页签返回的备忘与澄清问题文件里一句都不出现`, LEGACY_PROBES.length === 33 && leaked.length === 0, leaked);
    ok("33 句探针放进 RFI 问题：每一条都去掉、计数，干净的那条留下（理由为 null）", LEGACY_PROBES.every((probe) => { const r = surfaces(place("rfiQ", probe)).r; return r.legacyRfisRemoved === 1 && r.strategicRfis.length === 1 && JSON.stringify(r.strategicRfis[0]) === JSON.stringify({ questionZh: "请确认交货地点", whyZh: null }); }), LEGACY_PROBES.filter((probe) => surfaces(place("rfiQ", probe)).r.legacyRfisRemoved !== 1));
    // 整段替换不看内容：放干净的话也要换掉（去掉任一段的整段替换，这几条会失败）
    const clean = "与本地分包商合作，交付地点在 Ottawa";
    for (const pos of ["competitiveLandscapeZh", "teamingAdviceZh", "dataGapsZh"] as const) ok(`${pos}：干净的话也整段换掉`, (surfaces(place(pos, clean)).r as Record<string, unknown>)[pos] === P);
    ok("风险门名称：干净的名称也换掉，状态照旧", (() => { const g = surfaces(place("gateZh", clean)).r.riskGates[0]; return g.gateZh === P && g.basisZh === P && g.statusZh === "需解决"; })());
    ok("RFI 理由：干净的理由也去掉（null），问题留下", (() => { const r = surfaces(place("rfiWhy", clean)).r; return r.strategicRfis.length === 1 && r.strategicRfis[0].whyZh === null && r.strategicRfis[0].questionZh === "请确认交货地点" && r.legacyRfisRemoved === 0; })());
    const keep = redactLegacyMemo({ ...base, strategicRfis: [{ questionZh: "请确认交货地点", whyZh: "影响运输" }, "请确认是否需要提供 3 份推荐信", { questionZh: "Please confirm the delivery address.", whyZh: "x" }] }) as Legacy;
    ok("干净的 RFI 问题都留下（规则不会把正当问题全删）", keep.legacyRfisRemoved === 0 && JSON.stringify(keep.strategicRfis) === JSON.stringify([{ questionZh: "请确认交货地点", whyZh: null }, "请确认是否需要提供 3 份推荐信", { questionZh: "Please confirm the delivery address.", whyZh: null }]), keep.strategicRfis);
    const odd = redactLegacyMemo({ ...base, legacyRfisRemoved: 99, extraNoteZh: "成本 87654", nullField: null, competitiveLandscapeZh: ["成本 87654"], riskGates: ["成本底线 87654", { gateZh: "价格", statusZh: "高风险：低于成本 87654", basisZh: "b" }, { gateZh: "保险", statusZh: "已满足", basisZh: "b" }], strategicRfis: [{ whyZh: "成本 87654" }, "   ", 42] }) as Record<string, unknown> & Legacy;
    ok("形状不对的也不漏：字符串风险门丢掉、非取值的状态换掉、数组形式的段落换掉、别的字段换掉、空值照旧、标记重算、没有问题文字的 RFI 丢掉", !JSON.stringify(odd).includes("87654") && odd.riskGates.length === 2 && odd.riskGates[0].statusZh === P && odd.riskGates[1].statusZh === "已满足" && odd.competitiveLandscapeZh === P && odd.extraNoteZh === P && odd.nullField === null && odd.legacyRfisRemoved === 0 && odd.strategicRfis.length === 0 && odd.model === "fixture" && odd.generatedAt === base.generatedAt, odd);
    const noArrays = redactLegacyMemo({ version: "tender-bid-strategy-memo/v2", summaryZh: "x", riskGates: "成本 87654", strategicRfis: "成本 87654" }) as Legacy;
    ok("风险门与 RFI 不是数组时当作空数组", Array.isArray(noArrays.riskGates) && noArrays.riskGates.length === 0 && Array.isArray(noArrays.strategicRfis) && noArrays.strategicRfis.length === 0 && !JSON.stringify(noArrays).includes("87654"));
  }

  console.log("澄清问题文件");
  {
    const base = { projectName: "Fixture", tenderNumber: null, buyer: null, questionDeadline: null, closing: null, submitChannel: null, generatedAt: "2026-11-20 10:00" };
    const withheld = renderRfiHtml({ ...base, items: [], withheldMemoRfis: 2 });
    const tableEnd = withheld.indexOf("</table>");
    ok("旧版备忘的问题被去掉时：提交表之外写一行内部说明，不写「均未产出 RFI」", withheld.includes("旧版策略备忘里有 2 条问题可能涉及我方成本，未列入；重新检索外部情报后再导出可补齐。") && withheld.indexOf("旧版策略备忘里有 2 条") > tableEnd && withheld.includes("暂无可提交的问题。") && !withheld.includes("备忘录与分析均未产出 RFI"));
    const none = renderRfiHtml({ ...base, items: [] });
    ok("没有被去掉的问题时照旧", none.includes("暂无问题——备忘录与分析均未产出 RFI。") && !none.includes("旧版策略备忘里有"));
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
    // finance-view.ts 是 CHAIN-2b（#532）的文件（去掉两个原样返回房间 JSON 的接口里的备忘）；两边都合并后会出现在这里
    const others = found.filter((p) => !["src/lib/tender-intel/orchestrate.ts", "src/lib/tender-intel/strategy.ts", "src/lib/tender-intel/memo-pricing.ts", "src/lib/tender-pricing/finance-view.ts"].includes(p)).sort();
    ok("没有别的读备忘的地方漏掉（src 下除编排、提示词与本模块外只有这几处）", JSON.stringify(others) === JSON.stringify(expected), others);
    const card = read("src/components/tender-intel/org-award-intel-slots.tsx");
    ok("卡片：旧版时第一行写说明、隐藏的摘要不显示、报价策略一行写「已隐藏（旧版）」；新版在报价策略后写去报价表助手看成本", card.includes("{memo.legacyCostRedacted ? <p className=\"text-amber-700\" data-testid=\"memo-legacy-note\">{LEGACY_MEMO_CARD_NOTE_ZH}</p> : null}") && card.indexOf("memo-legacy-note") < card.indexOf("{memo.summaryZh}") && card.includes("memo.summaryZh !== LEGACY_MEMO_REDACTED_ZH") && card.includes("{memo.legacyCostRedacted ? LEGACY_MEMO_PRICING_LINE_ZH : `报价策略：${memo.pricingStrategyZh.slice(0, 160)}`}") && card.includes("{memo.legacyCostRedacted ? null : <p className=\"text-[11px] text-muted/70\">{MEMO_COST_POINTER_ZH}</p>}"));
    const wb = read("src/app/api/projects/[id]/workbench-summary/route.ts");
    ok("卡片：名称被隐藏的风险门不列、被隐藏的数据缺口不显示", card.includes("memo.riskGates.filter((g) => g.gateZh !== LEGACY_MEMO_REDACTED_ZH).slice(0, 4)") && card.includes("memo.dataGapsZh && memo.dataGapsZh !== LEGACY_MEMO_REDACTED_ZH"));
    ok("工作台摘要：旧版写固定说明、不列被隐藏的风险门、带标记", wb.includes("strategyZh: memo.legacyCostRedacted ? LEGACY_MEMO_WORKBENCH_ZH : memo.summaryZh") && wb.includes(".filter((g) => g.gateZh !== LEGACY_MEMO_REDACTED_ZH)") && wb.includes("legacyCostRedacted: true"));
    const gather = read("src/lib/tender-bid-draft/gather.ts");
    ok("投标文件草稿的输入：被隐藏的段落送 null、名称被隐藏的风险门不送", gather.includes(".filter((g) => g.gateZh !== LEGACY_MEMO_REDACTED_ZH)") && gather.includes("summaryZh: placeholderToNull(memoRaw.summaryZh)") && gather.includes("basisZh: placeholderToNull(g.basisZh)") && gather.includes("teamingAdviceZh: placeholderToNull(memoRaw.teamingAdviceZh)"));
    const gd = read("src/lib/projects/generate/generate-docs.ts");
    ok("澄清问题文件：把去掉的条数交给导出", gd.includes("withheldMemoRfis: memo?.legacyRfisRemoved ?? 0"));
    const lib = read("src/lib/tender-intel/memo-pricing.ts");
    ok("纯函数模块不碰库、不出站、不调模型", !/@\/lib\/db|fetch\(|callStructured|createUnifiedRuntimeInvoker/.test(strip(lib)));
    const e2e = read("scripts/bid-strategy-memo-e2e.ts");
    ok("E2E 脚本认 v3，并核对备忘文字里没有调查室的成本数字", e2e.includes('String(memo.version) === "tender-bid-strategy-memo/v3"') && e2e.includes("E2E-06"));
  }

  console.log(`\nmemo-pricing: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
