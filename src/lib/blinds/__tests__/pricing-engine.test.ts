/**
 * 报价计算引擎单元测试
 *
 * 用法: npx tsx src/lib/blinds/__tests__/pricing-engine.test.ts
 */

import { priceFor, calculateQuoteTotal, isCordlessEligible } from '../pricing-engine';
import type { PriceResult, PriceError, QuoteTotalInput } from '../pricing-types';

let pass = 0;
let fail = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.error(`  ❌ ${msg}`);
  }
}

function isError(r: PriceResult | PriceError): r is PriceError {
  return 'error' in r;
}

// ── priceFor: basic pricing ──

console.log('\n── priceFor 基础定价 ──');

const zebra1 = priceFor('Zebra', 'Light Filtering', 36, 48);
assert(!isError(zebra1), 'Zebra 36x48 应返回有效价格');
if (!isError(zebra1)) {
  assert(zebra1.msrp > 0, `MSRP > 0 (got ${zebra1.msrp})`);
  assert(zebra1.price > 0, `price > 0 (got ${zebra1.price})`);
  assert(zebra1.price <= zebra1.msrp, 'price <= MSRP (折扣后)');
  assert(zebra1.discountPct === 0.45, `Zebra 默认折扣 45% (got ${zebra1.discountPct})`);
  assert(zebra1.install === 18, `安装费 $18 (got ${zebra1.install})`);
  assert(zebra1.cordless === false, '未请求 cordless');
  assert(zebra1.bracketWidth === 36, `bracketWidth = 36 (got ${zebra1.bracketWidth})`);
  assert(zebra1.bracketHeight === 48, `bracketHeight = 48 (got ${zebra1.bracketHeight})`);
}

// ── priceFor: price floor ──

console.log('\n── priceFor 价格底限 ──');

const zebraSmall = priceFor('Zebra', 'Light Filtering', 24, 36);
if (!isError(zebraSmall)) {
  assert(zebraSmall.price >= 100, `Zebra 价格不低于 $100 floor (got $${zebraSmall.price})`);
}

// ── priceFor: custom discount ──

console.log('\n── priceFor 自定义折扣 ──');

const zebra0 = priceFor('Zebra', 'Light Filtering', 48, 60, 0);
if (!isError(zebra0)) {
  assert(zebra0.discountPct === 0, '折扣 0%');
  assert(zebra0.price === zebra0.msrp, 'price === MSRP when no discount');
}

const zebra50 = priceFor('Zebra', 'Light Filtering', 48, 60, 0.5);
if (!isError(zebra50)) {
  assert(zebra50.discountPct === 0.5, '折扣 50%');
  assert(Math.abs(zebra50.price - zebra50.msrp * 0.5) < 0.01, 'price = MSRP * 0.5');
}

// ── priceFor: cordless ──

console.log('\n── priceFor Cordless 升级 ──');

assert(isCordlessEligible('Zebra'), 'Zebra 支持 cordless');
assert(isCordlessEligible('Roller'), 'Roller 支持 cordless');
assert(!isCordlessEligible('Drapery'), 'Drapery 不支持 cordless');
assert(!isCordlessEligible('Shutters'), 'Shutters 不支持 cordless');

const zebraCord = priceFor('Zebra', 'Light Filtering', 48, 60, null, true);
const zebraNoCord = priceFor('Zebra', 'Light Filtering', 48, 60, null, false);
if (!isError(zebraCord) && !isError(zebraNoCord)) {
  assert(zebraCord.cordless === true, 'cordless = true');
  assert(zebraCord.price > zebraNoCord.price, 'cordless 价格更高');
  const ratio = zebraCord.price / zebraNoCord.price;
  assert(Math.abs(ratio - 1.15) < 0.01, `cordless 1.15x 乘数 (got ${ratio.toFixed(3)})`);
}

// ── priceFor: cordless size limit ──

console.log('\n── priceFor Cordless 尺寸限制 ──');

const cordTooBig = priceFor('Zebra', 'Light Filtering', 80, 60, null, true);
assert(isError(cordTooBig), 'Cordless 超宽应报错');

// ── priceFor: out of range ──

console.log('\n── priceFor 超出范围 ──');

const tooWide = priceFor('Zebra', 'Light Filtering', 200, 48);
assert(isError(tooWide), '宽度超出范围应返回错误');

