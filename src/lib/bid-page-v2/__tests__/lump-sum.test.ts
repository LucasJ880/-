/**
 * BIDPAGE-4 只报总价（纯函数，无 DB / 网络 / 模型）：判定、类别与算法对照、范围、销售税、验收 3 的数、算式、
 * 状态 ↔ 成本行往返、专业模式改过后的读法、互转前后报价引擎结果相同与拒绝的情况、接口源码写法
 * （openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode）
 * 运行：npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { computeQuote } from "@/lib/quote-engine/calc";
import { COST_CATEGORIES, CALCULATION_TYPES, engineConfigSchema, quoteHeaderSchema, type EngineConfig } from "@/lib/quote-engine/contract";
import { templateSupplyOnlyLines } from "@/lib/quote-engine/templates";
import {
  LUMP_ADDABLE_KEYS,
  LUMP_ITEM_KEYS,
  LUMP_ITEM_SPEC,
  isLumpSumQuote,
  lumpFormulaLinesZh,
  readLumpMeta,
  validateLumpState,
  type LumpFormula,
  type LumpItem,
  type LumpState,
} from "../lump-sum/contract";
import { ALGO_CHANGED_REASON_ZH, defaultLumpState, emptyLumpItem, indexLumpLines, lumpStateFromLines, lumpStateToWrites, type LumpWrite } from "../lump-sum/mapping";
import { compareEngine, convertHintZh, convertLineToLump, convertLumpToLine, inputsOf, simulateWrites } from "../lump-sum/convert";
import { PRESET_DESCRIPTION_ZH, costLinesToState, defaultLineModeState, stateToWrites, type DbCostLine } from "../quote-line/mapping";
import { readBidLineMeta, type LineModeState, type LineRow } from "../quote-line/contract";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 900)}`}`);
  }
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let idSeq = 0;
/** 要写的行 → 「库里的行」（精度照库：数量 / 金额 / 时长 4 位、汇率 8 位、比例 4 位） */
function toDb(w: LumpWrite, id?: string): DbCostLine {
  const d = (v: number | null, p: number) => (v == null ? null : new Prisma.Decimal(v.toFixed(8)).toDecimalPlaces(p, Prisma.Decimal.ROUND_HALF_UP));
  return {
    id: id ?? `cl_${String(++idSeq).padStart(4, "0")}`,
    sortOrder: w.sortOrder,
    category: w.category,
    subcategory: w.subcategory,
    description: w.description,
    quantity: d(w.quantity, 4),
    unit: w.unit,
    unitCost: d(w.unitCost, 4),
    sourceCurrency: w.sourceCurrency,
    fxRate: d(w.fxRate, 8),
    fxRateSource: w.fxRateSource,
    calculationType: w.calculationType,
    calculationBase: w.calculationBase,
    rate: d(w.rate, 4),
    duration: d(w.duration, 4),
    supplierId: w.supplierId,
    supplierName: w.supplierName,
    source: w.source,
    notes: w.notes ?? null,
    included: w.included,
    metadata: w.metadata,
  };
}
/** 写入结果落到「库里」：删、改、建（更新时没写备注的保留原备注） */
function apply(current: DbCostLine[], writes: ReturnType<typeof lumpStateToWrites>): DbCostLine[] {
  const del = new Set(writes.deleteIds);
  const upd = new Map(writes.updates.map((u) => [u.id, u.data]));
  const kept = current.filter((l) => !del.has(l.id)).map((l) => (upd.has(l.id) ? { ...toDb(upd.get(l.id)!, l.id), notes: upd.get(l.id)!.notes === undefined ? l.notes : (upd.get(l.id)!.notes ?? null) } : l));
  return [...kept, ...writes.creates.map((c) => toDb(c))];
}
const quoteOf = (over: { pricingMethod?: string; rate?: number | null; tax?: EngineConfig["tax"]; entryMode?: "LINE" | "LUMP_SUM" } = {}) => ({
  pricingMethod: over.pricingMethod ?? "MARGIN_ON_REVENUE",
  pricingRate: over.rate == null ? null : new Prisma.Decimal(over.rate),
  engineJson: { tax: over.tax ?? { hstPct: null, gstPct: null, pstPct: null }, entryMode: over.entryMode ?? "LUMP_SUM" },
});
function calc(lines: DbCostLine[], marginPct: number | null, tax: EngineConfig["tax"] = {}) {
  return computeQuote({ quoteCurrency: "CAD", lines: inputsOf(lines), pricing: { method: "MARGIN_ON_REVENUE", rate: marginPct }, engine: { tax } });
}
/** 存一次：状态 → 写 → 库（新建时 current = []） */
function save(state: LumpState, current: DbCostLine[] = []): DbCostLine[] {
  const v = validateLumpState(state);
  if (!v.ok) throw new Error(`校验不过：${JSON.stringify(v.issues)}`);
  return apply(current, lumpStateToWrites(v.state, current));
}
const item = (key: LumpItem["key"], over: Partial<LumpItem> = {}): LumpItem => ({ ...emptyLumpItem(key), ...over });
const presetsOff = (s: LumpState): LumpState => ({ ...s, presets: { financing: { ...s.presets.financing, included: false }, admin: { ...s.presets.admin, included: false }, cashAllowance: { ...s.presets.cashAllowance, included: false }, commission: { ...s.presets.commission, included: false } } });
/** 验收 3 的状态：货品 800,000、海运 60,000、关税 40,000（金额）、预置全关 */
function acceptance3(): LumpState {
  const s = defaultLumpState();
  return presetsOff({
    ...s,
    goods: { ...s.goods, amount: 800000, evidenceKind: "ESTIMATE" },
    items: [item("ocean_freight", { amount: 60000 }), item("duty", { amount: 40000 })],
    targetMarginPct: 25,
  });
}
const rowOf = (over: Partial<LineRow> = {}): LineRow => ({ costLineId: null, description: "合成卷帘 A", quantity: 5, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 100, currency: "CAD", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual", ...over });

console.log("━━━ 1. 判定与做法字段 ━━━");
{
  const j = (entryMode?: string) => (entryMode ? { tax: {}, entryMode } : { tax: {} });
  const r = [
    isLumpSumQuote({ engineJson: j("LUMP_SUM"), quoteType: "SUPPLY_ONLY" }),
    isLumpSumQuote({ engineJson: j("LUMP_SUM"), quoteType: "PROJECT_SUPPLY_INSTALL" }),
    isLumpSumQuote({ engineJson: j("LUMP_SUM"), quoteType: "STANDING_OFFER" }),
    isLumpSumQuote({ engineJson: j("LINE"), quoteType: "SUPPLY_ONLY" }),
    isLumpSumQuote({ engineJson: j(), quoteType: "SUPPLY_ONLY" }),
    isLumpSumQuote({ engineJson: null, quoteType: "SUPPLY_ONLY" }),
  ];
  ok(isDeepStrictEqual(r, [true, true, false, false, false, false]), "只有「只报总价 + 只供货 / 供货加安装」是总价报价；长期供货协议、逐行、没有做法字段都不是", r);
  const kept = engineConfigSchema.parse({ tax: { hstPct: 13 }, entryMode: "LUMP_SUM" });
  ok(kept.entryMode === "LUMP_SUM" && kept.tax?.hstPct === 13, "做法为只报总价的配置：做法保留，税照旧", kept);
  const hdr = quoteHeaderSchema.parse({ engine: { entryMode: "LUMP_SUM", tax: { gstPct: 5 } } }).engine as Record<string, unknown>;
  ok(!Object.keys(hdr).includes("entryMode") && (hdr.tax as { gstPct: number }).gstPct === 5, "专业模式保存（表头）不收只报总价的做法字段，税照收", hdr);
  const merged = engineConfigSchema.parse({ ...engineConfigSchema.parse({ tax: { hstPct: 7 }, entryMode: "LUMP_SUM" }), ...quoteHeaderSchema.parse({ engine: {} }).engine });
  ok(merged.entryMode === "LUMP_SUM" && merged.tax?.hstPct === 7, "专业模式保存传空配置：合并后做法与税都还在", merged);
}

console.log("\n━━━ 2. 新建、清单与类别对照 ━━━");
{
  const lines = save(defaultLumpState());
  const metas = lines.map((l) => readLumpMeta(l.metadata)?.key ?? readBidLineMeta(l.metadata)?.role);
  ok(lines.length === 7 && isDeepStrictEqual([...metas].sort(), ["duty", "goods_total", "ocean_freight", "preset", "preset", "preset", "preset"]), "新建：恰好货品总数、海运费、关税各一条 + 四条预置", metas);
  const tpl = templateSupplyOnlyLines();
  const presetLines = lines.filter((l) => readBidLineMeta(l.metadata)?.role === "preset");
  const pick = (cat: string, type: string) => tpl.find((t) => t.category === cat && t.calculationType === type)!;
  ok(
    presetLines.every((l) => {
      const t = pick(l.category, l.calculationType);
      return !!t && Number(l.rate) === t.rate && (l.duration == null ? t.duration == null : Number(l.duration) === t.duration) && l.included === t.included;
    }) && presetLines.every((l) => Object.values(PRESET_DESCRIPTION_ZH).includes(l.description)),
    "四条预置的比例、月数、开关与只供货模板相同，说明与逐行报价的四条相同",
  );
  const st = lumpStateFromLines(lines, quoteOf());
  ok(st.state.goods.mode === "total" && st.state.items.map((i) => i.key).join(",") === "ocean_freight,duty" && st.notices.length === 0, "读回：货品填总数、两项（海运费、关税），没有提示", st.notices);
  ok(LUMP_ADDABLE_KEYS.length === 16 && LUMP_ADDABLE_KEYS.map((k) => LUMP_ITEM_SPEC[k].labelZh).join("、") === "国内运费、报关费、加拿大境内运费、包装、安装、测量、深化图、设备 / 场地、保函、保险、清洁、差旅、项目管理、售后预留、下错单 / 漏单预备金、其它", "「添加一项」清单：任务书的 16 项、顺序相同");
  ok(Object.values(LUMP_ITEM_SPEC).every((s) => (COST_CATEGORIES as readonly string[]).includes(s.category) && (!s.percent || (CALCULATION_TYPES as readonly string[]).includes(s.percent.calculationType))), "每项的类别与比例算法都是报价引擎既有的");

  // 每一项都填金额 → 类别对照；再改成比例
  const all = LUMP_ITEM_KEYS.map((k) => item(k, { kind: "amount", amount: 100, label: k === "other" ? "合成其它费用" : null }));
  const s1 = { ...defaultLumpState(), goods: { ...defaultLumpState().goods, amount: 1000, evidenceKind: "ESTIMATE" as const }, items: all };
  const l1 = save(s1);
  const byKey = new Map(l1.map((l) => [readLumpMeta(l.metadata)?.key, l]));
  const want: Record<string, string> = {
    goods_total: "PROCUREMENT", ocean_freight: "FREIGHT", inland_freight: "FREIGHT", domestic_freight: "LOGISTICS", packaging: "LOGISTICS", customs: "CUSTOMS", duty: "DUTY", installation: "LABOUR", measurement: "LABOUR",
    shop_drawing: "ENGINEERING", equipment_site: "SITE_GENERAL", travel: "SITE_GENERAL", bond: "BOND", insurance: "INSURANCE", project_management: "PROJECT_MANAGEMENT", cleaning: "OTHER", warranty_reserve: "OTHER", other: "OTHER", contingency: "CONTINGENCY",
  };
  const bad = Object.entries(want).filter(([k, cat]) => byKey.get(k)?.category !== cat || byKey.get(k)?.calculationType !== "FIXED");
  ok(bad.length === 0, "每一项填金额：落到对照表里的类别，都是固定金额", bad);
  const pctItems = all.map((i) => (["duty", "bond", "warranty_reserve", "contingency"].includes(i.key) ? { ...i, kind: "percent" as const, amount: null, ratePct: 5 } : i));
  const l2 = save({ ...s1, items: pctItems });
  const k2 = new Map(l2.map((l) => [readLumpMeta(l.metadata)?.key, l]));
  ok(
    k2.get("duty")?.calculationType === "PERCENT_OF_COST" && k2.get("duty")?.calculationBase === "PROCUREMENT" &&
      k2.get("bond")?.calculationType === "PERCENT_OF_REVENUE" && k2.get("bond")?.calculationBase === null &&
      k2.get("warranty_reserve")?.calculationType === "PERCENT_OF_COST" && k2.get("warranty_reserve")?.calculationBase === "DIRECT_COST" &&
      k2.get("contingency")?.calculationType === "PERCENT_OF_COST" && k2.get("contingency")?.calculationBase === "DIRECT_COST",
    "改成比例：关税按采购成本的成本百分比、保函售价百分比、售后预留与预备金按直接成本的成本百分比",
  );
  ok(calc(l2, 20).ok, "全部项都加上后报价引擎照常算得出（validateLines 都接受）");
  ok(item("contingency").kind === "percent" && item("bond").kind === "percent" && item("warranty_reserve").kind === "percent" && item("installation").kind === "amount" && item("duty").kind === "amount", "默认填法：预备金、保函、售后预留默认比例；安装、关税默认金额（判断点 5）");
}

console.log("\n━━━ 3. 校验与范围 ━━━");
{
  const base = acceptance3();
  const issue = (s: LumpState) => {
    const v = validateLumpState(s);
    return v.ok ? null : v.issues.map((i) => i.messageZh).join(" / ");
  };
  ok(issue(base) === null, "验收 3 的状态通过校验");
  const cases: Array<[string, LumpState, string]> = [
    ["海运费 -1", { ...base, items: [item("ocean_freight", { amount: -1 })] }, "海运费"],
    ["保函比例 100", { ...base, items: [item("bond", { ratePct: 100 })] }, "保函"],
    ["安装 12.34567", { ...base, items: [item("installation", { amount: 12.34567 })] }, "安装"],
    ["销售税 HST 101", { ...base, tax: { hstPct: 101, gstPct: null, pstPct: null } }, "销售税 HST"],
    ["美元汇率 0", { ...base, items: [item("ocean_freight", { amount: 8000, currency: "USD" })], fx: { USD: { rate: 0, source: null } } }, "美元"],
  ];
  for (const [name, s, word] of cases) {
    const m = issue(s);
    ok(!!m && m.includes(word), `${name}：校验不过，指到${word}`, m);
  }
  ok(issue({ ...base, items: [item("installation", { amount: 1 }), item("installation", { amount: 2 })] })?.includes("安装只能有一项") === true, "同一项加两次：「安装只能有一项」");
  ok(issue({ ...base, items: [item("other", { amount: 1, label: "  " })] })?.includes("「其它」要填名称") === true, "其它没名称：「「其它」要填名称」");
  ok(issue({ ...base, goods: { ...base.goods, mode: "total" }, details: [rowOf()] })?.includes("货品已展开成明细，要改回填总数请先删掉明细") === true, "货品写着填总数又带明细：校验不过");
  ok(issue({ ...base, goods: { ...base.goods, evidenceKind: null } })?.includes("要选证据类别") === true, "货品总数手填没选证据：校验不过");
  ok(issue({ ...base, items: [item("installation", { kind: "percent", ratePct: 3 })] })?.includes("安装只能填金额") === true, "不能按比例的项填了比例：校验不过");
  // 原样带回的数：转换 / 专业模式写进来的 4 位小数金额、100% 的关税、1,500 字备注
  const back = { ...base, items: [item("ocean_freight", { amount: 3518.505, notes: "合".repeat(1500) }), item("duty", { kind: "percent" as const, ratePct: 100 })] };
  ok(issue(back) === null, "原样带回的数（3,518.505、关税比例 100、1,500 字备注）能原样保存");
  const cn = validateLumpState({ ...base, items: [item("ocean_freight", { amount: 1, notes: "a\u0000b\u202Ec\r\n第二行\tx  " })] });
  ok(cn.ok && cn.state.items[0].notes === "abc\n第二行\tx", "备注去掉控制字符与看不见的格式字符（\u0000 进不了库），保留换行与制表符", cn.ok ? cn.state.items[0].notes : cn);
  const v = validateLumpState({ ...base, items: [item("ocean_freight", { amount: 1000, currency: "USD" })], fx: {} });
  ok(v.ok && v.state.fx.USD?.rate === null, "用到外币没填汇率：汇率表里补一格空的（由引擎提示缺汇率）");
}

console.log("\n━━━ 4. 验收 3 的数、销售税、算式 ━━━");
{
  const lines = save(acceptance3());
  for (const k of ["hstPct", "gstPct", "pstPct"] as const) {
    const r = calc(lines, 25, { [k]: 7 });
    ok(r.ok && r.estimatedCost === 900000 && r.sellingPrice === 1200000 && r.grossProfit === 300000 && r.grossMarginPct === 25 && r.tax.gst + r.tax.hst + r.tax.pst === 84000 && r.tax.total === 1284000, `7% 填进 ${k}：成本 900,000 / 税前 1,200,000 / 税 84,000 / 含税 1,284,000 / 利润 300,000 / 25%`, r.ok ? { c: r.estimatedCost, s: r.sellingPrice, t: r.tax } : r);
  }
  const r = calc(lines, 25, { hstPct: 7 });
  if (r.ok) {
    const f: LumpFormula = { baseCost: r.baseCost, marginPct: r.pricing.marginOnRevenue, revenuePct: r.revenuePctTotal, commission: null, sellingPrice: r.sellingPrice, salesTax: 84000, totalWithTax: r.tax.total };
    const t = lumpFormulaLinesZh(f);
    ok(t[0] === "税前报价 1,200,000.00 = 900,000.00 ÷（1 − 25%）" && t[1] === "含税总价 1,284,000.00 = 1,200,000.00 + 销售税 84,000.00", "算式（预置全关）：写真实算法与这份报价的数", t);
    ok(!t.join("").includes("成本合计 ÷"), "不写「成本合计 ÷（1 − 毛利率）」");
  }
  ok(lumpFormulaLinesZh(null).length === 0, "定价方式不是按售价毛利：没有算式");
  // 开着提成 + 保函 1.5%（按报价）
  const s = acceptance3();
  const l2 = save({ ...s, presets: { ...s.presets, commission: { ratePct: 30, included: true } }, items: [...s.items, item("bond", { ratePct: 1.5 })] });
  const r2 = calc(l2, 25);
  if (r2.ok) {
    const com = r2.lines.find((x) => x.calculationType === "PCT_OF_GROSS_PROFIT")!;
    const f: LumpFormula = { baseCost: r2.baseCost, marginPct: 25, revenuePct: r2.revenuePctTotal, commission: { ratePct: 30, amount: com.amount }, sellingPrice: r2.sellingPrice, salesTax: 0, totalWithTax: r2.tax.total };
    const t = lumpFormulaLinesZh(f);
    const expected = Math.round((r2.baseCost / (1 - 0.265)) * 100) / 100;
    ok(t[0].includes("÷（1 − 25% − 1.5%）") && t[1].startsWith("销售提成 ") && t[1].includes("算进成本合计") && r2.sellingPrice === expected && r2.revenuePctTotal === 1.5, "开着提成与保函：分母「1 − 25% − 1.5%」，另写提成；式子里的数与引擎相同", { t, sp: r2.sellingPrice, expected });
  } else ok(false, "提成 + 保函算得出", r2);
  // 算不出：海运费 8,000 美元、没填汇率
  const l3 = save({ ...acceptance3(), items: [item("ocean_freight", { amount: 8000, currency: "USD" })] });
  const r3 = calc(l3, 25);
  ok(!r3.ok && r3.errors.some((e) => e.code === "FX_REQUIRED"), "海运费 8,000 美元、没填汇率：引擎报缺汇率（页面写要填美元汇率）");
  // 验收 4：开预置的数（钉成常数，隔离库再与专业模式读接口对照）
  const l4 = save({ ...acceptance3(), presets: defaultLumpState().presets });
  const r4 = calc(l4, 25, { hstPct: 7 });
  ok(r4.ok && r4.estimatedCost === 1037322.68 && r4.sellingPrice === 1257360.83 && r4.grossProfit === 220038.15 && r4.grossMarginPct === 17.5, "开四条预置：1,037,322.68 / 1,257,360.83 / 220,038.15 / 17.5%", r4.ok ? [r4.estimatedCost, r4.sellingPrice, r4.grossProfit, r4.grossMarginPct] : r4);
  // 没填的项不计入
  const l5 = save({ ...acceptance3(), items: [...acceptance3().items, item("insurance")] });
  const ins = l5.find((l) => readLumpMeta(l.metadata)?.key === "insurance")!;
  const r5 = calc(l5, 25);
  ok(!ins.included && r5.ok && r5.estimatedCost === 900000, "加了保险没填：不计入，合计与没加时相同");
}

console.log("\n━━━ 5. 往返与专业模式改过后的读法 ━━━");
{
  const s0 = acceptance3();
  const s = { ...s0, items: [...s0.items.map((i) => (i.key === "ocean_freight" ? { ...i, notes: "2 个 40 尺柜" } : i)), item("installation", { amount: 2000 }), item("other", { label: "合成杂费", amount: 50 })], tax: { hstPct: 13, gstPct: null, pstPct: null } };
  const lines = save(s);
  const back = lumpStateFromLines(lines, quoteOf({ rate: 25, tax: s.tax }));
  const strip = (x: LumpState) => ({ ...x, goods: { ...x.goods, costLineId: null }, items: x.items.map((i) => ({ ...i, costLineId: null, seq: null })) });
  ok(isDeepStrictEqual(strip(back.state), strip(validateLumpState(s).ok ? (validateLumpState(s) as { state: LumpState }).state : s)) && back.notices.length === 0, "往返：读回的状态与写入时相同（含备注、其它的名称、税），没有提示", { got: strip(back.state).items, notices: back.notices });
  const again = lumpStateToWrites(back.state, lines);
  ok(again.creates.length === 0 && again.deleteIds.length === 0, "原样再存：不新建、不删，只更新自己管的行");

  // 专业模式改了海运费的算法（按柜计）
  const changed = lines.map((l) => (readLumpMeta(l.metadata)?.key === "ocean_freight" ? { ...l, calculationType: "PER_CONTAINER", duration: new Prisma.Decimal(2), unitCost: new Prisma.Decimal(30000) } : l));
  const r1 = lumpStateFromLines(changed, quoteOf({ rate: 25 }));
  const ocean = changed.find((l) => readLumpMeta(l.metadata)?.key === "ocean_freight")!;
  ok(!r1.state.items.some((i) => i.key === "ocean_freight") && r1.others.some((o) => o.line.id === ocean.id && o.reasonZh === ALGO_CHANGED_REASON_ZH) && r1.notices.some((n) => n.includes("「海运费」在专业模式里改了类别或算法，这张表不再管它（按专业模式里的设置计算")), "专业模式把海运费改成按柜计：归其它成本行并写明", r1.notices);
  const w1 = lumpStateToWrites(r1.state, changed);
  ok(!w1.updates.some((u) => u.id === ocean.id) && !w1.deleteIds.includes(ocean.id), "保存时不碰那一行（不改回、不删）");
  // 改了金额、设成不计入
  const c2 = lines.map((l) => {
    const k = readLumpMeta(l.metadata)?.key;
    if (k === "duty") return { ...l, unitCost: new Prisma.Decimal(42000) };
    if (k === "installation") return { ...l, included: false };
    return l;
  });
  const r2 = lumpStateFromLines(c2, quoteOf({ rate: 25 }));
  const inst = r2.state.items.find((i) => i.key === "installation")!;
  ok(r2.state.items.find((i) => i.key === "duty")?.amount === 42000, "专业模式把关税改成 42,000：按改后的显示");
  ok(inst.amount === null && r2.notices.some((n) => n.includes("「安装」在专业模式里设成了不计入（原来填的是 2,000.00 加元）")), "安装设成不计入：按没填显示并写明原来填的 2,000.00 加元", r2.notices);
  const after2 = apply(c2, lumpStateToWrites(r2.state, c2));
  const instLine = after2.find((l) => readLumpMeta(l.metadata)?.key === "installation")!;
  ok(!instLine.included && Number(instLine.unitCost) === 2000, "保存后安装那一行仍是 2,000、不计入");
  // 人清空一项：数写空
  const cleared = apply(lines, lumpStateToWrites({ ...back.state, items: back.state.items.map((i) => (i.key === "installation" ? { ...i, amount: null } : i)) }, lines));
  const cl = cleared.find((l) => readLumpMeta(l.metadata)?.key === "installation")!;
  ok(!cl.included && cl.unitCost === null && lumpStateFromLines(cleared, quoteOf({ rate: 25 })).notices.length === 0, "人清空安装：不计入、数写空，读回没有「设成了不计入」的提示");
  // 改了说明
  const c3 = lines.map((l) => (readLumpMeta(l.metadata)?.key === "duty" ? { ...l, description: "Duty (manual)" } : l));
  ok(lumpStateFromLines(c3, quoteOf({ rate: 25 })).notices.some((n) => n.includes("「关税」的说明在专业模式里改成了「Duty (manual)」，在这里保存时会改回「关税」")), "专业模式改了说明：写明保存时会改回项目名称");
  // 明细：按件 + 包装数原样往返
  const sd = { ...acceptance3(), goods: { ...acceptance3().goods, mode: "detail" as const }, details: [rowOf({ description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10, basis: "PER_PIECE", unitPrice: 3 }), rowOf({ quantity: 10, unitPrice: 20 })] };
  const ld = save(sd);
  const rd = lumpStateFromLines(ld, quoteOf({ rate: 25 }));
  const rc = calc(ld, 25);
  ok(rd.state.goods.mode === "detail" && rd.state.details[0].basis === "PER_PIECE" && rd.state.details[0].packCount === 10 && rd.state.details[0].unitPrice === 3 && rc.ok && rc.directCost === 20 * 30 + 200 + 100000, "明细：按件报价、每盒 10 件、每件 3 元原样往返，货品计入 600 + 200（总数不计入）", rc.ok ? rc.directCost : rc);
  const gt = ld.find((l) => readLumpMeta(l.metadata)?.key === "goods_total")!;
  ok(!gt.included && Number(gt.unitCost) === 800000, "展开成明细：总数留着（800,000）、不计入");
  // 专业模式加的行与改了定价方式
  const proLine = toDb({ ...lumpStateToWrites(acceptance3(), []).creates[0], description: "合成仓储费", category: "WAREHOUSING", metadata: {}, sortOrder: 5000, unitCost: 300 });
  const withPro = [...lines, proLine];
  const rp = lumpStateFromLines(withPro, quoteOf({ pricingMethod: "MARKUP_ON_COST", rate: 10 }));
  ok(rp.others.some((o) => o.line.id === proLine.id && o.reasonZh === null && !o.fromLump) && rp.state.targetMarginPct === null && !rp.notices.some((n) => n.includes("成本加成")), "专业模式加的仓储费列在其它成本行；定价方式改成成本加成时目标毛利率空着（说明只在定价一行显示一次，不进顶部提示）");
  ok(!lumpStateToWrites(rp.state, withPro).updates.some((u) => u.id === proLine.id), "保存不碰专业模式加的行");
}

console.log("\n━━━ 6. 互转 ━━━");
{
  /** 逐行报价的库行：2 行货品（含一行按件）、2 柜 × 每柜 3,000 美元、报关费 500、关税率 8% */
  const lineState = (): LineModeState => {
    const d = defaultLineModeState([rowOf({ description: "合成卷帘 A", quantity: 100, unitPrice: 50, currency: "CNY" }), rowOf({ description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10, basis: "PER_PIECE", unitPrice: 3, currency: "CNY" })]);
    return { ...d, fx: { CNY: { rate: 0.19, source: "合成" }, USD: { rate: 1.37, source: "合成" } }, shared: { oceanFreight: { containers: 2, perContainer: 3000, currency: "USD" }, customs: { amount: 500, currency: "CAD" }, domesticFreight: { amount: null, currency: "CAD" }, dutyPct: 8 }, targetMarginPct: 22 };
  };
  const lineDb = (s: LineModeState) => stateToWrites(s, []).creates.map((c) => toDb(c));
  const engine: EngineConfig = { tax: { hstPct: 13 } };
  const check = (name: string, lines: DbCostLine[], margin: number, dir: "LUMP_SUM" | "LINE", quoteType = "SUPPLY_ONLY") => {
    const res = dir === "LUMP_SUM" ? convertLineToLump(lines) : convertLumpToLine(lines, quoteType);
    if (!res.ok) {
      ok(false, name, res.reasonZh);
      return null;
    }
    const cmp = compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: margin }, engine, before: inputsOf(lines), after: simulateWrites(lines, res.writes) });
    const after = apply(lines, res.writes);
    const a = calc(lines, margin, engine.tax);
    const b = calc(after, margin, engine.tax);
    ok(cmp.ok && a.ok && b.ok && a.estimatedCost === b.estimatedCost && a.sellingPrice === b.sellingPrice && a.grossProfit === b.grossProfit && a.tax.total === b.tax.total, name, cmp.ok ? null : cmp);
    return after;
  };
  const L1 = lineDb(lineState());
  const toLump = check("逐行 → 总价（外币、按件、报关费、关税率、预置开）：前后成本、税前、利润、税相同", L1, 22, "LUMP_SUM");
  if (toLump) {
    const st = lumpStateFromLines(toLump, quoteOf({ rate: 22 }));
    const oc = st.state.items.find((i) => i.key === "ocean_freight");
    ok(st.state.goods.mode === "detail" && st.state.details.length === 2 && oc?.amount === 6000 && oc.currency === "USD" && st.state.fx.USD?.rate === 1.37 && st.state.items.find((i) => i.key === "customs")?.amount === 500 && st.state.items.find((i) => i.key === "duty")?.ratePct === 8 && st.state.items.find((i) => i.key === "domestic_freight")?.amount === null, "转成总价：明细 2 条、海运费 6,000 美元（汇率不变）、报关费 500、关税按货值 8%、没填的国内运费变成空着的项", st.state.items);
    ok(validateLumpState(st.state).ok && st.notices.length === 0, "转换后的总价表能原样保存、没有提示", st.notices);
    // 总价 → 逐行：保存一次逐行，再转回
    const back = check("总价 → 逐行：前后相同", toLump, 22, "LINE");
    if (back) {
      const ls = costLinesToState(back, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(22) });
      ok(ls.state.rows.length === 2 && ls.state.rows[1].basis === "PER_PIECE" && ls.state.rows[1].unitPrice === 3 && ls.state.shared.customs.amount === 500 && ls.state.shared.dutyPct === 8 && ls.state.shared.oceanFreight.containers === null, "转回逐行：2 行（按件那行仍是每件 3 元）、报关费 500、关税率 8%、海运柜数空着", ls.state.shared);
      ok(ls.notices.some((n) => n.includes("「海运费」按金额算在下面「从只报总价转来的项」里（照样计入），不要再在这里填柜数，否则会算两遍")) && !ls.notices.some((n) => n.includes("删掉了")), "逐行表提示海运费按金额算在「从只报总价转来的项」里，不误报「删掉了」", ls.notices);
      const savedLine = apply(back, stateToWrites(ls.state, back));
      const again = check("总价 → 逐行 → 逐行保存 → 总价：前后相同", savedLine, 22, "LUMP_SUM");
      if (again) {
        const st2 = lumpStateFromLines(again, quoteOf({ rate: 22 }));
        ok(st2.state.items.filter((i) => i.key === "ocean_freight").length === 1 && st2.state.items.find((i) => i.key === "ocean_freight")?.amount === 6000 && indexLumpLines(again).others.length === 0, "再转回总价：只有一项海运费（6,000），没有多出来的行", st2.state.items.map((i) => [i.key, i.amount]));
      }
    }
  }
  // 多组数据
  const variants: Array<[string, LineModeState]> = [
    ["没有外币、预置全关", { ...lineState(), fx: {}, rows: lineState().rows.map((r) => ({ ...r, currency: "CAD" })), shared: { ...lineState().shared, oceanFreight: { containers: 1, perContainer: 2500, currency: "CAD" } }, presets: presetsOff({ ...defaultLumpState(), presets: lineState().presets }).presets }],
    ["空着的海运与关税", { ...lineState(), shared: { oceanFreight: { containers: null, perContainer: 3000, currency: "USD" }, customs: { amount: null, currency: "CAD" }, domesticFreight: { amount: 1200, currency: "CNY" }, dutyPct: null } }],
    ["1.5 柜（金额 4 位小数内）", { ...lineState(), shared: { ...lineState().shared, oceanFreight: { containers: 1.5, perContainer: 2345.67, currency: "CAD" } } }],
  ];
  for (const [name, s] of variants) {
    const d = lineDb(s);
    const pro = toDb({ ...stateToWrites(s, []).creates[0], description: "合成其它人民币费用", category: "WAREHOUSING", metadata: {}, sortOrder: 5000, unitCost: 1000, sourceCurrency: "CNY", fxRate: 0.19 });
    const lumpSide = check(`逐行 → 总价（${name}，带专业模式加的行）：前后相同`, [...d, pro], 18, "LUMP_SUM");
    if (lumpSide) check(`总价 → 逐行（${name}）：前后相同`, lumpSide, 18, "LINE");
  }
  // 会差几分
  const tiny = lineDb({ ...lineState(), fx: {}, rows: [rowOf()], shared: { oceanFreight: { containers: 1.5, perContainer: 0.0033, currency: "CAD" }, customs: { amount: null, currency: "CAD" }, domesticFreight: { amount: null, currency: "CAD" }, dutyPct: null } });
  const tr = convertLineToLump(tiny);
  const tcmp = tr.ok ? compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, engine: {}, before: inputsOf(tiny), after: simulateWrites(tiny, tr.writes), hintZh: convertHintZh(tiny, "LUMP_SUM") }) : null;
  ok(!!tcmp && !tcmp.ok && tcmp.reasonZh.includes("会差") && tcmp.reasonZh.includes("两位小数"), "海运 1.5 柜 × 每柜 0.0033 换成金额会差一分：不转，写明差多少与怎么办", tcmp);
  // 同一项两边都有
  const dupLump = [...L1, toDb(lumpStateToWrites({ ...defaultLumpState(), items: [item("duty", { amount: 999 })] }, []).creates.find((c) => readLumpMeta(c.metadata)?.key === "duty")!)];
  const dr = convertLineToLump(dupLump);
  ok(!dr.ok && dr.reasonZh.startsWith("转换后会有两项关税：请先在逐行表里清掉关税率，或在专业模式里删掉另一条"), "逐行表填了关税率、另有一条有数的总价关税：不转并写明", dr);
  // 共用参数的算法在专业模式里改过
  const algo = L1.map((l) => (readBidLineMeta(l.metadata)?.role === "shared" && (readBidLineMeta(l.metadata) as { key: string }).key === "ocean_freight" ? { ...l, calculationType: "FIXED" } : l));
  const ar = convertLineToLump(algo);
  ok(!ar.ok && ar.reasonZh.includes("「海运费」的类别或算法在专业模式里改过") && ar.reasonZh.includes("先在逐行表里保存一次"), "共用参数的算法在专业模式里改过：不转，写明先在逐行表里保存一次", ar);
  // 总价 → 逐行不能转的情况
  const lt = save(acceptance3());
  const n1 = convertLumpToLine(lt, "SUPPLY_ONLY");
  const n2 = convertLumpToLine(save({ ...acceptance3(), goods: { ...acceptance3().goods, mode: "detail" }, details: [rowOf()] }), "PROJECT_SUPPLY_INSTALL");
  const both = save({ ...acceptance3(), goods: { ...acceptance3().goods, mode: "detail" }, details: [rowOf()] }).map((l) => (readLumpMeta(l.metadata)?.key === "goods_total" ? { ...l, included: true } : l));
  const n3 = convertLumpToLine(both, "SUPPLY_ONLY");
  ok(!n1.ok && n1.reasonZh === "货品是一个总数，先展开成明细再转成逐行报价" && !n2.ok && n2.reasonZh.includes("逐行报价限于只供货的报价") && !n3.ok && n3.reasonZh.includes("先在总价表里保存一次"), "货品是总数 / 供货加安装 / 总数和明细都计入：都不转并写明", [n1, n2, n3]);
}

