/**
 * 报价文件 → 详细订单表单数据（QUOTE-1b，openspec change quote-import-studio-file，design D6–D9）——纯逻辑，无 DB
 * 运行：npx tsx src/lib/sales/quote-import/__tests__/map.test.ts
 *
 * 规格里映射相关的每个场景至少一例；末尾是源码断言（导入模块与核对窗无网络调用、产出不含照片与面料资料键）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import { DEFAULT_DISCOUNTS } from "@/lib/blinds/pricing-data";
import { applyOrgDiscountDefaults } from "@/lib/blinds/discount-settings";
import { buildOrderFormItems } from "@/app/(main)/sales/quote-sheet/order-items";
import {
  applyFullnessChoices,
  buildFormFill,
  buildImportSource,
  fullnessTierOf,
  mapQuoteToForm,
  matchCustomer,
  pendingFullnessRows,
  toSixteenths,
  type MappedQuote,
} from "@/lib/sales/quote-import/map";
import { MULTI, SAMPLE, SINGLE, ctx, edit, makeChecker, onlyRows, parsed, run } from "./helpers";

const { ok, done } = makeChecker();

const mapText = (text: string, over: Parameters<typeof ctx>[0] = {}, planId?: string) => {
  const file = parsed(text);
  const plan = planId === undefined ? file.plans[0] : file.plans.find((p) => p.planId === planId)!;
  return { file, plan, mapped: mapQuoteToForm(file, plan, ctx(over)) };
};
const blocks = (m: MappedQuote) => m.hints.filter((h) => h.level === "block");
const warns = (m: MappedQuote, code?: string) => m.hints.filter((h) => h.level === "warn" && (!code || h.code === code));
/** 一组表单行按保存时的同一条路径算出逐行成交价 */
const prices = (m: MappedQuote, shadeValanceType = "") => {
  const items = buildOrderFormItems({ shadeOrders: m.shadeOrders, shutterOrders: m.shutterOrders, drapeOrders: m.drapeOrders, shutterMaterial: m.shutterMaterial ?? "Vinyl", shadeValanceType });
  const calc = calculateQuoteTotal({ items: applyOrgDiscountDefaults(items, DEFAULT_DISCOUNTS), installMode: m.installMode });
  return { items, calc, each: calc.itemResults.map((r) => Math.round(r.price * 100) / 100) };
};

console.log("16 行样例");
{
  const { mapped: m } = mapText(SAMPLE);
  ok(m.shadeOrders.length === 13 && m.shutterOrders.length === 1 && m.drapeOrders.length === 3, "MAP-01: 17 条表单行：Shades 13、Shutters 1、Drapes 3", [m.shadeOrders.length, m.shutterOrders.length, m.drapeOrders.length]);
  ok(m.shadeOrders[0].location === "R1" && m.shadeOrders[1].location === "R1 (2)" && m.rows[0].lineIds.length === 2 && m.shadeOrders[2].location === "R2", "MAP-02: 第 1 行（数量 2）拆成两条，房间名第二条带序号");
  const s0 = m.shadeOrders[0];
  ok(s0.widthWhole === "48" && s0.widthFrac === "8" && s0.heightWhole === "60" && s0.heightFrac === "0" && s0.product === "Zebra" && s0.sku === "LOUIA-WHITE-BL201-LF" && s0.pricingFabric === "Light Filtering", "MAP-03: 宽高换成整数 + 1/16\"；SKU 取文件值；面料档写入行上的定价面料", s0);
  ok(m.shadeOrders.every((l) => l.mount === "" && l.lift === "" && l.bracket === ""), "MAP-04: Shades 行的 Mount、Lift、Bracket 为空（工艺参数不臆造）");
  ok(m.shutterOrders[0].frame === "" && m.shutterOrders[0].openDirection === "" && m.shutterOrders[0].mountType === "" && m.shutterOrders[0].midRail === "" && m.shutterOrders[0].panelCount === 1, "MAP-05: Shutters 行 Panel 数为 1，其余工艺参数为空");
  ok(m.drapeOrders.every((l) => l.drapePleatStyle === "" && l.sheerPleatStyle === "" && l.drapeBracket === "" && l.sheerBracket === "" && l.drapePanels === "S" && l.sheerPanels === "S" && l.accessoriesSku === ""), "MAP-06: Drapes 行的褶型、Bracket 为空，Panels 保持表单默认值");
  ok(m.rows.length === 16 && m.rows.every((r) => !r.blocked) && blocks(m).length === 0, "MAP-07: 16 个文件行都有对应的映射结果，无阻断");
  ok(m.rows.map((r) => r.table).join(",") === "shade,shade,shade,shade,shade,shade,shade,shade,shade,shade,shutter,drape,drape,drape,shade,shade", "MAP-08: 三张表的归属（Shutters → Shutters 表；Drapery / Sheer / Door Screen Sheer → Drapes 表；其余 → Shades 表）");
  const [d12, d13, d14] = m.drapeOrders;
  ok(d12.drapeFabricSku === "With liner (Black out)" && d12.drapeWidthWhole === "100" && d12.drapeHeightWhole === "108" && d12.drapeLiner === true && d12.sheerFabricSku === "" && d12.sheerWidthWhole === "", "MAP-09: Drapery 填 Drapes 行的布帘一侧，纱帘一侧为空", d12);
  ok(d13.sheerFabricSku === "Light Filtering" && d13.sheerWidthWhole === "100" && d13.sheerFullness === "230" && d13.drapeWidthWhole === "" && d14.sheerFabricSku === "Door Screen Sheer" && d14.sheerWidthWhole === "30" && d14.sheerHeightWhole === "48", "MAP-10: Sheer 与 Door Screen Sheer 各填一条 Drapes 行的纱帘一侧");
  ok(m.shutterMaterial === "Vinyl", "MAP-11: 样例的百叶窗材质 Vinyl");
  ok(m.installMode === "default" && m.taxRate === 0.13 && m.partBNotes === "" && m.customer.name === "Test", "MAP-12: 安装方式默认、税率取文件值、客户名带入");
  ok(prices(m).calc.errors.length === 0 && prices(m).each.length === 17, "MAP-13: 17 条表单行经保存时的行构造全部能计价");
}

