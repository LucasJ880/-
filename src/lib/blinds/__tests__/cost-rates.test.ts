/**
 * 品类成本率与成本快照测试
 * 运行：npx tsx src/lib/blinds/__tests__/cost-rates.test.ts
 */

import assert from "node:assert/strict";
import { costRateForProduct, snapshotCostPrice } from "../cost-rates";
import { parseCostRates, validateCostRatesInput } from "../discount-settings";

// ── parseCostRates：只收已知品类、0-1 有限数 ──
const parsed = parseCostRates({
  zebra: 0.45,
  roller: 0.5,
  unknown_field: 0.3,
  shutters: 1.5,
  drapery: "abc",
});
assert.deepEqual(parsed, { zebra: 0.45, roller: 0.5 }, "未知字段/越界/非数静默丢弃");
assert.deepEqual(parseCostRates(null), {});
assert.deepEqual(parseCostRates([0.4]), {});

// ── validateCostRatesInput：API 入参非法要报错而非丢弃 ──
const valid = validateCostRatesInput({ zebra: 0.455, sheer: 0 });
assert.equal(valid.ok, true);
if (valid.ok) assert.deepEqual(valid.value, { zebra: 0.455, sheer: 0 });
assert.equal(validateCostRatesInput({ bad_key: 0.4 }).ok, false, "未知字段拒绝");
assert.equal(validateCostRatesInput({ zebra: 1.2 }).ok, false, "越界拒绝");
assert.equal(validateCostRatesInput([0.4]).ok, false, "数组拒绝");

// ── costRateForProduct：ProductName → 字段映射 ──
const rates = { zebra: 0.45, honeycomb: 0.6 };
assert.equal(costRateForProduct(rates, "Zebra"), 0.45);
assert.equal(costRateForProduct(rates, "SkylightHoneycomb"), 0.6);
assert.equal(costRateForProduct(rates, "Roller"), null, "未配置品类 → null");
assert.equal(costRateForProduct(rates, "Allusion"), null, "无映射产品 → null");

// ── snapshotCostPrice ──
assert.equal(snapshotCostPrice(100, 0.45), 45);
assert.equal(snapshotCostPrice(333.335, 0.3), 100, "round 到分");
assert.equal(snapshotCostPrice(100, null), null, "无率 → null（不猜）");
assert.equal(snapshotCostPrice(-5, 0.4), null, "非法价 → null");

console.log("Cost rates tests passed");