const tooTall = priceFor('Zebra', 'Light Filtering', 36, 200);
assert(isError(tooTall), '高度超出范围应返回错误');

// ── priceFor: unknown product ──

console.log('\n── priceFor 未知产品 ──');

const unknown = priceFor('InvalidProduct' as any, 'Standard', 36, 48);
assert(isError(unknown), '未知产品应返回错误');

// ── priceFor: wide install cost ──

console.log('\n── priceFor 宽窗安装费 ──');

const wide = priceFor('Zebra', 'Light Filtering', 72, 60);
if (!isError(wide)) {
  assert(wide.install === 26, `超宽(>70")安装费 $26 (got ${wide.install})`);
}

// ── priceFor: Shutters panel-based install ──

console.log('\n── priceFor Shutters 按面板安装 ──');

const shutters = priceFor('Shutters', 'Vinyl', 48, 48);
if (!isError(shutters)) {
  const expectedPanels = Math.ceil(48 / 35);
  const expectedInstall = expectedPanels * 18;
  assert(shutters.install === expectedInstall, `Shutters 安装费 = ${expectedPanels}面板 × $18 = $${expectedInstall} (got ${shutters.install})`);
}

// ── calculateQuoteTotal: basic total ──

console.log('\n── calculateQuoteTotal 基础计算 ──');

const totalInput: QuoteTotalInput = {
  items: [
    { product: 'Zebra', fabric: 'Light Filtering', widthIn: 36, heightIn: 48 },
    { product: 'Zebra', fabric: 'Light Filtering', widthIn: 48, heightIn: 60 },
  ],
};

const total = calculateQuoteTotal(totalInput);
assert(total.errors.length === 0, '无错误');
assert(total.itemResults.length === 2, '2 个项目');
assert(total.merchSubtotal > 0, `merchSubtotal > 0 (got $${total.merchSubtotal.toFixed(2)})`);
assert(total.installApplied > 0, `installApplied > 0 (got $${total.installApplied.toFixed(2)})`);
assert(total.deliveryFee === 50, `deliveryFee = $50 (got $${total.deliveryFee})`);
assert(total.taxRate === 0.13, `taxRate = 13% (got ${total.taxRate})`);
assert(total.taxAmount > 0, `taxAmount > 0 (got $${total.taxAmount.toFixed(2)})`);
assert(total.grandTotal > total.preTaxTotal, 'grandTotal > preTaxTotal (含税)');

const expectedPreTax = total.merchSubtotal + total.addonsSubtotal + total.installApplied + total.deliveryFee;
assert(Math.abs(total.preTaxTotal - expectedPreTax) < 0.01, 'preTaxTotal = merch + addons + install + delivery');

const expectedGrand = total.preTaxTotal * (1 + total.taxRate);
assert(Math.abs(total.grandTotal - expectedGrand) < 0.01, 'grandTotal = preTaxTotal × 1.13');

// ── calculateQuoteTotal: pickup mode ──

console.log('\n── calculateQuoteTotal 自取模式 ──');

const pickupTotal = calculateQuoteTotal({ ...totalInput, installMode: 'pickup' });
assert(pickupTotal.installApplied === 0, '自取模式安装费 = 0');
assert(pickupTotal.grandTotal < total.grandTotal, '自取总价 < 默认总价');

// ── calculateQuoteTotal: with errors ──

console.log('\n── calculateQuoteTotal 含错误项 ──');

const mixedInput: QuoteTotalInput = {
  items: [
    { product: 'Zebra', fabric: 'Light Filtering', widthIn: 36, heightIn: 48 },
    { product: 'Zebra', fabric: 'Light Filtering', widthIn: 999, heightIn: 48 },
  ],
};

const mixed = calculateQuoteTotal(mixedInput);
assert(mixed.errors.length === 1, '1 个错误');
assert(mixed.itemResults.length === 1, '1 个有效项目');
assert(mixed.errors[0].index === 1, '错误项 index = 1');

// ── Summary ──

console.log('\n═══════════════════════════════════════');
console.log(`  报价引擎测试: ${pass}/${pass + fail} 通过, ${fail} 失败`);
console.log('═══════════════════════════════════════\n');

if (fail > 0) process.exit(1);