console.log("\n尺寸");
{
  const r = toSixteenths(48.53);
  ok(r.whole === "48" && r.frac === "8" && r.rounded === true && toSixteenths(46.625).frac === "10" && !toSixteenths(46.625).rounded && toSixteenths(47.99).whole === "48" && toSixteenths(47.99).frac === "0", "MAP-20: 取整到最近的 1/16\"（48.53 → 48 8/16；47.99 → 48）", r);
  const { mapped: m } = mapText(onlyRows([{ from: 1, w: 48.53, qty: 1 }]));
  const w = warns(m, "size_rounded");
  ok(m.shadeOrders[0].widthWhole === "48" && m.shadeOrders[0].widthFrac === "8" && w.length === 1 && w[0].messageZh.includes("48.53") && w[0].messageZh.includes("48 8/16") && w[0].rowIndex === 1, "MAP-21: 宽 48.53\" 填入 48 又 8/16\"，提醒写明原值与取整后的值", w);
  ok(warns(mapText(SAMPLE).mapped, "size_rounded").length === 0, "MAP-22: 本来就在 1/16\" 格上的尺寸不提醒");
  const big = mapText(onlyRows([{ from: 1, w: 200, qty: 1 }])).mapped;
  ok(blocks(big).length === 1 && blocks(big)[0].code === "out_of_range" && blocks(big)[0].messageZh.includes("最大宽 108") && big.rows[0].blocked && big.shadeOrders.length === 0, "MAP-23: Zebra 宽 200\" 列为阻断，不产生表单行", blocks(big));
  const tall = mapText(onlyRows([{ from: 14, w: 45 }])).mapped;
  ok(blocks(tall).some((h) => h.code === "out_of_range" && h.messageZh.includes("Door Screen Sheer")), "MAP-24: Door Screen Sheer 宽超过 40\" 阻断", blocks(tall));
  const drapeHuge = mapText(onlyRows([{ from: 12, w: 400 }])).mapped;
  const drapeEdge = mapText(onlyRows([{ from: 12, w: 180 }])).mapped;
  ok(blocks(drapeHuge).some((h) => h.code === "out_of_range") && blocks(drapeEdge).length === 0 && drapeEdge.rows[0].needsFullnessChoice, "MAP-25: 待选褶皱率的布帘：两档都超出价表才在映射时阻断；只超一档的留给核对窗", [blocks(drapeHuge).length, blocks(drapeEdge).length]);
}

console.log("\n数量与非法值");
{
  for (const [qty, label] of [[0, "0"], [2.5, "2.5"], [1000, "1000"], [-1, "-1"]] as const) {
    const m = mapText(onlyRows([{ from: 1, qty }])).mapped;
    ok(blocks(m).length === 1 && blocks(m)[0].code === "bad_qty" && m.shadeOrders.length === 0, `MAP-30: 数量 ${label} → 阻断`, blocks(m));
  }
  const zeroW = mapText(onlyRows([{ from: 1, w: 0 }])).mapped;
  const negH = mapText(onlyRows([{ from: 1, h: -5 }])).mapped;
  ok(blocks(zeroW)[0]?.code === "bad_size" && blocks(negH)[0]?.code === "bad_size", "MAP-31: 宽为 0、高为负 → 阻断");
  const many = mapText(onlyRows([{ from: 1, qty: 400 }, { from: 2, qty: 200 }])).mapped;
  ok(blocks(many).some((h) => h.code === "too_many_rows" && h.messageZh.includes("拆行后共 600 行，超过 500 行")) && many.shadeOrders.length === 0, "MAP-32: 数量 400 + 200 → 阻断，写明「拆行后共 600 行，超过 500 行」", blocks(many));
  const fine = mapText(onlyRows([{ from: 1, qty: 300 }, { from: 2, qty: 200 }])).mapped;
  ok(blocks(fine).length === 0 && fine.shadeOrders.length === 500 && fine.shadeOrders[299].location === "R1 (300)", "MAP-33: 拆行后恰好 500 行可以导入", fine.shadeOrders.length);
  const str = mapText(onlyRows([{ from: 1, w: "48.5", offer: "abc" }])).mapped;
  ok(blocks(str).length === 1 && blocks(str)[0].code === "bad_value" && blocks(str)[0].messageZh.includes("宽") && blocks(str)[0].messageZh.includes("成交价"), "MAP-34: 填了但不是数字的宽、成交价 → 阻断并点名字段（不静默丢）", blocks(str));
  const disc = mapText(onlyRows([{ from: 1, discountOverridePct: 1.5 }])).mapped;
  const offer = mapText(onlyRows([{ from: 1, offer: -10 }])).mapped;
  ok(blocks(disc)[0]?.code === "bad_discount" && blocks(offer)[0]?.code === "bad_offer", "MAP-35: 折扣超出 0–100%、成交价为负 → 阻断");
  const fab = mapText(onlyRows([{ from: 1, fabric: "Dimout" }])).mapped;
  ok(blocks(fab)[0]?.code === "unknown_fabric" && blocks(fab)[0].messageZh.includes("Dimout"), "MAP-36: 青砚价表里没有的配置 → 阻断", blocks(fab));
  const three = mapText(onlyRows([{ from: 5, qty: 3, room: "Living" }, { from: 5, qty: 1, room: "" }, { from: 5, qty: 2, room: "" }])).mapped;
  ok(three.shadeOrders.map((l) => l.location).join("|") === "Living|Living (2)|Living (3)|||(2)", "MAP-37: 数量 3 → 三条，序号从第 2 条起；房间名为空时只有序号", three.shadeOrders.map((l) => l.location));
}

