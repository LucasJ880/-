/**
 * 文件金额 / 青砚金额对照（QUOTE-1b，openspec change quote-import-studio-file，design D3–D5、D8）——纯逻辑，无 DB
 * 运行：npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts
 *
 * 16 行样例逐行与合计：文件 8224.50（工具自己算的数）、青砚 8134.62、让利 29.38（第 12 行选 180）/ 236.94（选 230）。
 */
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import { DEFAULT_CORDLESS_POLICY, DEFAULT_DISCOUNTS } from "@/lib/blinds/pricing-data";
import { applyOrgDiscountDefaults } from "@/lib/blinds/discount-settings";
import { partBRowsToAddonInputs } from "@/lib/blinds/pricing-addons";
import { buildOrderFormItems } from "@/app/(main)/sales/quote-sheet/order-items";
import type { DrapeOrderLine, PartBAddon, ShadeOrderLine, ShutterOrderLine } from "@/app/(main)/sales/quote-sheet/types";
import { applyFullnessChoices, buildFormFill, buildImportSource } from "@/lib/sales/quote-import/map";
import { comparePricelist } from "@/lib/sales/quote-import/compare";
import { MULTI, SAMPLE, SINGLE, edit, makeChecker, onlyRows, parsed, run } from "./helpers";

const { ok, done } = makeChecker();
const near = (a: number | null | undefined, b: number, tol = 0.005) => typeof a === "number" && Math.abs(a - b) <= tol;

console.log("16 行样例 · 第 12 行选 180");
{
  const { result: r } = run(SAMPLE, { choices: { 12: "180" } });
  const expectFile = [385, 513.19, 271.88, 161, 512.61, 210.51, 318.35, 330.11, 256.36, 649.35, 701.29, 831.7, 488.98, 227.27, 234.72, 120];
  const expectQy = [385, 513.19, 271.88, 161, 512.61, 210.51, 318.35, 330.11, 256.36, 649.35, 701.29, 831.7, 488.98, 147.73, 234.72, 149.38];
  ok(r.rows.length === 16 && r.rows.every((x, i) => near(x.fileAmount, expectFile[i])), "CMP-01: 逐行文件金额（第 1 行数量 2 = 385.00 … 第 16 行成交价 120.00）", r.rows.map((x) => x.fileAmount));
  ok(r.rows.every((x, i) => near(x.qingyanAmount, expectQy[i])), "CMP-02: 逐行青砚金额（第 14 行 147.73、第 16 行 149.38，其余与文件相同）", r.rows.map((x) => x.qingyanAmount));
  ok(r.rows.slice(0, 13).every((x) => x.handling === "match" && x.handlingZh === "一致" && x.promotion === 0), "CMP-03: 第 1–13 行为一致", r.rows.slice(0, 13).map((x) => x.handlingZh));
  ok(r.rows[13].handling === "warn_higher" && r.rows[13].handlingZh === "提醒：青砚金额低于文件 79.54" && near(r.rows[13].diff, -79.54) && r.rows[13].promotion === 0, "CMP-04: 第 14 行 Door Screen Sheer：提醒，青砚金额仍为 147.73，不进让利", r.rows[13]);
  ok(r.rows[14].handling === "keep_discount" && r.rows[14].handlingZh === "保留行折扣 15%" && r.rows[14].keptDiscountPct === 0.15, "CMP-05: 第 15 行：保留行折扣 15%", r.rows[14]);
  ok(r.rows[15].handling === "promotion" && r.rows[15].handlingZh === "计入让利 29.38" && near(r.rows[15].promotion, 29.38), "CMP-06: 第 16 行：计入让利 29.38", r.rows[15]);
  ok(!r.hints.some((h) => h.level === "block") && r.canFill && r.pendingFullnessRows.length === 0, "CMP-07: 无阻断，可以填入表单");
  ok(r.pricelistMatch && r.pricelistDiffs.length === 0, "CMP-08: 样例文件的价表与青砚现行价表一致", r.pricelistDiffs);
  const f = r.fileTotals!, q = r.qingyanTotals!;
  ok(near(f.products, 6212.32) && near(f.addons, 485) && near(f.install, 531) && near(f.delivery, 50) && near(f.preTax, 7278.32) && near(f.tax, 946.18) && near(f.grand, 8224.5), "CMP-09: 文件一侧：产品 6212.32、附加项目 485.00（含 Downtown 150）、安装 531、送货 50、税前 7278.32、税 946.18、合计 8224.50", f);
  ok(near(q.products, 6162.16) && near(q.addons, 485) && near(q.install, 531) && near(q.delivery, 50) && near(q.promotion, 29.38) && near(q.preTax, 7198.78) && near(q.tax, 935.84) && near(q.grand, 8134.62), "CMP-10: 青砚一侧：产品 6162.16、附加项目 485、安装 531、送货 50、让利 29.38、税前 7198.78、合计 8134.62", q);
  ok(near(f.grand - q.grand, 89.88) && near(79.54 * 1.13, 89.88), "CMP-11: 两边合计差 89.88，即第 14 行的 79.54 加税");
  ok(near(r.promotion.total, 29.38) && near(r.promotion.rows, 29.38) && r.promotion.addons === 0 && r.promotion.delivery === 0, "CMP-12: 特别让利 29.38，全部来自行差", r.promotion);
  ok(r.hints.some((h) => h.code === "qingyan_lower" && h.rowIndex === 14 && h.level === "warn"), "CMP-13: 文件比青砚贵的行有一条提醒");
}

