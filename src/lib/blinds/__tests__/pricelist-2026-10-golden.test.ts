/**
 * 价格表 2026-10-28 黄金对照（PRICE-1，design D4）
 *
 * 黄金用例由 Lucas 上传的报价工作台自带 price() 原函数生成（scripts/pricelist/gen-golden.mjs），
 * 文件 config/pricelist/2026-10-28-golden-cases.json 是定价契约。
 *   - MUST_MATCH：本 change 必须逐条一致（金额误差 ≤ 0.01；报错 ↔ 报错）
 *   - DEFERRED：留给 PRICE-2（无绳独立折扣 / 最低价 / 取消 75" 上限、褶皱率）
 *   - 两组并集必须覆盖文件里全部标签；出现未归组标签直接失败，防止缺口被藏起来
 *
 * 运行：npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { priceFor, calculateQuoteTotal, applyManualSellingPrice } from "../pricing-engine";
import { BASE_PRICE_VERSION, PRICE_LIST_2026_10_28_SOURCE } from "../pricing-data";
import type { ProductName } from "../pricing-types";
import { canonicalSku, skuToPricingFabric } from "../sku-catalog";
import { stampPricelistVersion, readPricelistVersion } from "../pricelist-version";

interface GoldenCase {
  tag: string;
  input: {
    product: string;
    fabric: string;
    w: number;
    h: number;
    cordless?: boolean;
    discountOverridePct?: number;
    fullness?: number;
  };
  expect?: {
    msrp: number;
    standard: number;
    install: number;
    discount: number;
    floor: number;
    billW: number;
    billH: number;
    cordless: boolean;
    bump: number;
  };
  expectError?: string;
}

const ROOT = join(__dirname, "..", "..", "..", "..");
const GOLDEN_PATH = join(ROOT, "config", "pricelist", "2026-10-28-golden-cases.json");
const SOURCE_PATH = join(ROOT, "config", "pricelist", "2026-10-28-lucas-quote.json");

const MUST_MATCH = new Set([
  "fauxwood",
  "allusion",
  "regression",
  "zebra",
  "roller",
  "door-screen",
  "door-screen-err",
  "cordless-ignored",
]);
const DEFERRED = new Set([
  "cordless-zebra",
  "cordless-zebra-bo",
  "cordless-roller",
  "cordless-roller-cassette",
  "cordless-override",
  "fullness-drapery",
  "fullness-sheer",
  "fullness-default",
  "fullness-invalid",
  "door-screen-no-fullness",
]);

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name);
  }
}

// ── 0. 版本与来源 ──
assert.equal(BASE_PRICE_VERSION, "2026-10-28", "价表版本");
const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8")) as {
  source: { indexHtmlSha256: string; xlsxSha256: string };
};
assert.equal(PRICE_LIST_2026_10_28_SOURCE.indexHtmlSha256, source.source.indexHtmlSha256, "index.html 来源哈希与增量文件一致");
assert.equal(PRICE_LIST_2026_10_28_SOURCE.xlsxSha256, source.source.xlsxSha256, "xlsx 来源哈希与增量文件一致");

// ── 1. 标签必须全部归组 ──
const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as { count: number; cases: GoldenCase[] };
assert.equal(golden.cases.length, golden.count, "用例数与文件头一致");
const tags = new Set(golden.cases.map((c) => c.tag));
const unassigned = [...tags].filter((t) => !MUST_MATCH.has(t) && !DEFERRED.has(t));
assert.deepEqual(unassigned, [], `黄金文件里有未归组的标签：${unassigned.join(", ")}`);
for (const t of MUST_MATCH) assert.ok(DEFERRED.has(t) === false, `${t} 不能同时在两组`);

// ── 2. MUST_MATCH 逐条对照 ──
const EPS = 0.01;
let matched = 0;
for (const c of golden.cases) {
  if (!MUST_MATCH.has(c.tag)) continue;
  matched++;
  const name = `${c.tag} ${c.input.product}/${c.input.fabric} ${c.input.w}x${c.input.h}${c.input.cordless ? " cordless" : ""}`;
  const r = priceFor(
    c.input.product as ProductName,
    c.input.fabric,
    c.input.w,
    c.input.h,
    typeof c.input.discountOverridePct === "number" ? c.input.discountOverridePct : null,
    c.input.cordless ?? false,
  );
  if (c.expectError !== undefined) {
    check("error" in r, `${name} → 应报错（原工具：${c.expectError}）`);
    continue;
  }
  const e = c.expect!;
  if ("error" in r) {
    check(false, `${name} → 引擎报错 ${r.error}，原工具给出金额 ${e.standard}`);
    continue;
  }
  check(Math.abs(r.msrp - e.msrp) <= EPS, `${name} msrp ${r.msrp} vs ${e.msrp}`);
  check(Math.abs(r.price - e.standard) <= EPS, `${name} 成交 ${r.price} vs ${e.standard}`);
  check(r.install === e.install, `${name} 安装 ${r.install} vs ${e.install}`);
  check(r.bracketWidth === e.billW && r.bracketHeight === e.billH, `${name} 取档 ${r.bracketWidth}x${r.bracketHeight} vs ${e.billW}x${e.billH}`);
  check(r.cordless === e.cordless, `${name} 无绳标记 ${r.cordless} vs ${e.cordless}`);
  // 原工具的 discount 字段是"产品默认折扣"，Door Screen Sheer 特殊分支实际按 0 折扣计价（金额已在上面核对），
  // 青砚 discountPct 记录的是实际套用的折扣，因此该组不比折扣字段。
  if (c.tag !== "door-screen") {
    check(Math.abs(r.discountPct - e.discount) <= 1e-9, `${name} 折扣 ${r.discountPct} vs ${e.discount}`);
  }
}
assert.ok(matched >= 40, `MUST_MATCH 组应至少 40 条，实际 ${matched}`);

// ── 3. 本地用例（原工具没有的青砚行为）──
// 3a Allusion 手动成交单价覆盖（design D2）
{
  const table = priceFor("Allusion", "Standard", 24, 36, null, false);
  assert.ok(!("error" in table), "Allusion 24x36 查表成功");
  if (!("error" in table)) {
    const over = applyManualSellingPrice(table, 300);
    check(over.price === 300, "Allusion 手填 300 → 成交 300");
    check(Math.abs(over.msrp - table.msrp) < 1e-9, "Allusion 手填后 MSRP 仍是价表值");
    check(Math.abs(over.discountValue - Math.max(0, table.msrp - 300)) < 1e-9, "Allusion 手填后折扣额 = MSRP − 300");
    check(over.discountPct === table.discountPct, "Allusion 手填后 discountPct 保持查表折扣");
    check(applyManualSellingPrice(table, 0) === table && applyManualSellingPrice(table, undefined) === table, "手填 0 / 未填 → 原样查表");
    const tooHigh = applyManualSellingPrice(table, table.msrp + 100);
    check(tooHigh.discountValue === 0, "手填高于 MSRP 时折扣额为 0 不为负");
  }
  const total = calculateQuoteTotal({
    items: [
      { product: "Allusion", fabric: "Standard", widthIn: 24, heightIn: 36, manualPrice: 300 },
      { product: "Allusion", fabric: "Standard", widthIn: 24, heightIn: 36 },
      { product: "Roman", fabric: "Roman", widthIn: 24, heightIn: 36 },
    ],
    installMode: "pickup",
    deliveryFee: 0,
    taxRate: 0,
  });
  check(total.itemResults.length === 2 && total.itemResults[0].price === 300, "calculateQuoteTotal：Allusion 手填行成交 300");
  check(total.itemResults[1].price !== 300 && total.itemResults[1].bracketWidth === 24, "calculateQuoteTotal：Allusion 未手填行走查表");
  check(total.errors.length === 1 && /手填单价/.test(total.errors[0].error) && total.errors[0].input.product === "Roman", "Roman 未填单价仍报错，文案不变");
  const zebraManual = calculateQuoteTotal({
    items: [{ product: "Zebra", fabric: "Light Filtering", widthIn: 24, heightIn: 36, manualPrice: 1 }],
    installMode: "pickup", deliveryFee: 0, taxRate: 0,
  });
  check(zebraManual.itemResults[0].price !== 1, "非 Allusion 产品的 manualPrice 被忽略（本次只对 Allusion 开放）");
}
// 3b SKU 别名 + 价表版本写入（task 3.1）
{
  check(canonicalSku("LOUIA-WHITE-LF-BL201") === "LOUIA-WHITE-BL201-LF", "旧编号 → 正式编号");
  check(canonicalSku("LOUIA-WHITE-BL201-LF") === "LOUIA-WHITE-BL201-LF" && canonicalSku("RL-AQUAWIDE3-BEIGE-LF") === "RL-AQUAWIDE3-BEIGE-LF", "正式编号 / 其它编号原样");
  check(skuToPricingFabric("LOUIA-WHITE-LF-BL201", "Zebra") === "Light Filtering", "旧编号定价面料 = Light Filtering（经别名归一后按 -LF 后缀）");
  check(skuToPricingFabric("LOUIA-WHITE-BL201-LF", "Zebra") === "Light Filtering", "新编号定价面料 = Light Filtering");
  const stamped = stampPricelistVersion(JSON.stringify({ orderNumber: "X1", shadeOrders: [] }));
  check(readPricelistVersion(stamped) === "2026-10-28", "formDataJson 合并 pricelistVersion");
  check(JSON.parse(stamped!).orderNumber === "X1", "原字段保留");
  check(stampPricelistVersion("not json") === "not json" && stampPricelistVersion("[1]") === "[1]" && stampPricelistVersion(undefined) === undefined, "非对象 / 非法 / 缺省原样返回");
  check(readPricelistVersion("{}") === null && readPricelistVersion(null) === null, "读回缺省 → null");
}

const deferredCount = golden.cases.filter((c) => DEFERRED.has(c.tag)).length;
console.log(`黄金对照：MUST_MATCH ${matched} 条（断言 ${pass + fail}，失败 ${fail}）；DEFERRED ${deferredCount} 条留给 PRICE-2`);
if (fail) {
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("价格表 2026-10-28 黄金对照通过");
