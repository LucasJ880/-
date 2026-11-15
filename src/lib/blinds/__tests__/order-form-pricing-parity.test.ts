/**
 * 详细订单定价口径对照（QUOTE-1a，openspec change quote-order-form-pricing-parity）
 *
 * 走页面实际用的路径：表单行 → buildOrderFormItems → applyOrgDiscountDefaults → calculateQuoteTotal，
 * 并与页面预览（compute*LinePrice）逐行比。现有 158 条黄金用例只测引擎，测不到「表单行 → 定价键」这一段。
 *
 * 运行：npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts
 */
import { priceFor } from "@/lib/blinds/pricing-engine";
import { DEFAULT_DISCOUNTS } from "@/lib/blinds/pricing-data";
import { skuToPricingFabric } from "@/lib/blinds/sku-catalog";
import {
  ORDER_PRICING_REV,
  effectiveShadeValance,
  needsWoodRepriceNotice,
  readOrderPricingRev,
  shadeLinePricingFabric,
  shutterPricingFabric,
} from "@/lib/blinds/order-form-pricing";
import { mapQuoteFormToProcessOrder } from "@/lib/sunny-process/quote-mapping";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

const ROW_VALANCES = ["", "None", "Cassette", "Fascia"] as const;
const FORM_VALANCES = ["", "Cassette", "Fascia"] as const;
const SKU_BO = "CABO-WHITE-BO";
const SKU_LF = "ADORO-CREAMY-LF";

console.log("详细订单定价口径对照");

// ── ① 定价键 ──────────────────────────────────────────────
console.log("① 定价键");
{
  ok(effectiveShadeValance("Cassette", "Fascia") === "Cassette", "KEY-01a: 行上有值取行上");
  ok(effectiveShadeValance("", "Fascia") === "Fascia" && effectiveShadeValance("  ", "Cassette") === "Cassette", "KEY-01b: 行上为空取表底部 Valance Type");
  ok(effectiveShadeValance("None", "Cassette") === "None", "KEY-01c: 行上明确选 None 不回落到表底部");
  ok(effectiveShadeValance("", "") === "" && effectiveShadeValance(undefined, null) === "", "KEY-01d: 两处都空 → 无生效罩型");

  const suffix = (v: string) => (v === "Cassette" ? "w Cassette" : v === "Fascia" ? "w Fascia" : "(Open Roll)");
  let mismatches: unknown[] = [];
  for (const [sku, base] of [[SKU_BO, "Blackout"], [SKU_LF, "Light Filtering"]] as const) {
    for (const row of ROW_VALANCES) for (const form of FORM_VALANCES) {
      const eff = effectiveShadeValance(row, form);
      const got = shadeLinePricingFabric({ product: "Roller", sku }, eff);
      const want = `${base} ${suffix(eff)}`;
      if (got !== want) mismatches.push({ sku, row, form, got, want });
    }
  }
  ok(mismatches.length === 0, "KEY-02: Roller 真实 SKU（-BO / -LF）× 行上 4 种 × 表底部 3 种 = 24 个定价键", mismatches);
  ok(shadeLinePricingFabric({ product: "Roller", sku: SKU_BO }, "Cassette") === "Blackout w Cassette", "KEY-02a: CABO-WHITE-BO + Cassette → Blackout w Cassette");
  ok(shadeLinePricingFabric({ product: "Roller", sku: SKU_BO }, "None") === "Blackout (Open Roll)", "KEY-02b: CABO-WHITE-BO + None → Blackout (Open Roll)");
  ok(shadeLinePricingFabric({ product: "Roller", sku: SKU_BO }, "") === skuToPricingFabric(SKU_BO, "Roller"), "KEY-02c: 无生效罩型时与改动前相同（Open Roll）");

  // SKU 本身是完整定价面料（SKU 目录加载失败时的下拉回落值 / 旧数据）
  ok(shadeLinePricingFabric({ product: "Roller", sku: "Blackout w Cassette" }, "") === "Blackout w Cassette", "KEY-03a: SKU 是完整键且无生效罩型 → 原键照旧");
  ok(shadeLinePricingFabric({ product: "Roller", sku: "Blackout w Cassette" }, "None") === "Blackout (Open Roll)", "KEY-03b: SKU 是完整键、生效罩型 None → 以罩型为准");
  ok(shadeLinePricingFabric({ product: "Roller", sku: "Light Filtering (Open Roll)" }, "Fascia") === "Light Filtering w Fascia", "KEY-03c: SKU 是 Open Roll 键、生效罩型 Fascia → w Fascia");
  ok(shadeLinePricingFabric({ product: "Roller", sku: SKU_BO }, "N/A") === "Blackout (Open Roll)", "KEY-03d: 认不出的罩型按无罩（与工艺单 Roller 无值 → 单轨无盒一致）");

  // 非 Roller：罩型不进定价键
  mismatches = [];
  for (const [product, sku] of [["Zebra", "PRADO-WHITE-LF"], ["Zebra", "MILAN-GREY-BO"], ["SHANGRILA", "Standard"], ["Cordless Cellular", "B01-38-BO100"], ["Fauxwood", "Standard"], ["Allusion", "Standard"], ["Roman Shade", "BMF06-BO"]] as const) {
    for (const v of ROW_VALANCES) {
      const got = shadeLinePricingFabric({ product, sku }, v);
      if (got !== skuToPricingFabric(sku, product)) mismatches.push({ product, sku, v, got });
    }
  }
  ok(mismatches.length === 0, "KEY-04: 非 Roller 产品的定价键与 skuToPricingFabric 相同，不随罩型变", mismatches);

  ok(shutterPricingFabric("Wooden") === "Wood" && shutterPricingFabric("Vinyl") === "Vinyl", "KEY-05: Shutters Wooden → Wood、Vinyl → Vinyl");
  const wood = priceFor("Shutters", shutterPricingFabric("Wooden"), 72, 60, DEFAULT_DISCOUNTS.Shutters);
  ok(!("error" in wood) && r2(wood.price) === 1172.22, "KEY-05a: 引擎用映射后的键 72×60 = 1172.22", wood);
}