console.log("\n16 行样例 · 褶皱率");
{
  const pending = run(SAMPLE).result;
  const row = pending.rows[11];
  ok(row.handling === "pending_fullness" && near(row.fileAmount, 831.7) && near(row.fullnessOptions?.["180"].qingyanAmount, 831.7) && near(row.fullnessOptions?.["230"].qingyanAmount, 1039.26) && row.qingyanAmount === null, "CMP-20: 第 12 行并排显示文件 831.70、选 180 的 831.70、选 230 的 1039.26，并要求选择", row);
  ok(near(row.fullnessOptions?.["180"].diff, 0) && near(row.fullnessOptions?.["230"].diff, 207.56), "CMP-21: 两档各自相对文件金额的差（0 / 207.56）");
  ok(!pending.canFill && pending.pendingFullnessRows.join() === "12" && pending.qingyanTotals === null && !pending.hints.some((h) => h.level === "block"), "CMP-22: 未选时「填入表单」不可用（没有阻断，只是待选）");
  ok(near(pending.rows[12].qingyanAmount, 488.98) && pending.rows[12].fullnessOptions === null && pending.rows[12].handling === "match", "CMP-23: 第 13 行（2.3）直接 230，不要求选择，488.98");
  const r230 = run(SAMPLE, { choices: { 12: "230" } }).result;
  ok(r230.rows[11].handling === "promotion" && r230.rows[11].handlingZh === "计入让利 207.56" && near(r230.rows[11].qingyanAmount, 1039.26), "CMP-24: 第 12 行选 230 → 计入让利 207.56", r230.rows[11]);
  ok(near(r230.promotion.total, 236.94) && near(r230.qingyanTotals?.grand, 8134.62, 0.011) && near(r230.qingyanTotals?.products, 6369.71), "CMP-25: 选 230：特别让利 236.94，合计仍为 8134.62（误差 ≤ 0.01）", [r230.promotion.total, r230.qingyanTotals?.grand]);
  ok(r230.canFill && near(r230.fileTotals?.grand, 8224.5), "CMP-26: 选完即可填入；文件合计不随选档变化");

  // 只超一档：Drapery 最大查表宽 = 价表最大宽；窗宽 w 使 w×1.8÷2 在范围内、w×2.3÷2 超出
  const edge = run(onlyRows([{ from: 12, w: 180, fullness: 2 }]));
  const o = edge.result.rows[0].fullnessOptions!;
  ok(o["180"].qingyanAmount !== null && o["230"].qingyanAmount === null && !!o["230"].errorZh, "CMP-27: 只有 230 超出价表：该档不可选并写明原因", o);
  const chose230 = run(onlyRows([{ from: 12, w: 180, fullness: 2 }]), { choices: { 1: "230" } }).result;
  const chose180 = run(onlyRows([{ from: 12, w: 180, fullness: 2 }]), { choices: { 1: "180" } }).result;
  ok(!chose230.canFill && chose230.hints.some((h) => h.level === "block" && h.code === "fullness_out_of_range") && chose180.canFill, "CMP-28: 选了超出价表的那一档 → 阻断；改选另一档可以填入");
}

