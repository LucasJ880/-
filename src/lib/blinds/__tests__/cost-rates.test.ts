/**
 * 品类成本率与成本快照测试
 * 运行：npx tsx src/lib/blinds/__tests__/cost-rates.test.ts
 */

import assert from "node:assert/strict";
import { costRateForProduct, snapshotCostPrice } from "../cost-rates";
import {
  parseCostRates,
  validateCostRatesInput,
  readJsonDiscounts,
  mergeJsonDiscounts,
  readJsonCordless,
  mergeJsonCordless,
  dtoToCordlessPolicy,
  applyOrgDiscountDefaults,
  validateDiscountsInput,
  readJsonAddonPrices,
  mergeJsonAddonPrices,
  validateAddonPricesInput,
} from "../discount-settings";
import { DEFAULT_DISCOUNTS } from "../pricing-data";

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
assert.equal(costRateForProduct(rates, "Allusion"), null, "未配置品类（Allusion 2026-10-28 起有映射）→ null");
assert.equal(costRateForProduct(rates, "Roman"), null, "无映射产品 → null");

// ── 2026-10-28 价表：fauxwood / allusion 作为成本率与 JSON 折扣键 ──
const rates2 = { fauxwood: 0.5, allusion: 0.42 };
assert.equal(costRateForProduct(rates2, "Fauxwood"), 0.5, "Fauxwood 成本率");
assert.equal(costRateForProduct(rates2, "Allusion"), 0.42, "Allusion 成本率");
assert.equal(validateCostRatesInput({ fauxwood: 0.5, allusion: 0.42 }).ok, true, "成本率入参接受新键");
assert.deepEqual(readJsonDiscounts({ pricing: { discounts: { fauxwood: "abc", allusion: 0.4 } } }), { allusion: 0.4 }, "坏值丢弃、好值保留（调用方回默认）");
assert.deepEqual(readJsonDiscounts({ pricing: { leadMaxPct: 0.35 } }), {}, "没有 discounts 子键 → 空");
assert.deepEqual(readJsonDiscounts("x"), {}, "非对象 → 空");
assert.deepEqual(readJsonDiscounts({ pricing: { discounts: { fauxwood: 1.5, allusion: -0.1 } } }), {}, "越界丢弃");
const merged = mergeJsonDiscounts(
  { sunnyWarranty: { a: 1 }, pricing: { leadMaxPct: 0.4, discounts: { fauxwood: 0.3 } } },
  { allusion: 0.25 },
);
assert.deepEqual(merged, { sunnyWarranty: { a: 1 }, pricing: { leadMaxPct: 0.4, discounts: { fauxwood: 0.3, allusion: 0.25 } } }, "只动 pricing.discounts 子键，其它键原样");
assert.deepEqual(mergeJsonDiscounts(null, { fauxwood: 0.2 }), { pricing: { discounts: { fauxwood: 0.2 } } }, "空 settingsJson 也能写");
assert.deepEqual(mergeJsonDiscounts({ pricing: "bad" }, { fauxwood: 0.2 }), { pricing: { discounts: { fauxwood: 0.2 } } }, "坏 pricing 被替换为对象");

// ── snapshotCostPrice ──
assert.equal(snapshotCostPrice(100, 0.45), 45);
assert.equal(snapshotCostPrice(333.335, 0.3), 100, "round 到分");
assert.equal(snapshotCostPrice(100, null), null, "无率 → null（不猜）");
assert.equal(snapshotCostPrice(-5, 0.4), null, "非法价 → null");

