/**
 * TI-2 两套成本情景对账（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-cost/__tests__/reconcile.test.ts
 * 覆盖任务书验收项 A13（两套模型给出对账差额，不给误导性的「胜出者」）。
 */
import assert from "node:assert/strict";
import { computeCostScenario } from "../pricing";
import { reconcileScenarios } from "../reconcile";
import { GOLDEN_SCENARIO } from "./fixtures/golden";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

console.log("tender-bid-cost reconcile");

const onSale = computeCostScenario({ ...GOLDEN_SCENARIO, key: "a", label: "甲：预备金按售价留" });
const inCost = computeCostScenario({ ...GOLDEN_SCENARIO, key: "b", label: "乙：预备金计入成本", reserves: [{ key: "contingency", label: "风险预备金", mode: "IN_COST", pctOfDirectCost: "2" }] });
assert.ok(onSale.ok && inCost.ok);

{
  const r = reconcileScenarios(onSale, inCost);
  assert.ok(r.ok);
  const row = (key: string) => r.rows.find((x) => x.key === key)!;
  ok("列出 11 个分项的差额", r.rows.length === 11 && r.rows.every((x) => /^-?\d+\.\d{2}$/.test(x.delta)));
  ok("预备金从「按售价留」移到「计入成本」：前者 −25.05，后者 +18.28", row("reserveOnSaleCad").delta === "-25.05" && row("reserveInCostCad").delta === "18.28");
  ok("直接成本差 18.28（914.12 → 932.40）", row("directCostCad").a === "914.12" && row("directCostCad").b === "932.40" && r.costDelta === "18.28");
  ok("报价差额等于两套报价之差", r.bidDelta === inCost.totals.bidExclHstCad.minus(onSale.totals.bidExclHstCad).toFixed(2) && row("bidExclHstCad").delta === r.bidDelta);
  ok("写明预备金口径不同", r.differences.some((d) => d.includes("预备金口径不同") && d.includes("按售价留") && d.includes("计入成本")));
  const text = JSON.stringify(r);
  ok("结果里没有胜出者、推荐、更优之类的字段或措辞", !/winner|best|better|recommend|胜出|更优|推荐|更好/i.test(text));
}
{
  const same = reconcileScenarios(onSale, onSale);
  ok("同一情景对账：差额全为 0，没有口径差异", same.ok && same.rows.every((x) => x.delta === "0.00") && same.differences.length === 0);
  const markup = computeCostScenario({ ...GOLDEN_SCENARIO, key: "c", label: "丙：成本加成", pricing: { method: "MARKUP_ON_COST", markupPct: "30" } });
  assert.ok(markup.ok);
  const r = reconcileScenarios(onSale, markup);
  ok("定价口径不同也写明", r.ok && r.differences.some((d) => d.includes("定价口径不同")));
  const oneLine = computeCostScenario({ ...GOLDEN_SCENARIO, key: "d", label: "丁：只有一行", lines: [GOLDEN_SCENARIO.lines[0]] });
  assert.ok(oneLine.ok);
  const mismatch = reconcileScenarios(onSale, oneLine);
  ok("行项不同 → 不能对账", !mismatch.ok && mismatch.code === "LINE_SET_MISMATCH");
  const partial = computeCostScenario({ ...GOLDEN_SCENARIO, key: "e", label: "戊：缺关税率", lines: [{ ...GOLDEN_SCENARIO.lines[0], duty: null }, GOLDEN_SCENARIO.lines[1]] });
  assert.ok(partial.ok);
  const r2 = reconcileScenarios(onSale, partial);
  ok("有一套不完整时如实说明", r2.ok && r2.differences.some((d) => d.includes("不完整")));
}

console.log(`\ntender-bid-cost reconcile: ${passed} passed`);