console.log("\n价表一致性");
{
  const zebraCell = edit((r) => { r.quote.pricing.data.products.Zebra.fabrics["Light Filtering"].msrp[4][4] += 1; });
  const a = run(zebraCell, { choices: { 12: "180" } }).result;
  ok(!a.pricelistMatch && a.pricelistDiffs.some((d) => d.includes("Zebra") && d.includes("MSRP")), "CMP-30: Zebra 改一格 MSRP → 价表不一致", a.pricelistDiffs);
  ok(a.rows.every((x) => x.fileAmount === null && x.diff === null) && a.fileTotals === null, "CMP-31: 各行没有文件金额与差额，文件合计也不显示");
  ok(a.hints.some((h) => h.code === "pricelist_mismatch" && h.level === "warn" && h.messageZh.includes("该文件的价表与公司现行价表不同")) && !a.hints.some((h) => h.level === "block") && a.canFill, "CMP-32: 有一条价表不同的提醒，无阻断，仍可继续导入");
  ok(a.rows.every((x) => x.qingyanAmount !== null) && near(a.qingyanTotals?.products, 6162.16) && a.promotion.rows === 0 && a.rows[15].handling === "no_file_amount" && a.rows[14].handling === "keep_discount", "CMP-33: 青砚金额照常；行级差额不计入让利；行折扣仍按规则保留", [a.promotion, a.rows[15].handlingZh]);

  // 没用到的品类不同：去掉样例里的 Zebra 行，再改 Zebra 的价表
  const unused = edit((r) => { r.quote.items = r.quote.items.filter((it: { product: string }) => it.product !== "Zebra"); r.quote.pricing.data.products.Zebra.fabrics["Blackout"].msrp[0][0] = 1; r.quote.pricing.floors.Zebra = 999; r.quote.pricing.data.products.Zebra.brackets.widths[0] = 1; });
  const u = run(unused, { choices: { 9: "180" } }).result;
  ok(u.pricelistMatch && u.rows.every((x) => x.fileAmount !== null), "CMP-34: 本次没用到的品类与青砚不同 → 仍为一致", u.pricelistDiffs);
  const unusedFabric = run(edit((r) => { r.quote.items = [r.quote.items[0]]; r.quote.pricing.data.products.Zebra.fabrics["Blackout"].msrp[0][0] = 1; })).result;
  ok(unusedFabric.pricelistMatch, "CMP-35: 同一品类里没用到的面料档不同 → 仍为一致");

  const cases: Array<[string, string, RegExp]> = [
    ["最低价：Zebra 100 → 120", edit((r) => { r.quote.pricing.floors.Zebra = 120; }), /Zebra：最低价不同/],
    ["最低安装费 200 → 250", edit((r) => { r.quote.pricing.data.install.minimum_total = 250; }), /安装费标准不同/],
    ["安装单价 18 → 20", edit((r) => { r.quote.pricing.data.install.regular = 20; }), /安装费标准不同/],
    ["宽档位改一档", edit((r) => { r.quote.pricing.data.products.SHANGRILA.brackets.widths[3] += 1; }), /SHANGRILA：宽高档位不同/],
    ["Roller 引用表改一格", edit((r) => { r.quote.pricing.data.products.Roller.msrpTables.BO[2][2] += 0.5; }), /Roller \/ Blackout.*MSRP 不同/],
    ["Roller 面料档的罩盒标记不同", edit((r) => { r.quote.pricing.data.products.Roller.fabrics["Blackout w Cassette"].cassette = false; }), /Roller \/ Blackout w Cassette：配置不同/],
    ["Door Screen Sheer 的计价方式标记不同", edit((r) => { r.quote.pricing.data.products.Sheer.fabrics["Door Screen Sheer"] = { discount: 0 }; }), /Door Screen Sheer：计价方式不同/],
    ["文件没有带价表", edit((r) => { delete r.quote.pricing; }), /文件没有带价表/],
    ["文件缺某个用到的品类", edit((r) => { delete r.quote.pricing.data.products.Fauxwood; }), /Fauxwood：文件里没有这个品类的价表/],
    ["文件缺默认折扣", edit((r) => { delete r.quote.pricing.discounts.Allusion; }), /Allusion：文件里没有默认折扣/],
  ];
  for (const [name, text, re] of cases) {
    const c = run(text, { choices: { 12: "180" } }).result;
    ok(!c.pricelistMatch && c.pricelistDiffs.some((d) => re.test(d)) && c.rows.every((x) => x.fileAmount === null) && c.fileTotals === null, `CMP-36: ${name} → 价表不一致，没有文件金额`, c.pricelistDiffs);
  }
  const tiny = run(edit((r) => { r.quote.pricing.data.products.Zebra.fabrics["Light Filtering"].msrp[4][4] += 1e-9; }), { choices: { 12: "180" } }).result;
  ok(tiny.pricelistMatch, "CMP-37: 浮点差 ≤ 1e-6 视为相同");
  const file = parsed(SAMPLE);
  ok(comparePricelist(file.pricing, []).match && !comparePricelist(null, []).match, "CMP-38: 没有产品行时只比整份的安装费标准与税率；没有价表一律不一致");
}