console.log("\n━━━ 6b. 互转的性质与边界（审查补充） ━━━");
{
  // 库里读出的顺序（sortOrder，同序按 id）——引擎按行的先后累加
  const dbOrder = (ls: DbCostLine[]) => [...ls].sort((x, y) => x.sortOrder - y.sortOrder || x.id.localeCompare(y.id));
  const run = (ls: DbCostLine[], margin: number, tax: EngineConfig["tax"]) => computeQuote({ quoteCurrency: "CAD", lines: inputsOf(dbOrder(ls)), pricing: { method: "MARGIN_ON_REVENUE", rate: margin }, engine: { tax } });
  let seed = 20261123;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const money2 = (max: number) => Math.round(rnd() * max * 100) / 100;
  let passed = 0, refused = 0;
  const bad: unknown[] = [];
  for (let n = 0; n < 300; n++) {
    const margin = Math.round(rnd() * 30 * 10) / 10;
    const tax = { hstPct: rnd() < 0.5 ? 13 : null, gstPct: null, pstPct: null };
    const detailRows = [rowOf({ quantity: 1 + Math.floor(rnd() * 900), unitPrice: money2(300) }), ...(rnd() < 0.5 ? [rowOf({ description: "合成配件 B", quantity: 1 + Math.floor(rnd() * 50), unitPrice: money2(80) })] : [])];
    const items = [
      item("ocean_freight", { amount: rnd() < 0.8 ? money2(12000) : null }),
      item("duty", rnd() < 0.5 ? { kind: "percent", ratePct: Math.round(rnd() * 15 * 10) / 10 } : { amount: rnd() < 0.5 ? money2(9000) : null }),
      item("domestic_freight", { amount: rnd() < 0.7 ? money2(4000) : null }),
      item("customs", { amount: rnd() < 0.7 ? money2(2500) : null }),
      ...(rnd() < 0.6 ? [item("contingency", { ratePct: Math.round(rnd() * 5 * 10) / 10 })] : []),
      ...(rnd() < 0.4 ? [item("installation", { amount: money2(20000) })] : []),
    ];
    const s0 = defaultLumpState();
    const st: LumpState = { ...s0, goods: { ...s0.goods, mode: "detail" }, details: detailRows, items, tax, targetMarginPct: margin, presets: rnd() < 0.3 ? presetsOff(s0).presets : s0.presets };
    const lump = save(st);
    const res = convertLumpToLine(lump, "SUPPLY_ONLY");
    if (!res.ok) { bad.push(["lump→line 拒绝", res.reasonZh]); continue; }
    const before = run(lump, margin, tax);
    const cmp = compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: margin }, engine: { tax }, before: inputsOf(dbOrder(lump)), after: simulateWrites(lump, res.writes) });
    const after = run(apply(lump, res.writes), margin, tax);
    if (!cmp.ok) { refused++; continue; }
    passed++;
    if (!(before.ok && after.ok && before.estimatedCost === after.estimatedCost && before.sellingPrice === after.sellingPrice && before.grossProfit === after.grossProfit && before.tax.total === after.tax.total)) bad.push(["核对放行但按库里顺序算不同", n]);
    const back = convertLineToLump(apply(lump, res.writes));
    if (!back.ok) continue;
    const line = apply(lump, res.writes);
    const cmp2 = compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: margin }, engine: { tax }, before: inputsOf(dbOrder(line)), after: simulateWrites(line, back.writes) });
    const after2 = run(apply(line, back.writes), margin, tax);
    if (cmp2.ok && !(after.ok && after2.ok && after.sellingPrice === after2.sellingPrice && after.estimatedCost === after2.estimatedCost)) bad.push(["逐行→总价 核对放行但按库里顺序算不同", n]);
  }
  // 审查找到的反例（行的先后会让预备金差一分）：核对必须拦下，或放行时按库里顺序算也相同
  {
    const s0 = defaultLumpState();
    const fixed: LumpState = { ...s0, goods: { ...s0.goods, mode: "detail" }, details: [rowOf({ quantity: 1, unitPrice: 78260.73, currency: "CAD" })], items: [item("ocean_freight", { amount: 8522.32 }), item("duty"), item("domestic_freight", { amount: 2390.06 }), item("customs", { amount: 1802.39 }), item("contingency", { ratePct: 3 })], tax: { hstPct: 13, gstPct: null, pstPct: null }, targetMarginPct: 20 };
    const fl = save(fixed);
    const fr = convertLumpToLine(fl, "SUPPLY_ONLY");
    const fb = run(fl, 20, fixed.tax);
    const fa = fr.ok ? run(apply(fl, fr.writes), 20, fixed.tax) : null;
    const fc = fr.ok ? compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, engine: { tax: fixed.tax }, before: inputsOf(dbOrder(fl)), after: simulateWrites(fl, fr.writes) }) : null;
    const differs = !!fa && fb.ok && fa.ok && (fb.estimatedCost !== fa.estimatedCost || fb.sellingPrice !== fa.sellingPrice);
    ok(!!fc && (fc.ok ? !differs : true) && (!differs || !fc.ok), "审查反例（明细 78,260.73、海运 8,522.32、国内运费 2,390.06、报关费 1,802.39、预备金 3%）：按库里顺序算会差一分时核对拦下", { differs, fc });
  }
  ok(bad.length === 0 && passed > 200, `300 组随机数据两个方向转换：核对放行的（${passed} 组）按库里读出的顺序算，前后成本合计、税前报价、利润、含税总价都相同；核对拦下 ${refused} 组`, bad.slice(0, 5));

  // 逐行表的海运费计入、每柜金额在专业模式里清空（未定价）：转成总价后仍是未定价，不变成「已定价 0」
  const ls = defaultLineModeState([rowOf()]);
  const lineDb2 = stateToWrites({ ...ls, shared: { ...ls.shared, oceanFreight: { containers: 2, perContainer: 3000, currency: "CAD" } }, targetMarginPct: 20 }, []).creates.map((c) => toDb(c));
  const cleared = lineDb2.map((l) => (readBidLineMeta(l.metadata)?.role === "shared" && l.calculationType === "PER_CONTAINER" ? { ...l, unitCost: null } : l));
  const cr = convertLineToLump(cleared);
  const cAfter = cr.ok ? apply(cleared, cr.writes) : [];
  const oc = cAfter.find((l) => readLumpMeta(l.metadata)?.key === "ocean_freight");
  const wBefore = run(cleared, 20, {});
  const wAfter = run(cAfter, 20, {});
  ok(cr.ok && !!oc && oc.included && oc.unitCost === null && wBefore.ok && wAfter.ok && wAfter.warnings.some((w) => w.code === "LINE_UNPRICED") && wBefore.warnings.filter((w) => w.code === "LINE_UNPRICED").length === wAfter.warnings.filter((w) => w.code === "LINE_UNPRICED").length, "海运费计入但每柜金额被清空（未定价）：转成总价后仍是未定价、金额空着");
  // 引擎核对也比未定价的行数
  const fakeAfter = inputsOf(dbOrder(cAfter)).map((l) => (l.calculationType === "FIXED" && l.category === "FREIGHT" ? { ...l, unitCost: 0 } : l));
  const fake = compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, engine: {}, before: inputsOf(dbOrder(cleared)), after: fakeAfter });
  ok(!fake.ok && fake.reasonZh.includes("会被当成已填 0"), "核对：转换后未定价的行变少（未定价被当成已填 0）就不转", fake);
  // 未定价变多是更保守的方向：还没有货品行的逐行报价（刚新建、没有价格表）照样能转成总价
  const emptyLine = stateToWrites({ ...defaultLineModeState([]), shared: { ...defaultLineModeState([]).shared, customs: { amount: 500, currency: "CAD" } }, targetMarginPct: 20 }, []).creates.map((c) => toDb(c));
  const er = convertLineToLump(emptyLine);
  const ecmp = er.ok ? compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, engine: {}, before: inputsOf(dbOrder(emptyLine)), after: simulateWrites(emptyLine, er.writes) }) : null;
  ok(!!ecmp && ecmp.ok, "还没有货品行的逐行报价（只填了报关费）转成总价：能转（新建的货品总数空着、按未定价提示）", (ecmp ?? er));
  // 计入了但没填数的项：读出时照实提示，保存会改成不计入
  const incEmpty = cAfter.length ? lumpStateFromLines(cAfter, quoteOf({ rate: 20 })) : null;
  ok(!!incEmpty && incEmpty.notices.some((n) => n.includes("「海运费」计入了但没填数") && n.includes("保存会改成不计入")), "海运费计入了但没填数（未定价）：读出时写明保存会改成不计入", incEmpty?.notices);
  // 提示原因：海运按柜换成金额没有真的四舍五入（2 柜 × 3,000）时，不说是海运取整
  ok(convertHintZh(lineDb2, "LUMP_SUM") === undefined && typeof convertHintZh(stateToWrites({ ...ls, shared: { ...ls.shared, oceanFreight: { containers: 1.5, perContainer: 0.0033, currency: "CAD" } } }, []).creates.map((c) => toDb(c)), "LUMP_SUM") === "string", "提示原因：只有海运换成金额真的要四舍五入时才说是海运取整，否则按行的先后说");
  // 专业模式改了预备金的基数：归其它成本行、保存不改回
  const cb = save({ ...acceptance3(), items: [...acceptance3().items, item("contingency", { ratePct: 3 })] });
  const cbChanged = cb.map((l) => (readLumpMeta(l.metadata)?.key === "contingency" ? { ...l, calculationBase: "LANDED" } : l));
  const cbr = lumpStateFromLines(cbChanged, quoteOf({ rate: 25 }));
  const cbLine = cbChanged.find((l) => readLumpMeta(l.metadata)?.key === "contingency")!;
  ok(!cbr.state.items.some((i) => i.key === "contingency") && cbr.others.some((o) => o.line.id === cbLine.id) && !lumpStateToWrites(cbr.state, cbChanged).updates.some((u) => u.id === cbLine.id), "专业模式把预备金的基数改成到岸成本：归其它成本行，保存不改回");
  // 同一项两条：只管排在前面的那条，多出来的归其它成本行
  const dupIns = [...cb, toDb({ ...lumpStateToWrites({ ...defaultLumpState(), items: [item("installation", { amount: 2 })] }, []).creates.find((c) => readLumpMeta(c.metadata)?.key === "installation")!, sortOrder: 9000 }), toDb({ ...lumpStateToWrites({ ...defaultLumpState(), items: [item("installation", { amount: 1 })] }, []).creates.find((c) => readLumpMeta(c.metadata)?.key === "installation")!, sortOrder: 3070 })];
  const dr2 = lumpStateFromLines(dupIns, quoteOf({ rate: 25 }));
  ok(dr2.state.items.filter((i) => i.key === "installation").length === 1 && dr2.state.items.find((i) => i.key === "installation")?.amount === 1 && dr2.others.some((o) => Number(o.line.unitCost) === 2 && o.reasonZh?.includes("同一项有两条")), "库里同一项有两条安装：只管排在前面的那条（1），另一条（2）归其它成本行并写明", dr2.state.items.map((i) => [i.key, i.amount]));
  // 海运按柜、专业模式填了数量：换成金额 = 数量 × 柜数 × 每柜
  const qOcean = lineDb2.map((l) => (readBidLineMeta(l.metadata)?.role === "shared" && l.calculationType === "PER_CONTAINER" ? { ...l, quantity: new Prisma.Decimal(3) } : l));
  const qr = convertLineToLump(qOcean);
  const qAmt = qr.ok ? qr.writes.updates.find((u) => readLumpMeta(u.data.metadata)?.key === "ocean_freight")?.data.unitCost : null;
  ok(qAmt === 18000 && qr.ok && compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 20 }, engine: {}, before: inputsOf(dbOrder(qOcean)), after: simulateWrites(qOcean, qr.writes) }).ok, "海运按柜、专业模式把数量改成 3：换成金额 3 × 2 柜 × 3,000 = 18,000，前后相同", qAmt);

  // 总价表那一项空着、另有一条计入的同名共用参数（逐行留下的）：转逐行时留下计入的那条，删掉空着的总价项
  const sLump = save({ ...acceptance3(), goods: { ...acceptance3().goods, mode: "detail" }, details: [rowOf()], items: [item("ocean_freight", { amount: 60000 }), item("duty", { amount: 40000 }), item("customs")] });
  const leftCustoms = toDb(stateToWrites({ ...defaultLineModeState([]), shared: { ...defaultLineModeState([]).shared, customs: { amount: 777, currency: "CAD" } } }, []).creates.find((c) => readBidLineMeta(c.metadata)?.role === "shared" && c.category === "CUSTOMS")!);
  const withLeft = [...sLump, leftCustoms];
  const lr = convertLumpToLine(withLeft, "SUPPLY_ONLY");
  const emptyCustoms = sLump.find((l) => readLumpMeta(l.metadata)?.key === "customs")!;
  ok(lr.ok && !lr.writes.deleteIds.includes(leftCustoms.id) && lr.writes.deleteIds.includes(emptyCustoms.id) && compareEngine({ quoteCurrency: "CAD", pricing: { method: "MARGIN_ON_REVENUE", rate: 25 }, engine: {}, before: inputsOf(dbOrder(withLeft)), after: simulateWrites(withLeft, lr.writes) }).ok, "总价表的报关费空着、另有计入的逐行报关费 777：转逐行留下 777 那条、删掉空着的总价项，前后相同", lr);
  // 子类别照原样留着
  const subLump = save({ ...acceptance3(), goods: { ...acceptance3().goods, mode: "detail" }, details: [rowOf()], items: [item("customs", { amount: 500 })] }).map((l) => (readLumpMeta(l.metadata)?.key === "customs" ? { ...l, subcategory: null } : l));
  const sr = convertLumpToLine(subLump, "SUPPLY_ONLY");
  const sc = sr.ok ? sr.writes.updates.find((u) => u.id === subLump.find((l) => readLumpMeta(l.metadata)?.key === "customs")!.id) : null;
  ok(!!sc && sc.data.subcategory === null, "总价 → 逐行：子类别照原样留着（不换成模板的）");

  // 专业模式把货品总数改成按件计：不误报「删掉了」，空着保存时新建的总数不计入（不算两遍、不凭空多一条未定价）
  const g0 = save(acceptance3());
  const gChanged = g0.map((l) => (readLumpMeta(l.metadata)?.key === "goods_total" ? { ...l, calculationType: "PER_UNIT", quantity: new Prisma.Decimal(1) } : l));
  const gr = lumpStateFromLines(gChanged, quoteOf({ rate: 25 }));
  ok(!gr.notices.some((n) => n.includes("删掉了")) && gr.notices.some((n) => n.includes("算两遍")) && gr.state.goods.costLineId === null, "货品总数在专业模式里改了算法：提示照样计入、再填会算两遍，不说「删掉了」", gr.notices);
  const gw = lumpStateToWrites(gr.state, gChanged);
  const newGt = gw.creates.find((c) => readLumpMeta(c.metadata)?.key === "goods_total");
  const gCalc = run(apply(gChanged, gw), 25, {});
  const gCalc0 = run(gChanged, 25, {});
  ok(!!newGt && !newGt.included && gCalc.ok && gCalc0.ok && gCalc.estimatedCost === gCalc0.estimatedCost && !gCalc.warnings.some((w) => w.code === "LINE_UNPRICED"), "原样保存：新建的货品总数不计入，合计不变、没有凭空多一条未定价");
}