console.log("\nShades：SKU、面料档、罩型、无绳");
{
  const ssb = mapText(onlyRows([{ from: 1, qty: 1, sku: "SSB01", fabric: "Blackout" }]), { isSkuInCatalog: () => false }).mapped;
  const item = prices(ssb).items[0];
  ok(ssb.shadeOrders[0].sku === "SSB01" && ssb.shadeOrders[0].pricingFabric === "Blackout" && item.fabric === "Blackout" && item.sku === "SSB01", "MAP-40: 无后缀的遮光 SKU：SKU SSB01、定价面料 Blackout，行构造按 Blackout 表取价", item);
  ok(warns(ssb, "sku_not_in_catalog").length === 1 && warns(ssb, "sku_not_in_catalog")[0].messageZh.includes("SSB01") && blocks(ssb).length === 0, "MAP-41: SKU 不在目录 → 一条提醒，不阻断");
  const inCat = mapText(onlyRows([{ from: 1, qty: 1 }]), { isSkuInCatalog: () => true }).mapped;
  ok(warns(inCat, "sku_not_in_catalog").length === 0, "MAP-42: SKU 在目录里 → 不提醒");
  const noSku = mapText(onlyRows([{ from: 5 }])).mapped;
  ok(noSku.shadeOrders[0].sku === "Standard" && noSku.shadeOrders[0].pricingFabric === "Standard" && warns(noSku, "sku_missing").length === 1, "MAP-43: 文件没填 SKU → 取面料档名称代填并提醒");

  const roller = mapText(onlyRows([{ from: 3 }])).mapped;
  ok(roller.shadeOrders[0].valance === "Cassette" && roller.shadeOrders[0].sku === "CABO-WHITE-BO" && prices(roller).items[0].fabric === "Blackout w Cassette" && prices(roller).each[0] === 271.88, "MAP-44: Roller `Blackout w Cassette` 55×72：Valance = Cassette，青砚金额 271.88", prices(roller).each);
  const none: MappedQuote = { ...roller, shadeOrders: roller.shadeOrders.map((l) => ({ ...l, valance: "None" })) };
  ok(prices(none).items[0].fabric === "Blackout (Open Roll)" && prices(none).each[0] === 221.88, "MAP-45: 在表单里把 Valance 改为 None 后为 221.88", prices(none).each);
  const open = mapText(onlyRows([{ from: 16, offer: null }])).mapped;
  ok(open.shadeOrders[0].valance === "None" && prices(open, "Cassette").items[0].fabric === "Blackout (Open Roll)", "MAP-46: `(Open Roll)` 明确填 None——表底部的 Valance Type 选了 Cassette 也不加价");
  const fascia = mapText(onlyRows([{ from: 3, fabric: "Blackout w Fascia" }])).mapped;
  ok(fascia.shadeOrders[0].valance === "Fascia" && prices(fascia).items[0].fabric === "Blackout w Fascia", "MAP-47: `… w Fascia` 填 Fascia");
  const zebra = mapText(onlyRows([{ from: 1 }])).mapped;
  ok(zebra.shadeOrders[0].valance === "", "MAP-48: 非 Roller 的 Shades 行不填 Valance（工具不记录）");

  const cz = mapText(onlyRows([{ from: 2 }, { from: 4 }])).mapped;
  ok(cz.shadeOrders[0].cordless === true && cz.shadeOrders[1].cordless === true && prices(cz).each.join() === "513.19,161", "MAP-49: Zebra / Roller 的无绳标记填入 Cordless（513.19 / 161.00）", prices(cz).each);
  const sh = mapText(onlyRows([{ from: 5, cordless: true }])).mapped;
  ok(sh.shadeOrders[0].cordless === false && warns(sh, "cordless_ignored").length === 1 && prices(sh).each[0] === 512.61, "MAP-50: SHANGRILA 带无绳标记 → Cordless 为关，并提醒", sh.shadeOrders[0].cordless);
}

