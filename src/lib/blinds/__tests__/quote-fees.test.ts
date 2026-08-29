/**
 * 最低安装费 + 运费（驾驶舱可配置）行为测试
 * 运行：npx tsx src/lib/blinds/__tests__/quote-fees.test.ts
 */

import assert from "node:assert/strict";
import { calculateQuoteTotal } from "../pricing-engine";
import { validateDiscountsInput } from "../discount-settings";
import {
  DEFAULT_DELIVERY_FEE,
  DEFAULT_MIN_INSTALL_FEE,
  INSTALL_RULES,
} from "../pricing-data";
import type { QuoteItemInput } from "../pricing-types";

const zebra: QuoteItemInput = {
  product: "Zebra",
  fabric: "Light Filtering",
  widthIn: 24,
  heightIn: 36,
};

// ── 平台默认值本身 ──
assert.equal(DEFAULT_MIN_INSTALL_FEE, 200, "最低安装费默认 $200");
assert.equal(DEFAULT_DELIVERY_FEE, 75, "运费默认 $75");
assert.equal(INSTALL_RULES.minimumTotal, DEFAULT_MIN_INSTALL_FEE);

// ── installation 模式：安装补足到最低值 + 运费单列 ──
const installed = calculateQuoteTotal({
  items: [zebra],
  installMode: "default",
  taxRate: 0,
});
assert.equal(
  installed.installApplied,
  DEFAULT_MIN_INSTALL_FEE,
  "单行小单：安装费补足到最低安装费",
);
assert.equal(installed.deliveryFee, DEFAULT_DELIVERY_FEE, "运费按默认费率收取");
assert.equal(
  installed.preTaxTotal,
  installed.merchSubtotal + DEFAULT_MIN_INSTALL_FEE + DEFAULT_DELIVERY_FEE,
);

// ── 行内安装费超过最低值：不再补足，但运费照收 ──
const manyItems = calculateQuoteTotal({
  items: Array.from({ length: 15 }, () => ({ ...zebra })),
  installMode: "default",
  taxRate: 0,
});
assert.ok(
  manyItems.installSubtotal > DEFAULT_MIN_INSTALL_FEE,
  "构造行内安装费超过最低值的场景",
);
assert.equal(manyItems.installApplied, manyItems.installSubtotal, "不补足");
assert.equal(manyItems.deliveryFee, DEFAULT_DELIVERY_FEE, "运费仍然收取");

// ── pickup 自提：安装与运费都免收（即使显式传入费率） ──
const pickup = calculateQuoteTotal({
  items: [zebra],
  installMode: "pickup",
  deliveryFee: 75,
  taxRate: 0,
});
assert.equal(pickup.installApplied, 0, "pickup 免安装费");
assert.equal(pickup.deliveryFee, 0, "pickup 免运费");
assert.equal(pickup.preTaxTotal, pickup.merchSubtotal);

// ── 全部行报错（无有效行）：不收运费，避免空单出 $75 ──
const allInvalid = calculateQuoteTotal({
  items: [{ ...zebra, fabric: "不存在的面料" }],
  installMode: "default",
  taxRate: 0,
});
assert.equal(allInvalid.itemResults.length, 0);
assert.equal(allInvalid.deliveryFee, 0, "无有效行不收运费");
assert.equal(allInvalid.grandTotal, 0);

// ── 企业覆盖：minInstallTotal / deliveryFee 入参生效 ──
const overridden = calculateQuoteTotal({
  items: [zebra],
  installMode: "default",
  minInstallTotal: 250,
  deliveryFee: 80,
  taxRate: 0,
});
assert.equal(overridden.installApplied, 250, "企业最低安装费覆盖生效");
assert.equal(overridden.deliveryFee, 80, "企业运费覆盖生效");

// ── 设置校验：金额字段 0~10000，四舍五入到分 ──
const valid = validateDiscountsInput({ minInstallFee: 200.005, deliveryFee: 75 });
assert.equal(valid.ok, true);
if (valid.ok) {
  assert.equal(valid.value.minInstallFee, 200.01);
  assert.equal(valid.value.deliveryFee, 75);
}
assert.equal(validateDiscountsInput({ minInstallFee: 10001 }).ok, false);
assert.equal(validateDiscountsInput({ deliveryFee: -1 }).ok, false);

// ── 提成估算参数：0~1 比例校验 ──
const commissionValid = validateDiscountsInput({
  commissionMarginRate: 0.42,
  commissionRate: 0.3,
});
assert.equal(commissionValid.ok, true);
if (commissionValid.ok) {
  assert.equal(commissionValid.value.commissionMarginRate, 0.42);
  assert.equal(commissionValid.value.commissionRate, 0.3);
}
assert.equal(validateDiscountsInput({ commissionMarginRate: 1.5 }).ok, false, "系数超 1 拒绝");
assert.equal(validateDiscountsInput({ commissionRate: -0.1 }).ok, false, "负比例拒绝");

console.log("Quote fee settings tests passed");