console.log("\n文件金额按文件自己的参数重算");
{
  // 文件默认折扣与企业默认不同：文件 Zebra 40%，企业 45%
  const fileDisc = run(onlyRows([{ from: 1, qty: 1 }], (r) => { r.quote.pricing.discounts.Zebra = 0.4; })).result;
  ok(fileDisc.pricelistMatch && near(fileDisc.rows[0].fileAmount, 210) && near(fileDisc.rows[0].qingyanAmount, 192.5) && fileDisc.rows[0].handling === "warn_higher", "CMP-40: 文件默认折扣 40%（企业 45%）：文件金额按 40% 算 210.00，青砚 192.50 → 提醒", fileDisc.rows[0]);
  const orgDisc = run(onlyRows([{ from: 1, qty: 1 }]), { settings: { orgDiscounts: { Zebra: 0.4 } } }).result;
  ok(near(orgDisc.rows[0].fileAmount, 192.5) && near(orgDisc.rows[0].qingyanAmount, 210) && orgDisc.rows[0].handling === "promotion" && near(orgDisc.promotion.total, 17.5), "CMP-41: 企业折扣改成 40%（文件 45%）：青砚 210.00 比文件 192.50 贵 → 差额 17.50 计入让利", orgDisc.rows[0]);
  const high = run(onlyRows([{ from: 1, qty: 1, discountOverridePct: 0.5 }])).result;
  ok(near(high.rows[0].fileAmount, 175) && near(high.rows[0].qingyanAmount, 192.5) && high.rows[0].handlingZh === "计入让利 17.50", "CMP-42: 行折扣 50% 高于企业默认 → 不带到行上，差额 17.50 计入让利", high.rows[0]);
  const keptAndOffer = run(onlyRows([{ from: 15, offer: 200 }])).result;
  ok(keptAndOffer.rows[0].handling === "promotion" && keptAndOffer.rows[0].handlingZh === "保留行折扣 15%，计入让利 34.72" && near(keptAndOffer.rows[0].qingyanAmount, 234.72), "CMP-43: 行折扣 15% 保留、成交价 200 更低 → 「保留行折扣 15%，计入让利 34.72」", keptAndOffer.rows[0]);
  const offerHigh = run(onlyRows([{ from: 16, offer: 180 }])).result;
  ok(offerHigh.rows[0].handling === "warn_higher" && near(offerHigh.rows[0].diff, -30.62) && offerHigh.promotion.total === 0 && near(offerHigh.rows[0].qingyanAmount, 149.38), "CMP-44: 成交价高于青砚价（非 Allusion）→ 只列提醒，不调高青砚金额", offerHigh.rows[0]);
  const allusion = run(onlyRows([{ from: 10, offer: 500 }])).result;
  ok(near(allusion.rows[0].fileAmount, 500) && near(allusion.rows[0].qingyanAmount, 500) && allusion.rows[0].handling === "match" && allusion.promotion.total === 0, "CMP-45: Allusion 成交价 500 填入手填成交单价：两边都是 500，不进让利", allusion.rows[0]);
  const cordlessFile = run(onlyRows([{ from: 2 }], (r) => { r.quote.pricing.cordlessDiscount = 0.2; })).result;
  ok(near(cordlessFile.rows[0].fileAmount, 586.5) && near(cordlessFile.rows[0].qingyanAmount, 513.19), "CMP-46: 无绳行用文件自己的无绳折扣重算（20% → 586.50；青砚按企业无绳折扣 513.19）", cordlessFile.rows[0]);
  const dss = run(onlyRows([{ from: 14, w: 24 }, { from: 14, discountOverridePct: 0.1 }])).result;
  ok(near(dss.rows[0].fileAmount, 170.45) && near(dss.rows[0].qingyanAmount, 110.8) && near(dss.rows[1].fileAmount, 204.55) && near(dss.rows[1].qingyanAmount, 204.55) && dss.rows[1].handling === "keep_discount", "CMP-47: Door Screen Sheer：文件不打折（170.45）、青砚套企业折扣（110.80）；行上带 10% 时两边都是 204.55", dss.rows);
  const qty = run(MULTI, { plan: "B", choices: { 12: "180" } }).result;
  ok(near(qty.rows[0].fileAmount, 443.76) && near(qty.rows[0].qingyanAmount, 443.75) && qty.rows[0].handling === "match", "CMP-48: 逐行取整照工具的写法（单价取到分再乘数量）：443.76 对 443.75，差不超过 0.01 × 数量 → 一致", qty.rows[0]);
  const wood = run(onlyRows([{ from: 11, fabric: "Wood" }])).result;
  ok(near(wood.rows[0].fileAmount, 1172.22) && near(wood.rows[0].qingyanAmount, 1172.22) && wood.rows[0].handling === "match", "CMP-49: 实木百叶窗 72×60：两边都是 1172.22");
}