console.log("\nShutters 材质");
{
  const wood = mapText(onlyRows([{ from: 11, fabric: "Wood" }])).mapped;
  ok(wood.shutterMaterial === "Wooden" && prices(wood).items[0].fabric === "Wood" && prices(wood).items[0].sku === "Wooden" && prices(wood).each[0] === 1172.22, "MAP-55: `Wood` 72×60 → 表单材质 Wooden，青砚金额 1172.22", prices(wood).each);
  const vinyl = mapText(onlyRows([{ from: 11 }])).mapped;
  ok(vinyl.shutterMaterial === "Vinyl" && prices(vinyl).each[0] === 701.29, "MAP-56: `Vinyl` → Vinyl，701.29");
  const mixed = mapText(onlyRows([{ from: 11 }, { from: 11, fabric: "Wood" }, { from: 1 }])).mapped;
  ok(blocks(mixed).length === 1 && blocks(mixed)[0].code === "shutter_mixed" && blocks(mixed)[0].messageZh.includes("拆成两份") && mixed.shutterOrders.length === 0 && mixed.shutterMaterial === null && mixed.rows[0].blocked && mixed.rows[1].blocked && !mixed.rows[2].blocked, "MAP-57: 同一套方案里 Vinyl + Wood → 阻断，提示拆成两份导入", blocks(mixed));
  const qty = mapText(onlyRows([{ from: 11, qty: 3, room: "Bay" }])).mapped;
  ok(qty.shutterOrders.length === 3 && qty.shutterOrders.every((l) => l.panelCount === 1) && qty.shutterOrders[2].location === "Bay (3)" && prices(qty).each.length === 3, "MAP-58: 百叶窗数量 3 → 3 条、每条 Panel 数 1");
  ok(mapText(onlyRows([{ from: 1 }])).mapped.shutterMaterial === null, "MAP-59: 没有百叶窗行 → 不改表单的材质");
}

console.log("\n褶皱率落档");
{
  ok(fullnessTierOf(1.8) === "180" && fullnessTierOf(2.3) === "230" && fullnessTierOf(2) === null && fullnessTierOf(1.80000000001) === "180" && fullnessTierOf(2.29) === null, "MAP-60: 1.8 → 180、2.3 → 230，其它值不落档");
  const { mapped: m } = mapText(SAMPLE);
  ok(m.rows[11].needsFullnessChoice && m.rows[11].fullnessTier === null && !m.rows[12].needsFullnessChoice && m.rows[12].fullnessTier === "230" && !m.rows[13].needsFullnessChoice, "MAP-61: 第 12 行（2.0）待选；第 13 行（2.3）直接 230；Door Screen Sheer 不涉及褶皱率");
  ok(pendingFullnessRows(m, {}).join() === "12" && pendingFullnessRows(m, { 12: "230" }).length === 0, "MAP-62: 还有行未选时列出行号；选完为空");
  const a180 = applyFullnessChoices(m, { 12: "180" }), a230 = applyFullnessChoices(m, { 12: "230" });
  ok(a180.drapeOrders[0].drapeFullness === "180" && a230.drapeOrders[0].drapeFullness === "230" && a230.drapeOrders[1].sheerFullness === "230" && m.drapeOrders[0].drapeFullness === "180" && a230 !== m, "MAP-63: 选定的档写进对应的 Drapes 行；不改入参");
  ok(prices(a180).each[14] === 831.7 && prices(a230).each[14] === 1039.26 && prices(a230).each[15] === 488.98, "MAP-64: 第 12 行选 180 = 831.70、选 230 = 1039.26；第 13 行 488.98", prices(a230).each.slice(14));
  const noFull = mapText(onlyRows([{ from: 12, fullness: null }, { from: 13, fullness: null }, { from: 12, fullness: 1.8 }])).mapped;
  ok(noFull.rows[0].needsFullnessChoice && noFull.rows[1].needsFullnessChoice && !noFull.rows[2].needsFullnessChoice && noFull.rows[2].fullnessTier === "180" && noFull.drapeOrders[2].drapeFullness === "180", "MAP-65: 文件没填褶皱率（按工具默认 2.0）→ 待选；1.8 → 180");
  const fileDefault = mapText(onlyRows([{ from: 12, fullness: null }], (r) => { r.quote.pricing.fullness.Drapery = 2.3; })).mapped;
  ok(!fileDefault.rows[0].needsFullnessChoice && fileDefault.rows[0].fullnessTier === "230", "MAP-66: 行上没填时取文件自己的默认褶皱率（文件默认 2.3 → 230）");
  const sheerPending = mapText(onlyRows([{ from: 13, fullness: 2 }])).mapped;
  ok(applyFullnessChoices(sheerPending, { 1: "230" }).drapeOrders[0].sheerFullness === "230" && applyFullnessChoices(sheerPending, { 1: "230" }).drapeOrders[0].drapeFullness === "180", "MAP-67: 纱帘行选档写在纱帘一侧");
  ok(blocks(mapText(onlyRows([{ from: 12, fullness: 5 }])).mapped)[0]?.code === "bad_fullness", "MAP-68: 褶皱率超出 1–4 倍 → 阻断");
  ok(warns(m, "fullness_choice").length === 1 && warns(mapText(onlyRows([{ from: 13 }])).mapped, "fullness_choice").length === 0, "MAP-69: 有待选行时给一条整单提醒");
}

