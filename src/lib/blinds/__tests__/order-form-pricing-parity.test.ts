/**
 * 详细订单定价口径对照（QUOTE-1a，openspec change quote-order-form-pricing-parity）
 *
 * 走页面实际用的路径：表单行 → buildOrderFormItems → applyOrgDiscountDefaults → calculateQuoteTotal，
 * 并与页面预览（compute*LinePrice）逐行比。现有 158 条黄金用例只测引擎，测不到「表单行 → 定价键」这一段。
 *
 * 运行：npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateQuoteTotal, priceFor } from "@/lib/blinds/pricing-engine";
import { applyOrgDiscountDefaults } from "@/lib/blinds/discount-settings";
import type { ProductName } from "@/lib/blinds/pricing-types";
import { DEFAULT_DISCOUNTS } from "@/lib/blinds/pricing-data";
import { skuToPricingFabric } from "@/lib/blinds/sku-catalog";
import {
  ORDER_PRICING_REV,
  applyShadeProductChange,
  applyShadeSkuChange,
  effectiveShadeValance,
  lineDiscountLabel,
  lineDiscountOverride,
  needsWoodRepriceNotice,
  readOrderPricingRev,
  shadeLinePricingFabric,
  shutterPricingFabric,
  skuSelectOptions,
  woodRepriceNoticeText,
} from "@/lib/blinds/order-form-pricing";
import type { SkuEntry } from "@/lib/blinds/sku-catalog";
import { mapQuoteFormToProcessOrder } from "@/lib/sunny-process/quote-mapping";
import { DEFAULT_CORDLESS_POLICY, DEFAULT_SUNNY_MOTOR_PRICE } from "@/lib/blinds/pricing-data";
import {
  computeDrapeLinePrice,
  computeShadeLinePrice,
  computeShutterLinePrice,
  sumAllMsrp,
  sumShadeTotals,
} from "@/app/(main)/sales/quote-sheet/pricing-helpers";
import { buildOrderFormItems } from "@/app/(main)/sales/quote-sheet/order-items";
import { loadDraft, saveDraft, type QuoteDraftV1 } from "@/app/(main)/sales/quote-sheet/quote-draft";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import type { DrapeOrderLine, ShadeOrderLine, ShutterOrderLine } from "@/app/(main)/sales/quote-sheet/types";

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

// ── 表单行夹具（与页面 emptyLine 同形）─────────────────────
const shadeLine = (o: Partial<ShadeOrderLine>): ShadeOrderLine => ({
  id: "s", location: "Living", widthWhole: "55", widthFrac: "0", heightWhole: "72", heightFrac: "0",
  product: "Roller", sku: SKU_BO, mount: "", lift: "", bracket: "", valance: "", note: "", manualPrice: "", ...o,
});
const shutterLine = (o: Partial<ShutterOrderLine>): ShutterOrderLine => ({
  id: "h", location: "Bedroom", widthWhole: "72", widthFrac: "0", heightWhole: "60", heightFrac: "0",
  frame: "", openDirection: "", mountType: "", midRail: "", panelCount: 1, draft: "", ...o,
});

// ── ② 预览金额 ────────────────────────────────────────────
console.log("② 预览金额");
{
  const preview = (o: Partial<ShadeOrderLine>, formValance = "", mode: "default" | "pickup" = "default") => {
    const p = computeShadeLinePrice(shadeLine(o), mode, DEFAULT_DISCOUNTS, DEFAULT_SUNNY_MOTOR_PRICE, DEFAULT_CORDLESS_POLICY, formValance);
    if (!p || p.error) throw new Error(`预览报错：${p?.error ?? "null"}`);
    return p;
  };
  // 任务书 a：Roller 55×72 CABO-WHITE-BO
  ok(r2(preview({ valance: "None" }).merch) === 221.88, "PRE-01a: Roller 55×72 CABO-WHITE-BO Valance=None → 221.88");
  ok(r2(preview({ valance: "Cassette" }).merch) === 271.88, "PRE-01b: Valance=Cassette → 271.88（修之前 221.88）");
  ok(r2(preview({ valance: "Fascia" }).merch) === 271.88, "PRE-01c: Valance=Fascia → 271.88（与 Cassette 同价）");
  ok(r2(preview({ valance: "" }).merch) === 221.88, "PRE-01d: 行上留空、表底部未选 → 221.88");
  ok(r2(preview({ valance: "" }, "Cassette").merch) === 271.88, "PRE-01e: 行上留空、表底部 Cassette → 271.88");
  ok(r2(preview({ valance: "None" }, "Cassette").merch) === 221.88, "PRE-01f: 行上 None、表底部 Cassette → 221.88");
  ok(preview({ valance: "Cassette" }).install === 18 && preview({ valance: "Cassette" }, "", "pickup").install === 0, "PRE-01g: 带罩行安装费 18，自提 0（不随罩型变）");

  // 窗宽 49 / 50 / 55 × 行上 4 种 × 有无无绳（字面量来自 design 参考表）
  const table: Record<number, { open: number; cass: number; cOpen: number; cCass: number }> = {
    49: { open: 202.5, cass: 227.5, cOpen: 296.39, cCass: 325.14 },
    50: { open: 202.5, cass: 252.5, cOpen: 296.39, cCass: 353.89 },
    55: { open: 221.88, cass: 271.88, cOpen: 324.74, cCass: 382.24 },
  };
  const bad: unknown[] = [];
  let n = 0;
  for (const w of [49, 50, 55]) for (const valance of ROW_VALANCES) for (const cordless of [false, true]) {
    n++;
    const withBox = valance === "Cassette" || valance === "Fascia";
    const want = cordless ? (withBox ? table[w]!.cCass : table[w]!.cOpen) : (withBox ? table[w]!.cass : table[w]!.open);
    const got = r2(preview({ widthWhole: String(w), valance, cordless }).merch);
    if (got !== want) bad.push({ w, valance, cordless, got, want });
  }
  ok(n === 24 && bad.length === 0, "PRE-02: 窗宽 49 / 50 / 55 × 行上 4 种 × 有无无绳 = 24 行与字面量一致", bad);
  ok(r2(preview({ widthWhole: "49", valance: "Cassette" }).merch - preview({ widthWhole: "49", valance: "None" }).merch) === 25
    && r2(preview({ widthWhole: "50", valance: "Cassette" }).merch - preview({ widthWhole: "50", valance: "None" }).merch) === 50
    && r2(preview({ widthWhole: "55", valance: "Cassette" }).merch - preview({ widthWhole: "55", valance: "None" }).merch) === 50,
    "PRE-02a: 加价 25（49\"）/ 50（50\"）/ 50（55\"），以 50\" 为界");
  ok(r2(preview({ valance: "Cassette", cordless: true }).merch) === 382.24 && r2(preview({ valance: "None", cordless: true }).merch) === 324.74, "PRE-02b: 无绳 55×72 带罩 382.24 / 无罩 324.74");

  // Zebra：罩型不进定价
  const z = (valance: string, fv = "") => r2(preview({ product: "Zebra", sku: "PRADO-WHITE-LF", widthWhole: "40", heightWhole: "50", valance }, fv).merch);
  ok(z("Cassette") === z("Fascia") && z("Cassette") === z("") && z("", "Fascia") === z("Cassette"), "PRE-03: Zebra 行金额不随行上 / 表底部罩型变", [z("Cassette"), z("Fascia"), z("")]);

  // 小计与 MSRP 合计也带上表底部罩型
  const lines = [shadeLine({ id: "1", valance: "" }), shadeLine({ id: "2", valance: "None" })];
  const t0 = sumShadeTotals(lines, "pickup", DEFAULT_DISCOUNTS);
  const t1 = sumShadeTotals(lines, "pickup", DEFAULT_DISCOUNTS, DEFAULT_SUNNY_MOTOR_PRICE, DEFAULT_CORDLESS_POLICY, "Cassette");
  ok(r2(t0.merch) === 443.75 && r2(t1.merch) === 493.75, "PRE-04a: sumShadeTotals 两行（未取整 221.875 ×2）= 443.75；表底部 Cassette 只加到行上留空的那一行 → 493.75", [t0.merch, t1.merch]);
  const m0 = sumAllMsrp(lines, [], "Vinyl", []);
  const m1 = sumAllMsrp(lines, [], "Vinyl", [], DEFAULT_SUNNY_MOTOR_PRICE, "Cassette");
  ok(r2(m1 - m0) === 50, "PRE-04b: sumAllMsrp（成交折扣率的分母）随罩盒加价 +50", [m0, m1]);

  // 任务书 c：Shutters 72×60
  const sh = (material: "Wooden" | "Vinyl", o: Partial<ShutterOrderLine> = {}, mode: "default" | "pickup" = "default") => {
    const p = computeShutterLinePrice(shutterLine(o), material, mode, DEFAULT_DISCOUNTS);
    if (!p) throw new Error("预览 null");
    return p;
  };
  ok(sh("Wooden").error === null && r2(sh("Wooden").merch) === 1172.22 && sh("Wooden").install === 54, "PRE-05a: Shutters Wooden 72×60 → 1172.22 + 安装 54（修之前报错）", sh("Wooden"));
  ok(r2(sh("Vinyl").merch) === 701.29 && sh("Vinyl").install === 54, "PRE-05b: Shutters Vinyl 72×60 → 701.29 + 安装 54（不变）");
  ok(r2(sh("Wooden", { panelCount: 2 }).merch) === 2344.43 && sh("Wooden", { panelCount: 2 }).install === 108, "PRE-05c: Wooden Panel 数 2 → 商品与安装都 ×2", sh("Wooden", { panelCount: 2 }));
  ok(r2(sh("Vinyl", { panelCount: 2 }).merch) === 1402.58 && sh("Vinyl", { panelCount: 2 }, "pickup").install === 0, "PRE-05d: Vinyl Panel 数 2 → 1402.58；自提安装 0", sh("Vinyl", { panelCount: 2 }));
  const over = sh("Wooden", { widthWhole: "400" });
  ok(typeof over.error === "string" && /Out of range/.test(over.error) && over.merch === 0, "PRE-05e: Wooden 超出价表范围仍报超范围、不计价", over);
  ok(r2(sumAllMsrp([], [shutterLine({})], "Wooden", [])) === 1803.41, "PRE-05f: 实木行进入 MSRP 合计（1803.41）");
}

// ── ③ 表单行 → 行构造 → 企业默认折扣 → 引擎，与预览逐行比 ──
console.log("③ 完整路径：保存 = 预览");
{
  const drapeLine = (o: Partial<DrapeOrderLine>): DrapeOrderLine => ({
    id: "d", location: "Dining",
    drapeWidthWhole: "", drapeWidthFrac: "0", drapeHeightWhole: "", drapeHeightFrac: "0", drapeFabricSku: "",
    drapeFullness: "180", drapePanels: "S", drapePleatStyle: "", drapeLiner: false, drapeBracket: "",
    sheerWidthWhole: "", sheerWidthFrac: "0", sheerHeightWhole: "", sheerHeightFrac: "0", sheerFabricSku: "",
    sheerFullness: "180", sheerPanels: "S", sheerPleatStyle: "", sheerBracket: "", accessoriesSku: "", note: "", ...o,
  });
  type Discounts = Record<ProductName, number>;
  /** 服务端同款：行构造 → 套企业默认折扣 → 引擎（quotes/route.ts 与 quote-update.ts 的调用顺序） */
  const save = (form: Parameters<typeof buildOrderFormItems>[0], discounts: Discounts) => {
    const items = buildOrderFormItems(form);
    const calc = calculateQuoteTotal({ items: applyOrgDiscountDefaults(items, discounts), installMode: "default", cordlessPolicy: DEFAULT_CORDLESS_POLICY });
    return { items, calc };
  };
  const emptyForm = { shadeOrders: [], shutterOrders: [], drapeOrders: [], shutterMaterial: "Vinyl" as const, shadeValanceType: "" };

  // 任务书 a / c 的提交内容
  {
    const { items, calc } = save({ ...emptyForm, shadeOrders: [shadeLine({ valance: "Cassette" })] }, DEFAULT_DISCOUNTS);
    ok(items.length === 1 && items[0]!.fabric === "Blackout w Cassette" && items[0]!.sku === SKU_BO, "SAVE-01a: Roller CABO-WHITE-BO + Cassette 提交的定价面料 = Blackout w Cassette，sku 仍是销售选的 SKU", items);
    ok(calc.errors.length === 0 && r2(calc.merchSubtotal) === 271.88 && calc.itemResults[0]!.install === 18, "SAVE-01b: 保存金额 271.88 + 安装 18（修之前 221.88）", calc);
    const none = save({ ...emptyForm, shadeOrders: [shadeLine({ valance: "None" })] }, DEFAULT_DISCOUNTS);
    ok(none.items[0]!.fabric === "Blackout (Open Roll)" && r2(none.calc.merchSubtotal) === 221.88, "SAVE-01c: 改成 None → Blackout (Open Roll) / 221.88");
    const fascia = save({ ...emptyForm, shadeOrders: [shadeLine({ valance: "Fascia" })] }, DEFAULT_DISCOUNTS);
    ok(fascia.items[0]!.fabric === "Blackout w Fascia" && r2(fascia.calc.merchSubtotal) === 271.88, "SAVE-01d: Fascia → Blackout w Fascia / 271.88");
    const viaForm = save({ ...emptyForm, shadeValanceType: "Cassette", shadeOrders: [shadeLine({ valance: "" }), shadeLine({ valance: "None" })] }, DEFAULT_DISCOUNTS);
    ok(viaForm.items[0]!.fabric === "Blackout w Cassette" && viaForm.items[1]!.fabric === "Blackout (Open Roll)" && r2(viaForm.calc.merchSubtotal) === 493.75, "SAVE-01e: 表底部 Cassette 只作用于行上留空的行（271.875 + 221.875 = 493.75）", viaForm.items);
    const fullKey = save({ ...emptyForm, shadeOrders: [shadeLine({ sku: "Blackout w Cassette", valance: "" })] }, DEFAULT_DISCOUNTS);
    ok(fullKey.items[0]!.fabric === "Blackout w Cassette" && r2(fullKey.calc.merchSubtotal) === 271.88, "SAVE-01f: SKU 本身是完整定价面料、无生效罩型 → 原样计价（与改动前相同）");
  }
  {
    const wood = save({ ...emptyForm, shutterMaterial: "Wooden", shutterOrders: [shutterLine({})] }, DEFAULT_DISCOUNTS);
    ok(wood.items.length === 1 && wood.items[0]!.product === "Shutters" && wood.items[0]!.fabric === "Wood" && wood.items[0]!.sku === "Wooden", "SAVE-02a: Wooden 提交 fabric = Wood，sku 仍是 Wooden", wood.items);
    ok(wood.calc.errors.length === 0 && r2(wood.calc.merchSubtotal) === 1172.22 && wood.calc.itemResults[0]!.install === 54, "SAVE-02b: Wooden 72×60 保存 1172.22 + 安装 54，无「is not set yet」报错（修之前报错）", wood.calc.errors);
    const vinyl = save({ ...emptyForm, shutterMaterial: "Vinyl", shutterOrders: [shutterLine({})] }, DEFAULT_DISCOUNTS);
    ok(vinyl.items[0]!.fabric === "Vinyl" && vinyl.items[0]!.sku === "Vinyl" && r2(vinyl.calc.merchSubtotal) === 701.29, "SAVE-02c: Vinyl 不变（701.29）");
    const two = save({ ...emptyForm, shutterMaterial: "Wooden", shutterOrders: [shutterLine({ panelCount: 2 })] }, DEFAULT_DISCOUNTS);
    ok(two.items.length === 2 && two.items.every((i) => i.fabric === "Wood") && r2(two.calc.merchSubtotal) === 2344.43, "SAVE-02d: Panel 数 2 → 两条 Wood 报价行（2344.43）");
  }

  // 预览 = 保存：逐行扫（缺省折扣 + 非缺省折扣各一轮）
  const sweep = (label: string, discounts: Discounts) => {
    const bad: unknown[] = [];
    let rows = 0;
    const cmp = (what: string, a: { merch: number; install: number }, b: { merch: number; install: number }) => {
      rows++;
      if (!near(a.merch, b.merch) || a.install !== b.install) bad.push({ what, preview: a, saved: b });
    };
    // Roller：两个真实 SKU × 行上 4 种 × 表底部 3 种 × 窗宽 49 / 50 / 55 × 有无无绳
    for (const sku of [SKU_BO, SKU_LF]) for (const valance of ROW_VALANCES) for (const fv of FORM_VALANCES)
      for (const w of ["49", "50", "55"]) for (const cordless of [false, true]) {
        const line = shadeLine({ sku, valance, widthWhole: w, cordless });
        const p = computeShadeLinePrice(line, "default", discounts, DEFAULT_SUNNY_MOTOR_PRICE, DEFAULT_CORDLESS_POLICY, fv)!;
        const { calc } = save({ ...emptyForm, shadeValanceType: fv, shadeOrders: [line] }, discounts);
        const r = calc.itemResults[0];
        if (p.error || !r) { bad.push({ sku, valance, fv, w, cordless, previewError: p.error, saveErrors: calc.errors }); rows++; continue; }
        cmp(`Roller ${sku} ${valance || "∅"}/${fv || "∅"} w${w} cordless=${cordless}`, p, { merch: r.price, install: r.install });
      }
    // 其它 Shades 产品（罩型照填，确认不影响）
    for (const [product, sku, w, h] of [["Zebra", "PRADO-WHITE-LF", "40", "50"], ["Zebra", "MILAN-GREY-BO", "90", "60"], ["SHANGRILA", "Standard", "60", "72"], ["Cordless Cellular", "Standard", "30", "48"], ["Fauxwood", "Standard", "36", "48"], ["Roman Shade", "BMF06-BO", "40", "60"]] as const) {
      const line = shadeLine({ product, sku, widthWhole: w, heightWhole: h, valance: "Cassette" });
      const p = computeShadeLinePrice(line, "default", discounts, DEFAULT_SUNNY_MOTOR_PRICE, DEFAULT_CORDLESS_POLICY, "Fascia")!;
      const { calc } = save({ ...emptyForm, shadeValanceType: "Fascia", shadeOrders: [line] }, discounts);
      const r = calc.itemResults[0];
      if (p.error || !r) { bad.push({ product, sku, previewError: p.error, saveErrors: calc.errors }); rows++; continue; }
      cmp(`${product} ${sku}`, p, { merch: r.price, install: r.install });
    }
    // Shutters：Wooden / Vinyl × Panel 数 1 / 2
    for (const material of ["Wooden", "Vinyl"] as const) for (const panelCount of [1, 2]) {
      const line = shutterLine({ panelCount });
      const p = computeShutterLinePrice(line, material, "default", discounts)!;
      const { calc } = save({ ...emptyForm, shutterMaterial: material, shutterOrders: [line] }, discounts);
      if (p.error || calc.errors.length) { bad.push({ material, panelCount, previewError: p.error, saveErrors: calc.errors }); rows++; continue; }
      cmp(`Shutters ${material} ×${panelCount}`, p, { merch: calc.merchSubtotal, install: calc.installSubtotal });
    }
    // Drapery / Sheer / Door Screen Sheer（后者只断言两边相等，不钉口径——判断点 1 未拍板）
    const drapes: DrapeOrderLine[] = [
      drapeLine({ drapeFabricSku: "With liner (Black out)", drapeLiner: true, drapeWidthWhole: "100", drapeHeightWhole: "108", drapeFullness: "180" }),
      drapeLine({ sheerFabricSku: "Light Filtering", sheerWidthWhole: "100", sheerHeightWhole: "108", sheerFullness: "230" }),
      drapeLine({ sheerFabricSku: "Door Screen Sheer", sheerWidthWhole: "25", sheerHeightWhole: "48" }),
      drapeLine({ sheerFabricSku: "Door Screen Sheer", sheerWidthWhole: "30", sheerHeightWhole: "48" }),
    ];
    for (const line of drapes) {
      const p = computeDrapeLinePrice(line, "default", discounts)!;
      const { calc } = save({ ...emptyForm, drapeOrders: [line] }, discounts);
      if (p.error || calc.errors.length) { bad.push({ line: line.drapeFabricSku || line.sheerFabricSku, previewError: p.error, saveErrors: calc.errors }); rows++; continue; }
      cmp(`Drapes ${line.drapeFabricSku || line.sheerFabricSku} w${line.drapeWidthWhole || line.sheerWidthWhole}`, { merch: p.drapeMerch + p.sheerMerch, install: p.drapeInstall + p.sheerInstall }, { merch: calc.merchSubtotal, install: calc.installSubtotal });
    }
    ok(bad.length === 0, `PARITY-${label}: ${rows} 行预览金额与安装费 = 保存金额与安装费（误差 ≤ 0.01）`, bad.slice(0, 5));
    return rows;
  };
  const n1 = sweep("01 缺省企业折扣", { ...DEFAULT_DISCOUNTS });
  const n2 = sweep("02 Roller 40% / Shutters 30%", { ...DEFAULT_DISCOUNTS, Roller: 0.4, Shutters: 0.3 });
  ok(n1 === 158 && n2 === 158, "PARITY-03: 每轮 158 行（Roller 144 + 其它 Shades 6 + Shutters 4 + Drapes 4）", [n1, n2]);

  // 非缺省折扣下的字面量：Roller 40% 带罩 55×72 = 403.41 × 0.6 + 50；Wood 30% 72×60 = 1803.41 × 0.7
  const custom = { ...DEFAULT_DISCOUNTS, Roller: 0.4, Shutters: 0.3 };
  const c1 = save({ ...emptyForm, shadeOrders: [shadeLine({ valance: "Cassette" })] }, custom);
  const c2 = save({ ...emptyForm, shutterMaterial: "Wooden", shutterOrders: [shutterLine({})] }, custom);
  ok(r2(c1.calc.merchSubtotal) === 292.05 && r2(c2.calc.merchSubtotal) === 1262.39, "PARITY-04: 企业折扣非缺省时仍按企业折扣（Roller 40% 带罩 292.05；Wood 30% 1262.39）", [c1.calc.merchSubtotal, c2.calc.merchSubtotal]);
}

