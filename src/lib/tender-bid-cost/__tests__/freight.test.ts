/**
 * TI-2 运费方案互斥与分摊（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-cost/__tests__/freight.test.ts
 * 覆盖任务书验收项 A11（本地行不分摊海运）、A14（运费方案互斥，除非声明混合）。
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { CostScenarioInput, FreightPlan } from "../contract";
import { allocateCharge, allocateFreight, validateFreightSelection, type AllocationLine } from "../freight";
import { computeCostScenario } from "../pricing";
import { GOLDEN_DOMESTIC_LINE, GOLDEN_IMPORT_LINE, GOLDEN_SCENARIO } from "./fixtures/golden";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const d = (v: string | number) => new Prisma.Decimal(v);
const al = (lineNo: number, o: Partial<AllocationLine> = {}): AllocationLine => ({ lineNo, sourcing: "IMPORT", pieces: d(100), goodsCad: d(1000), volumeCbm: d(1), weightKg: d(10), ...o });
const FCL: FreightPlan = { key: "fcl", mode: "FCL", charges: [{ label: "海运费", amountCad: "1000", allocation: "BY_VOLUME" }] };
const LCL: FreightPlan = { key: "lcl", mode: "LCL", charges: [{ label: "拼柜费", amountCad: "300", allocation: "BY_VOLUME" }] };

console.log("tender-bid-cost freight");

{
  const both = validateFreightSelection({ plans: [FCL, LCL] });
  ok("整柜与拼柜同时计入且未声明混合 → 拒绝", !both.ok && both.code === "MULTIPLE_FREIGHT_PLANS" && both.messageZh.includes("只能选一个"));
  const blend = validateFreightSelection({ plans: [FCL, LCL], blendNote: "整柜装不下的部分走拼柜" });
  ok("声明混合并附说明 → 通过", blend.ok && blend.blendNote === "整柜装不下的部分走拼柜");
  ok("空白说明不算声明", !validateFreightSelection({ plans: [FCL, LCL], blendNote: "  " }).ok);
  ok("单一方案 / 无方案 → 通过", validateFreightSelection({ plans: [FCL] }).ok && validateFreightSelection(null).ok);
  const scenario = computeCostScenario({ ...GOLDEN_SCENARIO, freight: { plans: [FCL, LCL] } });
  ok("情景计算同样拒绝两个方案", !scenario.ok && scenario.code === "MULTIPLE_FREIGHT_PLANS");
}
{
  const r = allocateCharge("1000.00", "BY_VOLUME", [al(1), al(2), al(3)]);
  assert.ok(r.ok);
  const shares = [1, 2, 3].map((n) => r.shares.get(n)!.toFixed(2));
  ok("按体积 1:1:1 分摊 1,000.00 → 333.33 / 333.33 / 333.34（余数归最后一行）", shares.join("/") === "333.33/333.33/333.34");
  ok("各行之和恰为整票金额", [...r.shares.values()].reduce((a, v) => a.plus(v), d(0)).toFixed(2) === "1000.00");
  const byValue = allocateCharge("900", "BY_VALUE", [al(1, { goodsCad: d(1000) }), al(2, { goodsCad: d(2000) })]);
  ok("按货值 1:2 分摊 900 → 300 / 600", byValue.ok && byValue.shares.get(1)!.toFixed(2) === "300.00" && byValue.shares.get(2)!.toFixed(2) === "600.00");
  const byWeight = allocateCharge("100", "BY_WEIGHT", [al(1, { weightKg: d(1) }), al(2, { weightKg: d(3) })]);
  ok("按重量 1:3 分摊 100 → 25 / 75", byWeight.ok && byWeight.shares.get(1)!.toFixed(2) === "25.00" && byWeight.shares.get(2)!.toFixed(2) === "75.00");
  const missing = allocateCharge("1000", "BY_VOLUME", [al(1), al(2, { volumeCbm: null })]);
  ok("按体积而第 2 行缺体积 → 拒绝并指出该行", !missing.ok && missing.code === "ALLOCATION_BASIS_MISSING" && missing.lineNo === 2);
  const odd = allocateCharge("0.05", "BY_QUANTITY", [al(1), al(2), al(3)]);
  ok("0.05 三行分摊仍对到分", odd.ok && [...odd.shares.values()].reduce((a, v) => a.plus(v), d(0)).toFixed(2) === "0.05");
}
{
  const lines = [al(1), al(2), al(13, { sourcing: "DOMESTIC" })];
  const r = allocateFreight([{ key: "fcl", mode: "FCL", charges: [{ label: "海运费", amountCad: "500", allocation: "BY_QUANTITY" }] }], lines);
  ok("国际段费用：本地行分摊额为 0，两行进口之和等于整票金额",
    r.ok && r.byLine.get(13)!.toFixed(2) === "0.00" && r.byLine.get(1)!.plus(r.byLine.get(2)!).toFixed(2) === "500.00");
  const local = allocateFreight([{ key: "truck", mode: "LOCAL", charges: [{ label: "卡车", amountCad: "300", allocation: "BY_QUANTITY" }] }], lines);
  ok("本地方案分摊到全部行", local.ok && local.byLine.get(13)!.toFixed(2) === "100.00");
}
{
  const withFreight: CostScenarioInput = {
    ...GOLDEN_SCENARIO,
    lines: [{ ...GOLDEN_IMPORT_LINE, internationalFreightCad: null }, GOLDEN_DOMESTIC_LINE],
    freight: { plans: [{ key: "fcl", mode: "FCL", charges: [{ label: "海运费", amountCad: "45.00", allocation: "BY_VALUE" }] }] },
  };
  const s = computeCostScenario(withFreight);
  assert.ok(s.ok);
  ok("整票 45.00 全部落在唯一的进口行，结果与金标一致（164.12 / 750.00）",
    s.lines[0].directCostCad?.toFixed(2) === "164.12" && s.lines[1].directCostCad?.toFixed(2) === "750.00" && s.lines[1].freightCad?.toFixed(2) === "60.00");
  const byValue = (plan: FreightPlan): FreightPlan => ({ ...plan, charges: plan.charges.map((c) => ({ ...c, allocation: "BY_VALUE" as const })) });
  const blended = computeCostScenario({ ...withFreight, freight: { plans: [byValue(FCL), byValue(LCL)], blendNote: "整柜装不下的部分走拼柜" } });
  ok("混合情景可算，并带出说明", blended.ok && blended.meta.freightBlendNote === "整柜装不下的部分走拼柜" && blended.meta.freightModes.join("+") === "FCL+LCL");
  const twoImports = computeCostScenario({
    ...withFreight,
    lines: [
      { ...GOLDEN_IMPORT_LINE, internationalFreightCad: null },
      { ...GOLDEN_IMPORT_LINE, line: { ...GOLDEN_IMPORT_LINE.line, lineNo: 2 }, internationalFreightCad: null, duty: null },
    ],
  });
  ok("成本为空的行不参与分摊：整票 45.00 全落在另一行，并提示补齐后会变",
    twoImports.ok && twoImports.lines[0].freightCad?.toFixed(2) === "45.00" && twoImports.lines[1].freightCad === null && twoImports.notices.some((n) => n.includes("补齐后")));
  const basisMissing = computeCostScenario({ ...withFreight, freight: { plans: [FCL] } });
  ok("按体积分摊而行上没有体积 → 情景拒绝", !basisMissing.ok && basisMissing.code === "ALLOCATION_BASIS_MISSING");
}

console.log(`\ntender-bid-cost freight: ${passed} passed`);