console.log("\n行级折扣与成交价");
{
  const { mapped: m } = mapText(SAMPLE);
  const l15 = m.shadeOrders[11];
  ok(m.rows[14].keptDiscountPct === 0.15 && l15.lineDiscountPct === 0.15 && l15.sku === "PRADO-WHITE-LF" && prices(m).items[11].discountOverridePct === 0.15 && prices(m).each[11] === 234.72, "MAP-70: 第 15 行行折扣 15%（企业默认 45%）→ 保留到行上并随行提交，234.72", [l15.lineDiscountPct, prices(m).each[11]]);
  const l16 = m.shadeOrders[12];
  ok(m.rows[15].keptDiscountPct === null && l16.lineDiscountPct === undefined && l16.manualPrice === undefined && prices(m).each[12] === 149.38, "MAP-71: 第 16 行成交价 120 不带到行上，青砚金额 149.38");
  const high = mapText(onlyRows([{ from: 1, qty: 1, discountOverridePct: 0.5 }])).mapped;
  ok(high.rows[0].keptDiscountPct === null && high.shadeOrders[0].lineDiscountPct === undefined, "MAP-72: 行折扣 50% 高于企业默认 45% → 不带到行上");
  const eq = mapText(onlyRows([{ from: 1, qty: 1, discountOverridePct: 0.45 }])).mapped;
  ok(eq.rows[0].keptDiscountPct === null, "MAP-73: 行折扣等于企业默认 → 不带");
  const orgLower = mapText(onlyRows([{ from: 1, qty: 1, discountOverridePct: 0.42 }]), { orgDiscounts: { Zebra: 0.4 } }).mapped;
  const orgHigher = mapText(onlyRows([{ from: 1, qty: 1, discountOverridePct: 0.42 }]), { orgDiscounts: { Zebra: 0.5 } }).mapped;
  ok(orgLower.rows[0].keptDiscountPct === null && orgHigher.rows[0].keptDiscountPct === 0.42, "MAP-74: 「企业默认」取页面已加载的企业折扣（企业 40% 时 42% 不带；企业 50% 时带）");
  const cord = mapText(onlyRows([{ from: 2, discountOverridePct: 0.25 }, { from: 2, discountOverridePct: 0.35 }])).mapped;
  ok(cord.rows[0].keptDiscountPct === 0.25 && cord.rows[1].keptDiscountPct === null, "MAP-75: 无绳行的「企业默认」是企业无绳折扣 30%（25% 带，35% 不带）");
  const dr = mapText(onlyRows([{ from: 12, fullness: 1.8, discountOverridePct: 0.2 }, { from: 13, discountOverridePct: 0.1 }, { from: 14, discountOverridePct: 0.1 }])).mapped;
  ok(dr.drapeOrders[0].drapeLineDiscountPct === 0.2 && dr.drapeOrders[0].sheerLineDiscountPct === undefined && dr.drapeOrders[1].sheerLineDiscountPct === 0.1 && dr.drapeOrders[2].sheerLineDiscountPct === 0.1, "MAP-76: 布帘 / 纱帘 / Door Screen Sheer 的行折扣写在各自一侧");
  ok(prices(dr).items[2].discountOverridePct === 0.1 && prices(dr).each[2] === 204.55, "MAP-77: Door Screen Sheer 带行折扣 10% → 227.27 × 0.9 = 204.55（行上显式折扣照用）", prices(dr).each);
  const sh = mapText(onlyRows([{ from: 11, discountOverridePct: 0.2 }])).mapped;
  ok(sh.rows[0].keptDiscountPct === null && warns(sh, "shutter_discount_not_kept").length === 1, "MAP-78: 百叶窗行没有行级折扣字段 → 不带，并提醒");
  const al = mapText(onlyRows([{ from: 10, offer: 500 }, { from: 10 }])).mapped;
  ok(al.shadeOrders[0].manualPrice === "500" && al.shadeOrders[1].manualPrice === undefined && prices(al).each.join() === "500,649.35", "MAP-79: Allusion 的成交价填入该行既有的手填成交单价", prices(al).each);
}