// ── ⑥ 源码断言：取值只有一处 ───────────────────────────────
console.log("⑥ 源码断言");
{
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const dir = "src/app/(main)/sales/quote-sheet";
  const page = read(`${dir}/page.tsx`);
  const helpers = read(`${dir}/pricing-helpers.ts`);
  const pdf = read(`${dir}/quote-pdf.ts`);
  const orderItems = read(`${dir}/order-items.ts`);
  const mapping = read("src/lib/sunny-process/quote-mapping.ts");
  ok(![page, helpers, pdf, orderItems].some((s) => s.includes("skuToPricingFabric")), "SRC-01: 页面 / 预览 / PDF / 行构造不再直接由 SKU 推定价面料");
  ok(!page.includes("fabric: shutterMaterial") && !orderItems.includes("fabric: shutterMaterial") && !/priceFor\(\s*"Shutters",\s*material\b/.test(helpers), "SRC-02: 不再把表单材质直接当定价面料");
  ok(helpers.includes("shadeLinePricingFabric(") && helpers.includes("shutterPricingFabric(") && orderItems.includes("shadeLinePricingFabric(") && orderItems.includes("shutterPricingFabric("), "SRC-03: 预览与行构造都引用同一个取值");
  ok(page.includes("buildOrderFormItems(") && !/items\.push\(/.test(page), "SRC-04: 页面保存只经 buildOrderFormItems，不再内联构造报价行");
  // 页面 / 表格 / PDF 里每一处 Shades 计价调用都把表底部 Valance Type 传进去（漏传会静默按「表底部未选」计价）
  const callsOf = (src: string, fn: string) => {
    const out: string[] = [];
    let i = 0;
    while ((i = src.indexOf(`${fn}(`, i)) >= 0) {
      let depth = 0, j = i + fn.length;
      for (; j < src.length; j++) { if (src[j] === "(") depth++; else if (src[j] === ")" && --depth === 0) break; }
      out.push(src.slice(i, j + 1));
      i = j;
    }
    return out;
  };
  const orderShades = read(`${dir}/order-shades.tsx`);
  const shadeCalls = [
    ...callsOf(orderShades, "computeShadeLinePrice"),
    ...callsOf(pdf, "computeShadeLinePrice"),
    ...callsOf(page, "sumShadeTotals"),
    ...callsOf(page, "sumAllMsrp"),
  ];
  const missing = shadeCalls.filter((c) => !/(valanceType|shadeValanceType)\s*,?\s*\)$/.test(c));
  ok(shadeCalls.length === 5 && missing.length === 0, "SRC-05: 页面 2 处、Shades 表 1 处、PDF 2 处计价调用的最后一个实参都是表底部罩型", { count: shadeCalls.length, missing });
  ok(mapping.includes("effectiveShadeValance(") && !mapping.includes("s(l.valance) || formValance"), "SRC-06: 工艺单罩型取值调用同一个函数");
  ok(pdf.includes('effectiveShadeValance(l.valance, input.shadeValanceType) || "—"') && !/^\s*l\.valance \|\| "—",/m.test(pdf), "SRC-10: PDF 的 Valance 列显示生效罩型，不再只读行上的值");
  const shutters = read(`${dir}/order-shutters.tsx`);
  ok(!shutters.includes("set price manually in Part B") && !shutters.includes("pricing data is not available"), "SRC-07: Shutters 表不再有「去 Part B 手填」横幅");
  ok(page.includes("orderPricingRev: ORDER_PRICING_REV") && page.includes("orderPricingRev: loadedPricingRev") && page.includes("readOrderPricingRev(d.orderPricingRev)"), "SRC-08: 保存写当前口径标记、草稿带载入时的标记、载入时读标记");
  ok(page.includes("needsWoodRepriceNotice(") && page.includes("woodRepriceNoticeText(") && page.includes("知道了"), "SRC-09: 页面按判定渲染提醒，带「知道了」");
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

  // 提醒文案：含本单百叶窗金额与「Part B」
  const wooden = computeShutterLinePrice(shutterLine({}), "Wooden", "default", DEFAULT_DISCOUNTS)!;
  const text = woodRepriceNoticeText(formatCAD(wooden.merch));
  ok(text.includes("$1,172.22") && text.includes("Part B") && text.includes("自动计价") && text.includes("重复计价"), "REV-08: 提醒文案含 $1,172.22、Part B、自动计价、避免重复计价", text);

  // 表单数据往返：保存写出的 formDataJson 带标记 2；旧表单（无字段）读成 1
  ok(readOrderPricingRev(JSON.parse(JSON.stringify({ orderPricingRev: ORDER_PRICING_REV })).orderPricingRev) === 2
    && readOrderPricingRev(JSON.parse(JSON.stringify({ shutterMaterial: "Wooden" })).orderPricingRev) === 1, "REV-09: formDataJson 往返——有标记读 2，旧表单读 1");

  // 本地草稿往返：草稿原样带着载入时的标记（真实的 saveDraft / loadDraft + 内存版 localStorage）
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  const draftBody = (rev?: number): Omit<QuoteDraftV1, "v" | "savedAt"> => ({
    customerId: "c1", customerName: "Test", customerPhone: "", customerEmail: "", customerAddress: "", heardUsOn: "", opportunityId: "",
    date: "2026-11-15", salesRep: "LJ", measureSequence: 1, partALines: [], partBAddons: [], partBNotes: "",
    paymentMethod: "direct" as QuoteDraftV1["paymentMethod"], depositAmount: "", balanceAmount: "", financeEligible: "", financeApproved: "", financeDifference: "",
    partCServices: [], partCAddOns: [], shadeOrders: [], shutterOrders: [shutterLine({})], drapeOrders: [],
    shutterMaterial: "Wooden", shutterLouverSize: "", shadeValanceType: "Cassette", shadeBracketType: "", installMode: "default",
    ...(rev === undefined ? {} : { orderPricingRev: rev }),
  });
  saveDraft(draftBody(1), "org1", "u1");
  const d1 = loadDraft("org1", "u1");
  saveDraft(draftBody(ORDER_PRICING_REV), "org1", "u1");
  const d2 = loadDraft("org1", "u1");
  saveDraft(draftBody(), "org1", "u1");
  const d0 = loadDraft("org1", "u1");
  ok(!!d1 && readOrderPricingRev(d1.orderPricingRev) === 1 && !!d2 && readOrderPricingRev(d2.orderPricingRev) === 2 && !!d0 && readOrderPricingRev(d0.orderPricingRev) === 1,
    "REV-10: 本地草稿往返——带 1 读 1、带 2 读 2、改动前的旧草稿（无字段）读 1", [d1?.orderPricingRev, d2?.orderPricingRev, d0?.orderPricingRev]);
  delete (globalThis as unknown as { window?: unknown }).window;
}

// ── ⑦ 行上定价面料（QUOTE-1b）──────────────────────────────
console.log("⑦ 行上定价面料");
{
  const emptyForm = { shadeOrders: [], shutterOrders: [], drapeOrders: [], shutterMaterial: "Vinyl" as const, shadeValanceType: "" };
  const priceOf = (l: ShadeOrderLine, fv = "") => {
    const p = computeShadeLinePrice(l, "default", DEFAULT_DISCOUNTS, DEFAULT_SUNNY_MOTOR_PRICE, DEFAULT_CORDLESS_POLICY, fv);
    if (!p || p.error) throw new Error(`预览报错：${p?.error ?? "null"}`);
    return r2(p.merch);
  };
  const savedOf = (l: ShadeOrderLine, fv = "") => {
    const items = buildOrderFormItems({ ...emptyForm, shadeValanceType: fv, shadeOrders: [l] });
    const calc = calculateQuoteTotal({ items: applyOrgDiscountDefaults(items, DEFAULT_DISCOUNTS), installMode: "default", cordlessPolicy: DEFAULT_CORDLESS_POLICY });
    return { fabric: items[0]!.fabric, sku: items[0]!.sku, merch: r2(calc.merchSubtotal), override: items[0]!.discountOverridePct };
  };
  const bo = priceFor("Zebra", "Blackout", 48, 60, DEFAULT_DISCOUNTS.Zebra);
  const lf = priceFor("Zebra", "Light Filtering", 48, 60, DEFAULT_DISCOUNTS.Zebra);
  if ("error" in bo || "error" in lf) throw new Error("引擎报错");
  const ssb = shadeLine({ product: "Zebra", sku: "SSB01", widthWhole: "48", heightWhole: "60", pricingFabric: "Blackout" });
  ok(shadeLinePricingFabric(ssb, "") === "Blackout" && priceOf(ssb) === r2(bo.price) && savedOf(ssb).fabric === "Blackout" && savedOf(ssb).sku === "SSB01" && savedOf(ssb).merch === r2(bo.price),
    "PF-01: Zebra SSB01 + 定价面料 Blackout → 预览与保存都按 Blackout 表，SKU 仍是 SSB01", [priceOf(ssb), savedOf(ssb)]);
  const ssbNo = shadeLine({ product: "Zebra", sku: "SSB01", widthWhole: "48", heightWhole: "60" });
  ok(savedOf(ssbNo).fabric === "Light Filtering" && priceOf(ssbNo) === r2(lf.price) && r2(bo.price) !== r2(lf.price), "PF-02: 去掉定价面料 → 按 SKU 推断为 Light Filtering（两档金额不同）", [r2(bo.price), r2(lf.price)]);

  const roller = (valance: string) => shadeLine({ sku: SKU_BO, pricingFabric: "Blackout w Cassette", valance });
  ok(priceOf(roller("Cassette")) === 271.88 && savedOf(roller("Cassette")).fabric === "Blackout w Cassette", "PF-03a: Roller 定价面料 Blackout w Cassette + 行上 Cassette → 271.88");
  ok(priceOf(roller("None")) === 221.88 && savedOf(roller("None")).fabric === "Blackout (Open Roll)", "PF-03b: 行上改 None → 221.88（Roller 仍随罩型）");
  ok(priceOf(roller("Fascia")) === 271.88 && savedOf(roller("Fascia")).fabric === "Blackout w Fascia", "PF-03c: 行上改 Fascia → Blackout w Fascia");
  ok(savedOf(roller("")).fabric === "Blackout w Cassette" && savedOf(roller(""), "Cassette").fabric === "Blackout w Cassette", "PF-03d: 无生效罩型时定价面料原样；表底部 Cassette 时同为带罩");

  const bad = shadeLine({ product: "Zebra", sku: "PRADO-WHITE-LF", widthWhole: "40", heightWhole: "50", pricingFabric: "Blackout w Cassette" });
  ok(shadeLinePricingFabric(bad, "") === "Light Filtering", "PF-04: 定价面料不是该产品的面料档 → 忽略，按 SKU 推断");
  ok(shadeLinePricingFabric(shadeLine({ product: "Zebra", sku: "PRADO-WHITE-LF", pricingFabric: "  " }), "") === "Light Filtering", "PF-04b: 空白的定价面料等于没有");

  const changed = applyShadeSkuChange(ssb, "MILAN-GREY-BO");
  ok(changed.sku === "MILAN-GREY-BO" && changed.pricingFabric === undefined && changed.widthWhole === "48", "PF-05a: 手动换 SKU → 定价面料清除，其它字段不动");
  const toRoller = applyShadeProductChange({ ...ssb, cordless: true }, "Roller");
  const toShangri = applyShadeProductChange({ ...ssb, cordless: true }, "SHANGRILA");
  ok(toRoller.product === "Roller" && toRoller.sku === "" && toRoller.pricingFabric === undefined && toRoller.cordless === true && toShangri.cordless === false,
    "PF-05b: 手动换产品 → SKU 与定价面料清空；无绳只对 Zebra / Roller 保留");
}

// ── ⑧ 行级折扣（QUOTE-1b）──────────────────────────────────
console.log("⑧ 行级折扣");
{
  const emptyForm = { shadeOrders: [], shutterOrders: [], drapeOrders: [], shutterMaterial: "Vinyl" as const, shadeValanceType: "" };
  const drapeLine = (o: Partial<DrapeOrderLine>): DrapeOrderLine => ({
    id: "d", location: "Dining",
    drapeWidthWhole: "", drapeWidthFrac: "0", drapeHeightWhole: "", drapeHeightFrac: "0", drapeFabricSku: "",
    drapeFullness: "180", drapePanels: "S", drapePleatStyle: "", drapeLiner: false, drapeBracket: "",
    sheerWidthWhole: "", sheerWidthFrac: "0", sheerHeightWhole: "", sheerHeightFrac: "0", sheerFabricSku: "",
    sheerFullness: "180", sheerPanels: "S", sheerPleatStyle: "", sheerBracket: "", accessoriesSku: "", note: "", ...o,
  });
  ok(lineDiscountOverride(0.15) === 0.15 && lineDiscountOverride(0) === 0 && lineDiscountOverride(1) === 1, "LD-01a: 0–1 的有限数是合法的行级折扣");
  ok([1.5, -0.1, NaN, Infinity, "0.15", null, undefined].every((v) => lineDiscountOverride(v) === null), "LD-01b: 越界 / 非数字 / 缺失 → 无行级折扣");
  ok(lineDiscountLabel(0.15) === "15% off · 导入" && lineDiscountLabel(0.125) === "12.5% off · 导入", "LD-01c: 显示文字", [lineDiscountLabel(0.15), lineDiscountLabel(0.125)]);

  const zebra = (o: Partial<ShadeOrderLine>) => shadeLine({ product: "Zebra", sku: "PRADO-WHITE-LF", widthWhole: "40", heightWhole: "50", ...o });
  const preview = (l: ShadeOrderLine, discounts = DEFAULT_DISCOUNTS) => computeShadeLinePrice(l, "default", discounts, DEFAULT_SUNNY_MOTOR_PRICE, DEFAULT_CORDLESS_POLICY, "")!;
  const save = (form: Parameters<typeof buildOrderFormItems>[0], discounts = DEFAULT_DISCOUNTS) => {
    const items = buildOrderFormItems(form);
    return { items, calc: calculateQuoteTotal({ items: applyOrgDiscountDefaults(items, discounts), installMode: "default", cordlessPolicy: DEFAULT_CORDLESS_POLICY }) };
  };
  const s15 = save({ ...emptyForm, shadeOrders: [zebra({ lineDiscountPct: 0.15 })] });
  ok(r2(preview(zebra({ lineDiscountPct: 0.15 })).merch) === 234.72 && s15.items[0]!.discountOverridePct === 0.15 && r2(s15.calc.merchSubtotal) === 234.72 && s15.calc.itemResults[0]!.discountPct === 0.15,
    "LD-02a: Zebra 40×50 行级折扣 15% → 预览与保存都是 234.72，随行提交 discountOverridePct = 0.15", [preview(zebra({ lineDiscountPct: 0.15 })).merch, s15.calc.merchSubtotal]);
  const s0 = save({ ...emptyForm, shadeOrders: [zebra({})] });
  ok(r2(preview(zebra({})).merch) === 151.88 && s0.items[0]!.discountOverridePct === undefined && r2(s0.calc.merchSubtotal) === 151.88, "LD-02b: 清除后回到企业默认 45% → 151.88，不再随行提交折扣");
  ok(save({ ...emptyForm, shadeOrders: [zebra({ lineDiscountPct: 1.5 })] }).items[0]!.discountOverridePct === undefined && r2(preview(zebra({ lineDiscountPct: 1.5 })).merch) === 151.88, "LD-02c: 非法的行级折扣被忽略（预览与保存一致）");

  // 无绳行：行级覆盖优先于无绳折扣
  const cl = zebra({ cordless: true, lineDiscountPct: 0.2, widthWhole: "90", heightWhole: "60", sku: "MILAN-GREY-BO" });
  const ref = priceFor("Zebra", "Blackout", 90, 60, 0.2, true, DEFAULT_CORDLESS_POLICY);
  const refPolicy = priceFor("Zebra", "Blackout", 90, 60, null, true, DEFAULT_CORDLESS_POLICY);
  const sCl = save({ ...emptyForm, shadeOrders: [cl] });
  ok(!("error" in ref) && !("error" in refPolicy) && near(preview(cl).merch, ref.price) && near(sCl.calc.merchSubtotal, ref.price) && !near(ref.price, refPolicy.price),
    "LD-03: 无绳行带行级折扣 20% → 按 20% 计价，不套企业无绳折扣；预览 = 保存", [preview(cl).merch, sCl.calc.merchSubtotal]);

  // 布帘 / 纱帘：预览 = 保存（缺省与非缺省企业折扣）
  const drape = drapeLine({ drapeFabricSku: "With liner (Black out)", drapeLiner: true, drapeWidthWhole: "100", drapeHeightWhole: "108", drapeLineDiscountPct: 0.2 });
  const sheer = drapeLine({ sheerFabricSku: "Light Filtering", sheerWidthWhole: "100", sheerHeightWhole: "108", sheerFullness: "230", sheerLineDiscountPct: 0.1 });
  const both = drapeLine({ drapeFabricSku: "Without liner", drapeWidthWhole: "60", drapeHeightWhole: "96", drapeLineDiscountPct: 0.25, sheerFabricSku: "Light Filtering", sheerWidthWhole: "60", sheerHeightWhole: "96", sheerLineDiscountPct: 0.3 });
  const bad: unknown[] = [];
  for (const discounts of [{ ...DEFAULT_DISCOUNTS }, { ...DEFAULT_DISCOUNTS, Drapery: 0.4, Sheer: 0.3, Zebra: 0.4 }]) {
    for (const l of [drape, sheer, both]) {
      const p = computeDrapeLinePrice(l, "default", discounts)!;
      const s = save({ ...emptyForm, drapeOrders: [l] }, discounts);
      if (p.error || s.calc.errors.length || !near(p.drapeMerch + p.sheerMerch, s.calc.merchSubtotal)) bad.push({ p, saved: s.calc.merchSubtotal });
    }
    const z = zebra({ lineDiscountPct: 0.15 });
    if (!near(preview(z, discounts).merch, save({ ...emptyForm, shadeOrders: [z] }, discounts).calc.merchSubtotal)) bad.push({ zebra: true });
  }
  ok(bad.length === 0, "LD-04: 带行级折扣的 Shades / 布帘 / 纱帘行，预览 = 保存（缺省与非缺省企业折扣各一轮）", bad);
  const dSaved = save({ ...emptyForm, drapeOrders: [both] });
  ok(dSaved.items.length === 2 && dSaved.items[0]!.discountOverridePct === 0.25 && dSaved.items[1]!.discountOverridePct === 0.3, "LD-05: 布帘与纱帘各带各的行级折扣", dSaved.items.map((i) => i.discountOverridePct));
  const d20 = priceFor("Drapery", "With liner (Black out)", 100, 108, 0.2, false, undefined, 1.8);
  ok(!("error" in d20) && near(computeDrapeLinePrice(drape, "default", DEFAULT_DISCOUNTS)!.drapeMerch, d20.price), "LD-06: 布帘行级折扣 20% 代替企业默认 35%");

  // MSRP 合计不看行级折扣
  const m0 = sumAllMsrp([zebra({})], [], "Vinyl", [drapeLine({ drapeFabricSku: "Without liner", drapeWidthWhole: "60", drapeHeightWhole: "96" })]);
  const m1 = sumAllMsrp([zebra({ lineDiscountPct: 0.15 })], [], "Vinyl", [drapeLine({ drapeFabricSku: "Without liner", drapeWidthWhole: "60", drapeHeightWhole: "96", drapeLineDiscountPct: 0.25 })]);
  ok(near(m0, m1) && m0 > 0, "LD-07: MSRP 合计不随行级折扣变", [m0, m1]);
}

// ── ⑨ SKU 下拉选项（QUOTE-1b）──────────────────────────────
console.log("⑨ SKU 下拉显示目录外的当前值");
{
  const entries: SkuEntry[] = [
    { sku: "CABO-WHITE-BO", product: "Roller", thumbUrl: "", readable: "Cabo · White · Blackout" },
    { sku: "ADORO-CREAMY-LF", product: "Roller", thumbUrl: "", readable: "Adoro · Creamy · Light Filtering" },
  ];
  const inCat = skuSelectOptions(entries, "CABO-WHITE-BO");
  ok(inCat.length === 2 && !inCat.some((o) => o.outOfCatalog) && inCat[0]!.label === "CABO-WHITE-BO · Cabo · White · Blackout", "SKU-01: 目录内的当前值 → 没有「目录外」选项，标签不变", inCat);
  ok(skuSelectOptions(entries, "").length === 2 && skuSelectOptions(entries, "  ").every((o) => !o.outOfCatalog), "SKU-02: 当前值为空 → 与之前相同");
  const fallback: SkuEntry[] = [{ sku: "Standard", product: "Cordless Cellular", thumbUrl: "", readable: "Standard", isCategoryFallback: true }];
  const out = skuSelectOptions(fallback, "B01-38-BO100");
  ok(out.length === 2 && out[0]!.outOfCatalog === true && out[0]!.value === "B01-38-BO100" && out[0]!.label.includes("B01-38-BO100") && out[0]!.label.includes("目录外") && out[1]!.label === "Standard (type only)",
    "SKU-03: 目录外的当前值 → 最前面多一项，文字含该 SKU 与「目录外」", out);
  const csv = readFileSync(join(process.cwd(), "public/sku-catalog.csv"), "utf8");
  ok(csv.includes(",CABO-WHITE-BO,") && !csv.includes("B01-38-BO100"), "SKU-04: 目录文件里有 CABO-WHITE-BO、没有 B01-38-BO100（与上面两例的前提一致）");
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const dir = "src/app/(main)/sales/quote-sheet";
  const skuSelect = read(`${dir}/sku-select.tsx`);
  const orderShades = read(`${dir}/order-shades.tsx`);
  const orderDrapes = read(`${dir}/order-drapes.tsx`);
  ok(skuSelect.includes("skuSelectOptions(entries, value)"), "SRC-11: SKU 下拉的选项由 skuSelectOptions 给出");
  ok(orderShades.includes("applyShadeSkuChange(") && orderShades.includes("applyShadeProductChange(") && !orderShades.includes('updateLine(line.id, "sku"'), "SRC-12: Shades 表换 SKU / 产品都经清除定价面料的函数");
  ok(orderShades.includes("lineDiscountLabel(") && orderShades.includes('"lineDiscountPct", undefined') && orderDrapes.includes("lineDiscountLabel(") && !/type="number"[^>]*lineDiscount/.test(orderShades + orderDrapes),
    "SRC-13: 表单显示行级折扣并可清除，不提供录入框");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