console.log("\n特别让利的来源");
{
  const fee75 = run(SAMPLE, { settings: { deliveryFee: 75 }, choices: { 12: "180" } }).result;
  ok(near(fee75.promotion.delivery, 25) && near(fee75.promotion.total, 54.38) && near(fee75.qingyanTotals?.delivery, 75) && near(fee75.qingyanTotals?.grand, 8134.62), "CMP-50: 企业运费 75：让利多 25（共 54.38），合计不变 8134.62", [fee75.promotion, fee75.qingyanTotals?.grand]);
  const neg = run(edit((r) => { r.quote.addons.push({ id: "a3", name: "优惠", qty: 1, price: -100, unit: "ea", note: "" }); }), { choices: { 12: "180" } }).result;
  ok(near(neg.promotion.addons, 100) && near(neg.promotion.total, 129.38) && near(neg.fileTotals?.addons, 385) && near(neg.fileTotals?.grand, 8111.5) && near(neg.qingyanTotals?.addons, 485) && near(neg.qingyanTotals?.grand, 8021.62), "CMP-51: 负数附加项目 −100：让利多 100；文件合计少 113，青砚合计同样少 113", [neg.promotion, neg.fileTotals?.grand, neg.qingyanTotals?.grand]);
  const noDelivery = run(edit((r) => { r.quote.delivery = false; }), { choices: { 12: "180" } }).result;
  ok(near(noDelivery.promotion.delivery, 50) && near(noDelivery.fileTotals?.delivery, 0) && near(noDelivery.qingyanTotals?.delivery, 50) && near((noDelivery.fileTotals?.grand ?? 0) - (noDelivery.qingyanTotals?.grand ?? 0), 89.88), "CMP-52: 含安装、不含送货：企业运费全额进让利，两边合计的差仍只有第 14 行那一笔");
  const mismatch = run(edit((r) => { r.quote.pricing.floors.Zebra = 120; r.quote.addons.push({ name: "优惠", qty: 1, price: -40 }); }), { settings: { deliveryFee: 75 }, choices: { 12: "180" } }).result;
  ok(mismatch.promotion.rows === 0 && near(mismatch.promotion.total, 65), "CMP-53: 价表不一致时行差为 0，只累加附加项目与运费两项（40 + 25）", mismatch.promotion);
  const pickup = run(edit((r) => { r.quote.install = false; }), { choices: { 12: "180" } }).result;
  ok(near(pickup.fileTotals?.install, 0) && near(pickup.qingyanTotals?.install, 0) && near(pickup.qingyanTotals?.delivery, 0) && near(pickup.fileTotals?.delivery, 50) && near(pickup.qingyanTotals?.addons, 535), "CMP-54: 不含安装：两边安装费都是 0；文件的送货 50 在青砚落在 Part B 自定义行", [pickup.fileTotals, pickup.qingyanTotals]);
}