console.log("\n附加项目与费用");
{
  const { mapped: m } = mapText(SAMPLE);
  const b = m.partBAddons;
  ok(b.length === 3 && b[0].skuItem === "motor" && b[0].qty === 2 && b[0].price === 150 && b[0].total === 300 && b[0].customName === undefined, "MAP-80: Motor tube ×2 @150 → 目录预设项 motor", b[0]);
  ok(b[1].skuItem === "__custom" && b[1].customName === "Custom bracket" && b[1].qty === 1 && b[1].price === 35, "MAP-81: Custom bracket → 自定义行", b[1]);
  ok(b[2].skuItem === "downtown_fee" && b[2].qty === 1 && b[2].price === 150, "MAP-82: Downtown 服务费 → Part B 的 Downtown 预设项，单价取文件值", b[2]);
  ok(m.installMode === "default" && m.deliveryPromotion === 0 && m.addonPromotion === 0, "MAP-83: 含安装 + 送货 50、企业运费 50 → 安装方式默认，运费不产生让利");
  const fee75 = mapText(SAMPLE, { deliveryFee: 75 }).mapped;
  ok(fee75.deliveryPromotion === 25 && warns(fee75, "delivery_promotion").length === 1, "MAP-84: 企业运费 75 → 特别让利多 25", fee75.deliveryPromotion);
  const neg = mapText(edit((r) => { r.quote.addons.push({ id: "a3", name: "优惠", qty: 1, price: -100, unit: "ea", note: "" }); })).mapped;
  ok(neg.addonPromotion === 100 && neg.partBAddons.length === 3 && !neg.partBAddons.some((x) => x.customName === "优惠") && warns(neg, "addon_negative").length === 1, "MAP-85: 负数附加项目「优惠」−100 不进 Part B，特别让利多 100", neg.addonPromotion);
  const label = mapText(edit((r) => { r.quote.addons = [{ name: "  track 6 FT ", qty: 3, price: 55 }, { name: "TRACK 8 ft (96\")", qty: 1, price: 80 }, { name: "Downtown service fee", qty: 1, price: 99 }]; r.quote.downtown = false; })).mapped;
  ok(label.partBAddons.map((x) => x.skuItem).join() === "track6,track8,downtown_fee" && label.partBAddons[0].price === 55, "MAP-86: 名称与目录的销售名或对客名完全相同（不分大小写）→ 用预设项，单价一律取文件值", label.partBAddons);
  const frac = mapText(edit((r) => { r.quote.addons = [{ name: "Track", qty: 2.5, price: 10 }]; })).mapped;
  ok(frac.partBAddons[0].skuItem === "__custom" && frac.partBAddons[0].qty === 1 && frac.partBAddons[0].price === 25 && frac.partBAddons[0].customName === "Track × 2.5" && warns(frac, "addon_fraction_qty").length === 1, "MAP-87: 数量不是整数的附加项目 → 按合计填成一项自定义行，金额不变", frac.partBAddons[0]);
  const bad = mapText(edit((r) => { r.quote.addons = [{ name: "", qty: 1, price: 5 }, { name: "X", qty: 0, price: 5 }, { name: "Y", qty: 1, price: "5" }]; })).mapped;
  ok(blocks(bad).filter((h) => h.code === "bad_addon").length === 3, "MAP-88: 附加项目的名称、数量或单价无效 → 阻断");

  const noDelivery = mapText(edit((r) => { r.quote.delivery = false; })).mapped;
  ok(noDelivery.installMode === "default" && noDelivery.deliveryPromotion === 50 && warns(noDelivery, "delivery_promotion")[0].messageZh.includes("全额"), "MAP-89: 含安装、不含送货 → 企业运费全额进特别让利");
  const surcharge = mapText(edit((r) => { r.quote.deliveryAmount = 80; })).mapped;
  const s = surcharge.partBAddons.find((x) => x.customName === "Delivery surcharge");
  ok(surcharge.deliveryPromotion === 0 && !!s && s.price === 30 && s.qty === 1, "MAP-90: 文件运费 80 高于企业运费 50 → 差额 30 作为自定义行「Delivery surcharge」", s);
  const pickup = mapText(edit((r) => { r.quote.install = false; })).mapped;
  const d = pickup.partBAddons.find((x) => x.customName === "Delivery");
  ok(pickup.installMode === "pickup" && pickup.deliveryPromotion === 0 && !!d && d.price === 50 && warns(pickup, "pickup").length === 1, "MAP-91: 不含安装但含送货 → 安装方式自提，运费作为自定义行「Delivery」", d);
  const bare = mapText(edit((r) => { r.quote.install = false; r.quote.delivery = false; r.quote.downtown = false; })).mapped;
  ok(bare.installMode === "pickup" && bare.partBAddons.length === 2 && bare.deliveryPromotion === 0, "MAP-92: 不含安装、不含送货、不含 Downtown → 自提，Part B 只有两个附加项目");
  const badFee = mapText(edit((r) => { r.quote.deliveryAmount = -1; r.quote.downtownAmount = "x"; })).mapped;
  ok(blocks(badFee).filter((h) => h.code === "bad_fee").length === 2, "MAP-93: 送货费 / Downtown 金额无效 → 阻断");
  const tax5 = mapText(edit((r) => { r.quote.pricing.tax = 0.05; })).mapped;
  const noTax = mapText(edit((r) => { delete r.quote.pricing; })).mapped;
  ok(tax5.taxRate === 0.05 && noTax.taxRate === null && warns(noTax, "tax_missing").length === 1, "MAP-94: 税率取文件值；文件没有可用税率 → 不改表单税率并提醒");
  const note = mapText(edit((r) => { r.quote.note = "周六上午安装"; r.quote.items[0].note = "靠窗"; })).mapped;
  ok(note.partBNotes === "周六上午安装" && note.shadeOrders[0].note === "靠窗" && note.shadeOrders[1].note === "靠窗", "MAP-95: 整单备注 → Part B 备注；行备注 → 表单行备注");
}