console.log("\n━━━ 7. 接口写法与不写的地方 ━━━");
{
  const routes: Array<[string, string, string]> = [
    ["src/app/api/projects/[id]/bid-page/quotes/[quoteId]/lump/route.ts", "GET", "internal_cost"],
    ["src/app/api/projects/[id]/bid-page/quotes/[quoteId]/lump/route.ts", "PUT", "edit"],
    ["src/app/api/projects/[id]/bid-page/quotes/[quoteId]/convert/route.ts", "POST", "edit"],
  ];
  for (const [file, method, level] of routes) {
    const src = stripComments(read(file));
    const body = src.slice(src.indexOf(`export async function ${method}(`));
    const re = new RegExp(
      `^export async function ${method}\\([^)]*\\)[^{]*\\{\\s*const \\{ id: projectId, quoteId \\} = await params;\\s*const access = await requireQuoteAccess\\(request, projectId, "${level}"\\);\\s*if \\(access instanceof NextResponse\\) return access;\\s*const gate = await lineModeGate\\(access\\);\\s*if \\(gate instanceof NextResponse\\) return gate;`,
    );
    ok(re.test(body), `${file.replace("src/app/api/projects/[id]/", "")} ${method}：第一句报价权限守卫（${level}）并紧接着检查，之后是开关与金额门`);
  }
  const svc = stripComments(read("src/lib/bid-page-v2/lump-sum/service.ts"));
  ok(!/quoteLineItem|lineItems\s*:\s*\{\s*create/.test(svc) && !/bidIntelligenceRoom/.test(svc) && !/saveWorkspaceBlocks/.test(svc), "服务不写给客户报价单的明细行、不写投标工作区");
  ok(/computeForQuote\(q\)/.test(svc) && /updatedAt: q\.updatedAt/.test(svc) && /compareEngine\(/.test(svc), "数只来自报价引擎；保存与转换按读取时的修改时间占住报价；转换前用引擎核对");
  const calcSrc = read("src/lib/quote-engine/calc.ts");
  ok(!/LUMP_SUM|entryMode/.test(calcSrc), "报价引擎的计算不读做法字段（calc.ts 不动）");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