console.log("\n阻断");
{
  const mixed = run(onlyRows([{ from: 11 }, { from: 11, fabric: "Wood" }])).result;
  ok(!mixed.canFill && mixed.hints.some((h) => h.level === "block" && h.code === "shutter_mixed") && mixed.qingyanTotals === null && mixed.fileTotals === null && mixed.rows.every((x) => x.handling === "block"), "CMP-60: 材质混用的 Shutters：核对窗列出阻断原因，「填入表单」不可用", mixed.hints);
  const big = run(onlyRows([{ from: 1, w: 200 }, { from: 5 }])).result;
  ok(!big.canFill && big.rows[0].handling === "block" && big.rows[0].qingyanAmount === null && big.rows[1].handling === "match", "CMP-61: 尺寸超出价表的行为阻断，其它行照常对照");
}

console.log("\n填入后与手填等价");
{
  const { mapped, result, file, plan } = run(SAMPLE, { choices: { 12: "180" } });
  const applied = applyFullnessChoices(mapped, { 12: "180" });
  // 手工构造同样内容的表单数据（不经过映射）
  let n = 0;
  const shade = (location: string, w: string, wf: string, h: string, product: ShadeOrderLine["product"], sku: string, more: Partial<ShadeOrderLine> = {}): ShadeOrderLine =>
    ({ id: `H${++n}`, location, widthWhole: w, widthFrac: wf, heightWhole: h, heightFrac: "0", product, sku, mount: "", lift: "", bracket: "", valance: "", note: "", cordless: false, ...more });
  const shades: ShadeOrderLine[] = [
    shade("R1", "48", "8", "60", "Zebra", "LOUIA-WHITE-BL201-LF", { pricingFabric: "Light Filtering" }),
    shade("R1 (2)", "48", "8", "60", "Zebra", "LOUIA-WHITE-BL201-LF", { pricingFabric: "Light Filtering" }),
    shade("R2", "90", "0", "60", "Zebra", "MILAN-GREY-BO", { pricingFabric: "Blackout", cordless: true }),
    shade("R3", "55", "0", "72", "Roller", "CABO-WHITE-BO", { pricingFabric: "Blackout w Cassette", valance: "Cassette" }),
    shade("R4", "36", "0", "48", "Roller", "Light Filtering (Open Roll)", { pricingFabric: "Light Filtering (Open Roll)", valance: "None", cordless: true }),
    shade("R5", "60", "0", "72", "SHANGRILA", "Standard", { pricingFabric: "Standard" }),
    shade("R6", "30", "0", "48", "Cordless Cellular", "B01-38-BO100", { pricingFabric: "Standard" }),
    shade("R7", "30", "0", "48", "SkylightHoneycomb", "Standard", { pricingFabric: "Standard" }),
    shade("R8", "40", "0", "60", "Roman Shade", "BMF06-BO", { pricingFabric: "Blackout" }),
    shade("R9", "36", "0", "48", "Fauxwood", "Standard", { pricingFabric: "Standard" }),
    shade("R10", "60", "0", "84", "Allusion", "Standard", { pricingFabric: "Standard" }),
    shade("R15", "40", "0", "50", "Zebra", "PRADO-WHITE-LF", { pricingFabric: "Light Filtering", lineDiscountPct: 0.15 }),
    shade("R16", "40", "0", "50", "Roller", "Blackout (Open Roll)", { pricingFabric: "Blackout (Open Roll)", valance: "None" }),
  ];
  const shutters: ShutterOrderLine[] = [{ id: "H50", location: "R11", widthWhole: "72", widthFrac: "0", heightWhole: "60", heightFrac: "0", frame: "", openDirection: "", mountType: "", midRail: "", panelCount: 1, draft: "" }];
  const drapeBase = { drapeWidthWhole: "", drapeWidthFrac: "0", drapeHeightWhole: "", drapeHeightFrac: "0", drapeFabricSku: "Without liner", drapeFullness: "180", drapePanels: "S", drapePleatStyle: "", drapeLiner: false, drapeBracket: "", sheerWidthWhole: "", sheerWidthFrac: "0", sheerHeightWhole: "", sheerHeightFrac: "0", sheerFabricSku: "", sheerFullness: "180", sheerPanels: "S", sheerPleatStyle: "", sheerBracket: "", accessoriesSku: "", note: "" } as const;
  const drapes: DrapeOrderLine[] = [
    { ...drapeBase, id: "H60", location: "R12", drapeWidthWhole: "100", drapeHeightWhole: "108", drapeFabricSku: "With liner (Black out)", drapeLiner: true, drapeFullness: "180" },
    { ...drapeBase, id: "H61", location: "R13", sheerWidthWhole: "100", sheerHeightWhole: "108", sheerFabricSku: "Light Filtering", sheerFullness: "230" },
    { ...drapeBase, id: "H62", location: "R14", sheerWidthWhole: "30", sheerHeightWhole: "48", sheerFabricSku: "Door Screen Sheer" },
  ];
  const partB: PartBAddon[] = [
    { id: "B1", skuItem: "motor", qty: 2, price: 150, total: 300 },
    { id: "B2", skuItem: "__custom", customName: "Custom bracket", qty: 1, price: 35, total: 35 },
    { id: "B3", skuItem: "downtown_fee", qty: 1, price: 150, total: 150 },
  ];
  // 去掉行 id、键按名排序后比较（键的书写顺序不算差异）
  const canon = (rows: object[]) => JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id").sort(([x], [y]) => x.localeCompare(y)))));
  ok(canon(applied.shadeOrders) === canon(shades) && canon(applied.shutterOrders) === canon(shutters) && canon(applied.drapeOrders) === canon(drapes) && canon(applied.partBAddons) === canon(partB), "CMP-70: 映射出的三张表与 Part B 和手工录入的表单数据同形（除行 id 外逐字段相同）");
  // 服务端保存时的同一条路径
  const items = buildOrderFormItems({ shadeOrders: shades, shutterOrders: shutters, drapeOrders: drapes, shutterMaterial: "Vinyl", shadeValanceType: "" });
  const hand = calculateQuoteTotal({ items: applyOrgDiscountDefaults(items, DEFAULT_DISCOUNTS), addons: partBRowsToAddonInputs(partB), installMode: "default", deliveryFee: 50, taxRate: 0.13, sunnyMotorPrice: 150, minInstallTotal: 200, cordlessPolicy: DEFAULT_CORDLESS_POLICY, specialPromotion: 29.38 });
  ok(hand.errors.length === 0 && hand.itemResults.length === 17 && near(hand.grandTotal, 8134.62) && near(hand.grandTotal, result.qingyanTotals!.grand, 1e-9 + 0.005) && near(hand.merchSubtotal, result.qingyanTotals!.products) && near(hand.preTaxTotal, result.qingyanTotals!.preTax), "CMP-71: 手工构造的表单数据经行构造与服务端同一个计价函数：合计 8134.62，与核对窗的青砚合计相同", [hand.grandTotal, result.qingyanTotals]);
  // 逐行：手工行的成交价按文件行归并后与核对窗逐行相同
  const perRow = [hand.itemResults[0].price + hand.itemResults[1].price, ...hand.itemResults.slice(2, 11).map((x) => x.price), hand.itemResults[13].price, hand.itemResults[14].price, hand.itemResults[15].price, hand.itemResults[16].price, hand.itemResults[11].price, hand.itemResults[12].price];
  ok(result.rows.every((x, i) => near(x.qingyanAmount, perRow[i])), "CMP-72: 逐行金额与手工构造的结果相同", perRow.map((x) => Math.round(x * 100) / 100));
  const src = buildImportSource(file, plan, { importedAt: "2026-11-16T12:00:00.000Z", fileGrandTotal: result.fileTotals?.grand ?? null, pricelistMatch: result.pricelistMatch });
  const fill = buildFormFill(applied, { customerId: null, specialPromotion: result.promotion.total, importSource: src });
  ok(fill.specialPromotion === "29.38" && Number(fill.specialPromotion) === 29.38, "CMP-73: 填入表单的特别让利是 29.38");
}