console.log("\n客户匹配");
{
  const list = [
    { id: "c1", phone: "416-555-0100", email: "a@example.com" },
    { id: "c2", phone: "+1 (647) 555-0199", email: "Shared@Example.com" },
    { id: "c3", phone: "", email: "shared@example.com" },
    { id: "c4", phone: null, email: null },
  ];
  ok(matchCustomer({ phone: "(416) 555-0100", email: "" }, list) === "c1", "MAP-100: 文件电话 `(416) 555-0100`，只有一位客户电话为 `416-555-0100` → 自动选中");
  ok(matchCustomer({ phone: "16475550199", email: "" }, list) === "c2" && matchCustomer({ phone: "647 555 0199", email: "" }, list) === "c2", "MAP-101: 北美号码前导 1 不影响比较");
  ok(matchCustomer({ phone: "", email: "shared@example.com" }, list) === null, "MAP-102: 两位客户的邮箱都与文件相同 → 不自动选中");
  ok(matchCustomer({ phone: "", email: " A@Example.COM " }, list) === "c1", "MAP-103: 邮箱去空白、不分大小写");
  ok(matchCustomer({ phone: "9055550000", email: "nobody@example.com" }, list) === null, "MAP-104: 零位命中 → 不自动选中");
  ok(matchCustomer({ phone: "", email: "" }, list) === null && matchCustomer({ phone: "ext", email: "n/a" }, list) === null, "MAP-105: 文件电话与邮箱都为空 → 不会配上电话邮箱同样为空的客户");
  ok(matchCustomer({ phone: "416-555-0100", email: "shared@example.com" }, list) === null, "MAP-106: 电话命中一位、邮箱命中另外两位 → 多位命中，不自动选中");
  ok(matchCustomer({ phone: "416-555-0100", email: "a@example.com" }, list) === "c1", "MAP-107: 电话与邮箱命中同一位 → 选中");
  ok(matchCustomer({ phone: "5550", email: "" }, [{ id: "x", phone: "5550" }]) === null, "MAP-108: 电话不足 7 位数字不按电话匹配");
  const { mapped } = mapText(SINGLE);
  ok(mapped.customer.name === "Test Customer" && mapped.customer.phone === "416-555-0100" && mapped.customer.email === "test@example.com" && mapped.customer.address === "1 Test St, Toronto", "MAP-109: 客户名、电话、邮箱、地址带入客户四项");
}

console.log("\n留痕与填入表单的数据");
{
  const { file, plan, mapped } = mapText(SAMPLE);
  const src = buildImportSource(file, plan, { importedAt: "2026-11-16T12:00:00.000Z", fileGrandTotal: 8224.5, pricelistMatch: true });
  ok(src.tool === "sunny-quote-studio" && src.fileVersion === 1 && src.quoteId === "q1" && src.quoteNumber === "SQ-TEST" && src.plan === "" && src.exportedAt === "2026-11-15T02:59:47.752Z" && src.pricelistVersion === "2026.10-local.1" && src.fileGrandTotal === 8224.5 && src.importedAt === "2026-11-16T12:00:00.000Z" && src.pricelistMatch === true && src.rowCount === 16, "MAP-110: importSource：工具报价号、报价 id、文件版本、所选方案、导出时间、文件价表版本、文件合计、导入时间", src);
  ok(!/phone|email|address|customer/i.test(JSON.stringify(src)), "MAP-111: 留痕里没有客户电话、邮箱、地址");
  const fill = buildFormFill(applyFullnessChoices(mapped, { 12: "180" }), { customerId: null, specialPromotion: 29.38, importSource: src });
  ok(fill.customerId === "" && fill.customerName === "Test" && fill.specialPromotion === "29.38" && fill.shadeOrders.length === 13 && fill.partBAddons.length === 3 && fill.installMode === "default" && fill.taxRate === 0.13 && fill.shutterMaterial === "Vinyl" && fill.importSource === src, "MAP-112: 填入表单的数据：三张表、Part B、安装方式、税率、客户四项、特别让利、留痕；没匹配到客户时 customerId 为空");
  ok(buildFormFill(mapped, { customerId: "c9", specialPromotion: 0, importSource: src }).specialPromotion === "" && buildFormFill(mapped, { customerId: "c9", specialPromotion: 236.944, importSource: src }).specialPromotion === "236.94" && buildFormFill(mapped, { customerId: "c9", specialPromotion: 0, importSource: src }).customerId === "c9", "MAP-113: 特别让利取到分；为 0 时填空串");
  const noShutter = mapText(onlyRows([{ from: 1 }], (r) => { delete r.quote.pricing; })).mapped;
  const f2 = buildFormFill(noShutter, { customerId: null, specialPromotion: 0, importSource: src });
  ok(!("shutterMaterial" in f2) && !("taxRate" in f2), "MAP-114: 没有百叶窗行 / 没有可用税率时不带这两项（表单保持原值）");
}

