/**
 * TI-2 定价、预备金、比率与合计（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-cost/__tests__/pricing.test.ts
 * 覆盖任务书验收项 A10（合计对到分）、A12（税不重复）、A13 的前提（预备金口径不重复）。
 */
import assert from "node:assert/strict";
import type { CostScenarioInput } from "../contract";
import { computeCostScenario } from "../pricing";
import { GOLDEN_SCENARIO } from "./fixtures/golden";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const m = (v: { toFixed(n: number): string } | null) => (v ? v.toFixed(2) : null);

console.log("tender-bid-cost pricing");

{
  const s = computeCostScenario(GOLDEN_SCENARIO);
  assert.ok(s.ok);
  const [a, b] = s.lines;
  ok("毛利率口径金标：单位报价 22.48 与 513.70", m(a.unitBidCad) === "22.48" && m(b.unitBidCad) === "513.70");
  ok("行合计 224.80 与 1,027.40", m(a.extendedBidCad) === "224.80" && m(b.extendedBidCad) === "1027.40");
  ok("报价总计 1,252.20，直接成本总计 914.12", m(s.totals.bidExclHstCad) === "1252.20" && m(s.totals.directCostCad) === "914.12");
  ok("进口 GST 现金流合计 4.96，不在成本里", m(s.totals.importGstCashCad) === "4.96" && m(s.totals.nonRecoverableTaxCad) === "0.00");
  ok("两行扣预备金后的利润 56.18 与 256.85", m(a.profitCad) === "56.18" && m(b.profitCad) === "256.85");
  // Skill 包的 Python 样例由合计报价与合计成本重算合计利润，得 313.04；本实现取逐行之和 313.03，表上的合计与各行相加对得上。
  ok("合计利润 313.03 = 两行之和（不是样例的 313.04）", m(s.totals.profitCad) === "313.03");
  const fromTotals = s.totals.bidExclHstCad.times("0.98").minus(s.totals.directCostCad).toDecimalPlaces(2, 4).toFixed(2);
  ok("由合计重算会得到 313.04（一分钱的来历）", fromTotals === "313.04");
  ok("毛利率 27.0% 与加成率 37.0% 同时输出且不相等", s.totals.grossMarginPct?.toFixed(1) === "27.0" && s.totals.markupPct?.toFixed(1) === "37.0");
  ok("扣按售价预备金后的利润率 25.0%", s.totals.netMarginPct?.toFixed(1) === "25.0");
  ok("每行也有两个比率", !!a.grossMarginPct && !!a.markupPct && !a.grossMarginPct.eq(a.markupPct));
  ok("合计各项等于各行舍入值之和",
    m(s.totals.directCostCad) === a.directCostCad!.plus(b.directCostCad!).toFixed(2) && m(s.totals.bidExclHstCad) === a.extendedBidCad!.plus(b.extendedBidCad!).toFixed(2));
  ok("没有任何标记：完整、已核实关税、全部已签报价", !s.flags.incomplete && !s.flags.hasSensitivityDuty && !s.flags.hasIndicativePrice);
}
{
  const markup = computeCostScenario({ ...GOLDEN_SCENARIO, reserves: [], pricing: { method: "MARKUP_ON_COST", markupPct: "25" } });
  assert.ok(markup.ok);
  ok("成本加成 25%：单位报价 = 单位成本 × 1.25（20.52 / 468.75）", m(markup.lines[0].unitBidCad) === "20.52" && m(markup.lines[1].unitBidCad) === "468.75");
  ok("加成 25% 对应的毛利率约 20%，不是 25%", markup.totals.markupPct?.toFixed(1) === "25.0" && markup.totals.grossMarginPct?.toFixed(1) === "20.0");
}
{
  const dup: CostScenarioInput = {
    ...GOLDEN_SCENARIO,
    reserves: [
      { key: "contingency", label: "风险预备金", mode: "ON_SALE", ratePct: "2" },
      { key: "contingency", label: "风险预备金", mode: "IN_COST", pctOfDirectCost: "2" },
    ],
  };
  const r = computeCostScenario(dup);
  ok("同一笔预备金两处都填 → 拒绝", !r.ok && r.code === "RESERVE_DUPLICATED" && r.messageZh.includes("重复"));

  const inCost = computeCostScenario({ ...GOLDEN_SCENARIO, reserves: [{ key: "contingency", label: "风险预备金", mode: "IN_COST", pctOfDirectCost: "2" }] });
  assert.ok(inCost.ok);
  ok("计入成本的预备金出现在直接成本分项里（3.28 + 15.00）", m(inCost.lines[0].reserveInCostCad) === "3.28" && m(inCost.lines[1].reserveInCostCad) === "15.00" && m(inCost.totals.directCostCad) === "932.40");
  ok("计入成本后不再从售价里扣", m(inCost.totals.reserveOnSaleCad) === "0.00" && inCost.meta.reserveOnSaleRatePct.isZero());
  const onSale = computeCostScenario(GOLDEN_SCENARIO);
  assert.ok(onSale.ok);
  ok("按售价留的预备金不在直接成本里", m(onSale.totals.reserveInCostCad) === "0.00" && m(onSale.totals.reserveOnSaleCad) === "25.05");

  const tooHigh = computeCostScenario({ ...GOLDEN_SCENARIO, reserves: [{ key: "r", label: "预备金", mode: "ON_SALE", ratePct: "80" }] });
  ok("毛利率 25% + 按售价预备金 80% → 分母不为正，拒绝", !tooHigh.ok && tooHigh.code === "PRICING_DENOMINATOR_NOT_POSITIVE");
}
{
  const partial = computeCostScenario({ ...GOLDEN_SCENARIO, lines: [{ ...GOLDEN_SCENARIO.lines[0], duty: null }, GOLDEN_SCENARIO.lines[1]] });
  assert.ok(partial.ok);
  ok("一行缺关税率 → 该行单位报价与利润为空，合计标不完整", partial.lines[0].unitBidCad === null && partial.lines[0].profitCad === null && partial.flags.incomplete);
  ok("不完整时合计只含已算出的行（750.00）", m(partial.totals.directCostCad) === "750.00");
  const sens = computeCostScenario({ ...GOLDEN_SCENARIO, lines: [{ ...GOLDEN_SCENARIO.lines[0], duty: { ratePct: "18" } }, GOLDEN_SCENARIO.lines[1]] });
  ok("未核实关税 → 情景带标记，数字不变", sens.ok && sens.flags.hasSensitivityDuty && m(sens.totals.directCostCad) === "914.12");
  const dupLine = computeCostScenario({ ...GOLDEN_SCENARIO, lines: [GOLDEN_SCENARIO.lines[0], GOLDEN_SCENARIO.lines[0]] });
  ok("行号重复 → 拒绝", !dupLine.ok && dupLine.code === "DUPLICATE_LINE");
}

console.log(`\ntender-bid-cost pricing: ${passed} passed`);