// ── ④ 定价 ⇔ 工艺单罩盒 ───────────────────────────────────
console.log("④ 定价罩型与工艺单罩盒同一取值");
{
  const shade = (o: Record<string, unknown>) => ({ id: "x", location: "Living", widthWhole: "55", widthFrac: "0", heightWhole: "72", heightFrac: "0", product: "Roller", sku: SKU_BO, mount: "I", lift: "L", bracket: "C", valance: "", note: "", ...o });
  const form = (o: Record<string, unknown>) => JSON.stringify({ orderNumber: "G1115-01-R1", shadeOrders: [], shutterOrders: [], drapeOrders: [], shutterMaterial: "Vinyl", shutterLouverSize: '3-1/2"', shadeValanceType: "", shadeBracketType: "", ...o });
  const headrailOf = (row: string, formValance: string) =>
    mapQuoteFormToProcessOrder(form({ shadeOrders: [shade({ valance: row })], shadeValanceType: formValance })).blindsItems[0]!.headrailType;
  const surchargeOf = (row: string, formValance: string) => {
    const key = shadeLinePricingFabric({ product: "Roller", sku: SKU_BO }, effectiveShadeValance(row, formValance));
    const withKey = priceFor("Roller", key, 55, 72, DEFAULT_DISCOUNTS.Roller);
    const open = priceFor("Roller", "Blackout (Open Roll)", 55, 72, DEFAULT_DISCOUNTS.Roller);
    if ("error" in withKey || "error" in open) throw new Error("引擎报错");
    return r2(withKey.price - open.price);
  };
  const bad: unknown[] = [];
  let combos = 0;
  for (const row of ROW_VALANCES) for (const fv of FORM_VALANCES) {
    combos++;
    const headrail = headrailOf(row, fv);
    const surcharge = surchargeOf(row, fv);
    if ((surcharge > 0) !== (headrail !== "单轨无盒")) bad.push({ row, fv, headrail, surcharge });
  }
  ok(combos === 12 && bad.length === 0, "PROC-01: 行上 4 种 × 表底部 3 种 = 12 组合，含罩盒加价 ⇔ 工艺单罩盒不是单轨无盒", bad);
  ok(headrailOf("", "Cassette") === "亮白插片圆盒" && surchargeOf("", "Cassette") === 50, "PROC-02: 行上留空、表底部 Cassette → 亮白插片圆盒 + 加价 50");
  ok(headrailOf("None", "Cassette") === "单轨无盒" && surchargeOf("None", "Cassette") === 0, "PROC-03: 行上 None 优先于表底部 Cassette → 单轨无盒 + 不加价");
  ok(headrailOf("Fascia", "") === "哑白方型罩盒" && surchargeOf("Fascia", "") === 50, "PROC-04: 行上 Fascia → 哑白方型罩盒 + 加价 50");
}

// ── ⑤ 口径标记与提醒判定 ──────────────────────────────────
console.log("⑤ 口径标记与实木旧报价提醒");
{
  ok(ORDER_PRICING_REV === 2, "REV-01: 本口径标记为 2");
  ok(readOrderPricingRev(undefined) === 1 && readOrderPricingRev(null) === 1 && readOrderPricingRev("2") === 1 && readOrderPricingRev(NaN) === 1 && readOrderPricingRev(0) === 1, "REV-02: 缺失 / 非法标记视为 1（改动前保存的）");
  ok(readOrderPricingRev(2) === 2 && readOrderPricingRev(3) === 3, "REV-03: 合法标记原样读出");
  ok(needsWoodRepriceNotice({ loadedRev: 1, shutterMaterial: "Wooden", shutterMerch: 1172.22 }), "REV-04: 旧表单 + Wooden + 百叶窗有价 → 提醒");
  ok(!needsWoodRepriceNotice({ loadedRev: 2, shutterMaterial: "Wooden", shutterMerch: 1172.22 }), "REV-05: 已按本口径保存 / 新建（标记 2）→ 不提醒");
  ok(!needsWoodRepriceNotice({ loadedRev: 1, shutterMaterial: "Vinyl", shutterMerch: 701.29 }), "REV-06: Vinyl → 不提醒");
  ok(!needsWoodRepriceNotice({ loadedRev: 1, shutterMaterial: "Wooden", shutterMerch: 0 }), "REV-07: Wooden 但没有能算出价的百叶窗行 → 不提醒");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