console.log("\ntoolcode 夹具");
{
  const single = run(SINGLE, { choices: { 12: "180" } });
  const hint = single.mapped.hints.find((h) => h.code === "photos_skipped");
  ok(!!hint && hint.level === "warn" && hint.messageZh === "有 3 张窗户照片未导入", "MAP-120: 单方案带照片：提示「有 3 张窗户照片未导入」", hint);
  const src = buildImportSource(single.file, single.plan, { importedAt: "2026-11-16T12:00:00.000Z", fileGrandTotal: single.result.fileTotals?.grand ?? null, pricelistMatch: single.result.pricelistMatch });
  const fill = buildFormFill(applyFullnessChoices(single.mapped, { 12: "180" }), { customerId: null, specialPromotion: single.result.promotion.total, importSource: src });
  const json = JSON.stringify(fill);
  ok(!json.includes("data:image") && !json.includes("/9j/") && json.length < 40000, "MAP-121: 产出的表单数据里不含任何 data:image（原文件 15 万字节，表单数据不到 4 万）", json.length);
  ok(fill.shadeOrders.length + fill.shutterOrders.length + fill.drapeOrders.length === 17 && fill.partBNotes === "Sample note", "MAP-122: 单方案：17 条表单行，备注带入");

  const a = run(MULTI, { plan: "A", choices: { 12: "180" } });
  const b = run(MULTI, { plan: "B", choices: { 12: "180" } });
  ok(a.file.plans.map((p) => p.planId).join() === "A,B", "MAP-123: 多方案：列出 A、B 两套供选");
  ok(a.plan.items.length === 16 && a.mapped.rows.length === 16 && b.plan.items.length === 15 && b.mapped.rows.length === 15, "MAP-124: 选 A 得到 16 行，选 B 得到 15 行", [a.mapped.rows.length, b.mapped.rows.length]);
  ok(a.mapped.shadeOrders.length === 13 && b.mapped.shadeOrders.length === 12 && a.mapped.shadeOrders[0].pricingFabric === "Light Filtering" && b.mapped.shadeOrders[0].pricingFabric === "Blackout" && b.mapped.shadeOrders[0].sku === "MILAN-GREY-BO", "MAP-125: 只有选定方案的行进入映射（A 13 条 Shades、B 12 条；第 1 行面料档各不相同）");
  ok(a.mapped.partBAddons.some((x) => x.skuItem === "downtown_fee") && !b.mapped.partBAddons.some((x) => x.skuItem === "downtown_fee"), "MAP-126: A 有 Downtown 服务费，B 没有（每套方案用自己的费用开关）");
  for (const [name, r] of [["A", a], ["B", b]] as const) {
    const s = buildImportSource(r.file, r.plan, { importedAt: "2026-11-16T12:00:00.000Z", fileGrandTotal: r.result.fileTotals?.grand ?? null, pricelistMatch: r.result.pricelistMatch });
    const out = JSON.stringify(buildFormFill(applyFullnessChoices(r.mapped, { 12: "180" }), { customerId: null, specialPromotion: r.result.promotion.total, importSource: s }));
    ok(!out.includes("data:image") && !out.includes("/9j/") && !out.includes("windowPhotos") && !out.includes("planWindow") && s.plan === name, `MAP-127: 方案 ${name}：表单数据不带照片数据；留痕里的所选方案是 ${name}`);
  }
  ok(a.mapped.hints.some((h) => h.messageZh === "有 3 张窗户照片未导入") && b.mapped.hints.some((h) => h.messageZh === "有 3 张窗户照片未导入"), "MAP-128: 两套方案都提示照片未导入");
}

console.log("\n源码断言");
{
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (p: string) => strip(readFileSync(join(process.cwd(), p), "utf8"));
  const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bapiFetch\b|\bapiJson\b|\baxios\b|WebSocket|EventSource|new\s+FormData|navigator\.|\.upload\s*\(|@vercel\/blob/;
  const modules = ["types.ts", "validate.ts", "map.ts", "compare.ts", "audit.ts"].map((f) => `src/lib/sales/quote-import/${f}`);
  for (const p of modules) ok(!NETWORK.test(read(p)), `MAP-130: ${p.split("/").pop()} 没有任何网络请求调用`);
  ok(modules.every((p) => !/from\s+["'](?:react|next\/|@\/lib\/db|@\/lib\/api)/.test(read(p))), "MAP-131: 导入模块不引界面框架、数据库与请求封装");
  const mapSrc = read("src/lib/sales/quote-import/map.ts") + read("src/lib/sales/quote-import/compare.ts");
  ok(!/windowPhotos|windowTrial|materialSelection|\bmaterials\b|planWindows/.test(mapSrc), "MAP-134: 映射与对照的源码里不出现照片 / 试装图 / 面料资料的键");
  const { mapped } = mapText(SINGLE);
  const keys = new Set<string>();
  const walk = (v: unknown) => { if (v && typeof v === "object") { if (!Array.isArray(v)) Object.keys(v).forEach((k) => keys.add(k)); Object.values(v as object).forEach(walk); } };
  walk(mapped);
  ok(!["windowPhotos", "windowTrial", "materials", "materialSelection"].some((k) => keys.has(k)), "MAP-135: 映射产出的表单数据不含 windowPhotos、windowTrial、materials、materialSelection 这些键");
  const routes = read("src/app/api/sales/quotes/route.ts");
  ok(!/quote-import\/(?:map|compare|validate)/.test(routes), "MAP-136: 服务端保存路径不引校验 / 映射 / 对照模块（导入不新增接口，服务端只读留痕）");
}

done();