// ── PRICE-2：无绳企业设置（settingsJson.pricing.cordless）──
assert.deepEqual(readJsonCordless(null), { cordlessDiscount: 0.3, cordlessFloorZebra: 159, cordlessFloorRoller: 129 }, "缺省 → 0.30 / 159 / 129");
assert.deepEqual(
  readJsonCordless({ pricing: { cordless: { discount: 0.25, floors: { Zebra: "x", Roller: 139 } } } }),
  { cordlessDiscount: 0.25, cordlessFloorZebra: 159, cordlessFloorRoller: 139 },
  "坏值逐项回落、好值保留",
);
assert.deepEqual(readJsonCordless({ pricing: { cordless: { discount: 1.2, floors: { Zebra: -1, Roller: 20000 } } } }), { cordlessDiscount: 0.3, cordlessFloorZebra: 159, cordlessFloorRoller: 129 }, "越界回落");
const mergedC = mergeJsonCordless(
  { sunnyWarranty: { a: 1 }, pricing: { leadMaxPct: 0.4, discounts: { fauxwood: 0.25 }, cordless: { floors: { Roller: 129 } } } },
  { cordlessDiscount: 0.2, cordlessFloorZebra: 169 },
);
assert.deepEqual(
  mergedC,
  { sunnyWarranty: { a: 1 }, pricing: { leadMaxPct: 0.4, discounts: { fauxwood: 0.25 }, cordless: { discount: 0.2, floors: { Roller: 129, Zebra: 169 } } } },
  "只动 pricing.cordless，pricing.discounts / leadMaxPct / 其它键原样",
);
assert.deepEqual(dtoToCordlessPolicy({ cordlessDiscount: 0.2, cordlessFloorZebra: 169, cordlessFloorRoller: 139 }), { discount: 0.2, floors: { Zebra: 169, Roller: 139 }, multiplier: 1.15 }, "DTO → 引擎策略");
const filled = applyOrgDiscountDefaults(
  [
    { product: "Zebra" as const, cordless: true },
    { product: "Zebra" as const, cordless: false },
    { product: "SHANGRILA" as const, cordless: true },
    { product: "Roller" as const, cordless: true, discountOverridePct: 0.5 },
  ],
  { ...DEFAULT_DISCOUNTS, Zebra: 0.4, SHANGRILA: 0.3 },
);
assert.equal(filled[0].discountOverridePct, undefined, "Zebra 无绳行不套产品折扣（交给无绳策略）");
assert.equal(filled[1].discountOverridePct, 0.4, "Zebra 有绳行套企业产品折扣");
assert.equal(filled[2].discountOverridePct, 0.3, "非 Zebra / Roller 带无绳标记仍按有绳套折扣");
assert.equal(filled[3].discountOverridePct, 0.5, "行级覆盖保持");
const vOk = validateDiscountsInput({ cordlessDiscount: 0.25, cordlessFloorZebra: 169.5, cordlessFloorRoller: 139 });
assert.equal(vOk.ok, true);
if (vOk.ok) assert.deepEqual(vOk.value, { cordlessDiscount: 0.25, cordlessFloorZebra: 169.5, cordlessFloorRoller: 139 });
assert.equal(validateDiscountsInput({ cordlessDiscount: 1.2 }).ok, false, "无绳折扣越界拒绝");
assert.equal(validateDiscountsInput({ cordlessFloorRoller: -1 }).ok, false, "无绳最低价负数拒绝");

// ── PRICE-3：附加项目企业价（settingsJson.pricing.addons）──
const apDefault = readJsonAddonPrices(null);
assert.equal(Object.keys(apDefault).length, 36, "缺省 → 目录全部 36 键");
assert.equal(apDefault.motor, 150);
assert.equal(apDefault.downtown_fee, 150);
const apBad = readJsonAddonPrices({ pricing: { addons: { motor: -5, hub: "x", unknown_key: 9, remote: 45, track6: 20000 } } });
assert.equal(apBad.motor, 150, "负数回目录价");
assert.equal(apBad.hub, 240, "非数字回目录价");
assert.equal(apBad.track6, 60, "超过 10000 回目录价");
assert.equal(apBad.remote, 45, "合法覆盖生效");
assert.equal("unknown_key" in apBad, false, "未知键丢弃");
const mergedA = mergeJsonAddonPrices(
  { sunnyWarranty: { a: 1 }, pricing: { discounts: { fauxwood: 0.25 }, cordless: { discount: 0.3 }, addons: { hub: 250 } } },
  { motor: 160 },
);
assert.deepEqual(
  mergedA,
  { sunnyWarranty: { a: 1 }, pricing: { discounts: { fauxwood: 0.25 }, cordless: { discount: 0.3 }, addons: { hub: 250, motor: 160 } } },
  "只动 pricing.addons 的提交键",
);
const vAp = validateAddonPricesInput({ motor: 160, downtown_fee: "180" });
assert.equal(vAp.ok, true);
if (vAp.ok) assert.deepEqual(vAp.value, { "addonPrice.motor": 160, "addonPrice.downtown_fee": 180 });
assert.equal(validateAddonPricesInput({ not_a_key: 10 }).ok, false, "未知键拒绝");
assert.equal(validateAddonPricesInput({ hub: -1 }).ok, false, "负数拒绝");
assert.equal(validateAddonPricesInput({ hub: null }).ok, false, "空值拒绝");
assert.equal(validateAddonPricesInput([1]).ok, false, "非对象拒绝");

console.log("Cost rates tests passed");