console.log("\n留痕里的文件合计");
{
  const good = run(SAMPLE, { choices: { 12: "180" } });
  const s1 = buildImportSource(good.file, good.plan, { importedAt: "2026-11-16T12:00:00.000Z", fileGrandTotal: good.result.fileTotals?.grand ?? null, pricelistMatch: good.result.pricelistMatch });
  ok(s1.fileGrandTotal === 8224.5 && s1.pricelistMatch === true, "CMP-80: 16 行样例的留痕：文件合计 8224.50（重算值）", s1.fileGrandTotal);
  const bad = run(edit((r) => { r.quote.pricing.data.products.Zebra.fabrics["Light Filtering"].msrp[4][4] += 1; }), { choices: { 12: "180" } });
  const s2 = buildImportSource(bad.file, bad.plan, { importedAt: "2026-11-16T12:00:00.000Z", fileGrandTotal: bad.result.fileTotals?.grand ?? null, pricelistMatch: bad.result.pricelistMatch });
  ok(s2.fileGrandTotal === null && s2.pricelistMatch === false, "CMP-81: Zebra 改一格 MSRP 后的留痕：文件合计为空，价表一致标记为否", s2);
}

console.log("\ntoolcode 夹具");
{
  const single = run(SINGLE, { choices: { 12: "180" } }).result;
  ok(near(single.fileTotals?.grand, 8224.5) && near(single.qingyanTotals?.grand, 8134.62) && near(single.promotion.total, 29.38) && single.canFill, "CMP-90: 单方案带照片：文件 8224.50、青砚 8134.62、让利 29.38", [single.fileTotals?.grand, single.qingyanTotals?.grand]);
  const a = run(MULTI, { plan: "A", choices: { 12: "180" } }).result;
  const b = run(MULTI, { plan: "B", choices: { 12: "180" } }).result;
  ok(a.rows.length === 16 && near(a.fileTotals?.grand, 8224.5) && near(a.qingyanTotals?.grand, 8134.62) && near(a.promotion.total, 29.38), "CMP-91: 多方案选 A：16 行，文件 8224.50（工具对方案 A 算的数）、青砚 8134.62", [a.fileTotals?.grand, a.qingyanTotals?.grand]);
  ok(b.rows.length === 15 && near(b.fileTotals?.grand, 7965.46) && near(b.fileTotals?.products, 6151.08) && near(b.fileTotals?.install, 513) && near(b.fileTotals?.addons, 335) && b.promotion.total === 0, "CMP-92: 多方案选 B：15 行，文件 7965.46（工具对方案 B 算的数：产品 6151.08、安装 513、无 Downtown）", b.fileTotals);
  ok(near(b.qingyanTotals?.grand, 7875.57) && near((b.fileTotals?.grand ?? 0) - (b.qingyanTotals?.grand ?? 0), 89.89, 0.011), "CMP-93: 方案 B 青砚合计 7875.57；两边的差仍是 Door Screen Sheer 那一行加税", b.qingyanTotals?.grand);
}

done();
