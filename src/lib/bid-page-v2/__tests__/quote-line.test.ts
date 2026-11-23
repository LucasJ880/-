/**
 * BIDPAGE-3 逐行报价（纯函数，无 DB / 网络 / 模型）：词表对照、报价配置的做法字段、模板对照、状态 ↔ 成本行往返、
 * 只动自己管的行、专业模式改过后的读法、四个数与报价引擎相同、按引擎结果分摊的不变量与差额上限、校验、粘贴、旧草稿导入、接口源码写法
 * （openspec change quote-line-mode-persist，spec tender/quote-line-mode）
 * 运行：npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { QUOTE_EVIDENCE_KINDS, QUOTE_EVIDENCE_LABELS_ZH } from "@/lib/tender-bid-cost/contract";
import { GROUPED_UOMS, PRICE_SCHEDULE_UOMS } from "@/lib/tender-price-schedule/contract";
import { QUOTE_BASES } from "@/lib/tender-price-schedule/unit-conversion";
import { z } from "zod";
import { PRICING_METHODS, QUOTE_CURRENCIES, QUOTE_ENGINE_CALC_VERSION, engineConfigSchema, quoteHeaderSchema, type CostLineInput } from "@/lib/quote-engine/contract";
import { computeQuote, round2 } from "@/lib/quote-engine/calc";
import { templateSupplyOnlyLines } from "@/lib/quote-engine/templates";
import { emptyCostDraft, parseCostDraft } from "@/lib/tender-bid-workspace/cost-draft";
import { parseSchedulePaste } from "@/lib/tender-bid-workspace/paste-import";
import {
  LINE_EVIDENCE_KINDS,
  LINE_EVIDENCE_LABELS_ZH,
  LINE_GROUPED_UOMS,
  LINE_QUOTE_BASES,
  LINE_UOMS,
  isLineModeQuote as isLineModeQuoteContract,
  parseNumInput,
  quoteDisplayName,
  readBidLineMeta,
  remainingPasteText,
  rowsFromParsed,
  validateLineModeState,
  type LineModeState,
  type LineRow,
} from "../quote-line/contract";
import { costLinesToState, defaultLineModeState, linePrefillMessageZh, lineModeTemplate, seedRowsFromSchedule, stateToWrites, type CostLineWrite, type DbCostLine } from "../quote-line/mapping";
import { allocateFromEngine, diffBoundOf, exportUnitPrices } from "../quote-line/allocation";
import { importCostDraft, draftHasLines, draftToPrompt } from "../quote-line/draft-import";
import { buildLineComputed, csvSafeText, isLineModeQuote } from "../quote-line/service";
import { BID_PAGE_RULE_TARGET, decideBidPageNextStep, type BidPageFacts } from "../next-step";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 800)}`}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/* ------------------------------ 合成数据 ------------------------------ */

const row = (p: Partial<LineRow>): LineRow => ({ costLineId: null, description: "合成品名", quantity: 1, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: null, currency: "CNY", evidenceKind: null, inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual", ...p });

/** 两行合成报价 + 共用参数 + 模板预置 + 目标毛利率 25%（验收用的合成数字） */
function sampleState(): LineModeState {
  const s = defaultLineModeState([
    row({ description: "合成卷帘 A", quantity: 100, unitPrice: 50, evidenceKind: "ESTIMATE", rowSource: "schedule" }),
    row({ description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10, basis: "PER_PIECE", unitPrice: 30, evidenceKind: "SIGNED_QUOTE", rowSource: "schedule" }),
  ]);
  return {
    ...s,
    fx: { CNY: { rate: 0.19, source: "合成汇率" } },
    shared: { oceanFreight: { containers: 1, perContainer: 3000, currency: "CAD" }, customs: { amount: 250, currency: "CAD" }, domesticFreight: { amount: 1500, currency: "CNY" }, dutyPct: 8 },
    targetMarginPct: 25,
  };
}

let idSeq = 0;
const dec = (v: number | null) => (v == null ? null : new Prisma.Decimal(new Prisma.Decimal(v.toFixed(8)).toDecimalPlaces(v === Math.trunc(v) ? 0 : 8)));
/** 把要写的行变成「库里的行」（Decimal(18,4) 等精度照库：unitCost / quantity 取 4 位） */
function toDb(w: CostLineWrite, id?: string): DbCostLine {
  const d4 = (v: number | null) => (v == null ? null : new Prisma.Decimal(v).toDecimalPlaces(4));
  return {
    id: id ?? `cl_${++idSeq}`,
    sortOrder: w.sortOrder,
    category: w.category,
    subcategory: w.subcategory,
    description: w.description,
    quantity: d4(w.quantity),
    unit: w.unit,
    unitCost: d4(w.unitCost),
    sourceCurrency: w.sourceCurrency,
    fxRate: w.fxRate == null ? null : new Prisma.Decimal(w.fxRate).toDecimalPlaces(8),
    fxRateSource: w.fxRateSource,
    calculationType: w.calculationType,
    calculationBase: w.calculationBase,
    rate: w.rate == null ? null : new Prisma.Decimal(w.rate).toDecimalPlaces(4),
    duration: d4(w.duration),
    supplierId: w.supplierId,
    supplierName: w.supplierName,
    source: w.source,
    notes: null,
    included: w.included,
    metadata: JSON.parse(JSON.stringify(w.metadata)),
  };
}
void dec;
const toInput = (l: DbCostLine): CostLineInput => ({
  id: l.id,
  sortOrder: l.sortOrder,
  category: l.category,
  subcategory: l.subcategory,
  description: l.description,
  quantity: l.quantity == null ? null : Number(l.quantity),
  unit: l.unit,
  unitCost: l.unitCost == null ? null : Number(l.unitCost),
  sourceCurrency: l.sourceCurrency,
  fxRate: l.fxRate == null ? null : Number(l.fxRate),
  calculationType: l.calculationType,
  calculationBase: l.calculationBase,
  rate: l.rate == null ? null : Number(l.rate),
  duration: l.duration == null ? null : Number(l.duration),
  included: l.included,
  supplierName: l.supplierName,
  notes: l.notes,
});
function persist(state: LineModeState, current: DbCostLine[] = []): DbCostLine[] {
  const w = stateToWrites(state, current);
  const kept = current.filter((l) => !w.deleteIds.includes(l.id)).map((l) => {
    const u = w.updates.find((x) => x.id === l.id);
    return u ? toDb(u.data, l.id) : l;
  });
  return [...kept, ...w.creates.map((c) => toDb(c))];
}
const fakeQuote = (lines: DbCostLine[], over: Partial<{ pricingMethod: string; pricingRate: number | null; engineJson: unknown; status: string }> = {}) =>
  ({
    id: "q_1",
    projectId: "p_1",
    orgId: "o_1",
    quoteType: "SUPPLY_ONLY",
    currency: "CAD",
    status: over.status ?? "draft",
    pricingMethod: over.pricingMethod ?? "MARGIN_ON_REVENUE",
    pricingRate: over.pricingRate == null ? null : new Prisma.Decimal(over.pricingRate),
    engineJson: over.engineJson ?? { tax: { hstPct: null, gstPct: null, pstPct: null }, entryMode: "LINE" },
    summaryJson: null,
    calcVersion: QUOTE_ENGINE_CALC_VERSION,
    costLines: lines,
    pricingTiers: [],
    lineItems: [],
  }) as never;

/* ------------------------------ 1. 词表与模板 ------------------------------ */
console.log("\n━━━ 1. 词表、做法字段与模板对照 ━━━");
{
  ok(eq(LINE_EVIDENCE_KINDS, QUOTE_EVIDENCE_KINDS) && eq(LINE_EVIDENCE_LABELS_ZH, QUOTE_EVIDENCE_LABELS_ZH), "证据类别与 tender-bid-cost 的词表、中文名逐项相同");
  ok(eq(LINE_UOMS, PRICE_SCHEDULE_UOMS) && eq(LINE_GROUPED_UOMS, GROUPED_UOMS), "单位与成组单位与价格表的词表逐项相同");
  ok(eq([...LINE_QUOTE_BASES].sort(), [...QUOTE_BASES].sort()), "报价口径与价格表换算的口径相同");
  ok(QUOTE_ENGINE_CALC_VERSION === "quote-engine-calc/v2", "报价引擎算法版本号没改");

  // 改前的两个 schema 原样冻结在这里（取自 b717427f 的 src/lib/quote-engine/contract.ts），不从新 schema 推出来
  const num = (min?: number) => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.number().finite().min(min ?? -Infinity).nullable());
  const oldSchema = z.object({
    scenarios: z.array(z.object({ key: z.string().min(1).max(30), labelZh: z.string().max(40), method: z.enum(PRICING_METHODS), rate: z.number().finite() })).max(6).optional(),
    tax: z.object({ gstPct: num(0).optional(), hstPct: num(0).optional(), pstPct: num(0).optional() }).optional(),
    standingOffer: z
      .object({
        supplierCostPerPiece: num(0),
        supplierCurrency: z.string().max(3).nullable().optional(),
        fxRate: num(0).optional(),
        piecesPerBox: num(0),
        boxesPerContainer: num(0),
        moq: num(0).optional(),
        annualQuantity: num(0).optional(),
        freightPerContainer: num(0).optional(),
        customsPerContainer: num(0).optional(),
        dutyPct: num(0).optional(),
        warehousePerContainer: num(0).optional(),
        otherPerContainer: num(0).optional(),
        inventoryCarryingPct: num(0).optional(),
      })
      .nullable()
      .optional(),
    marginRiskPct: z.object({ high: z.number().finite(), medium: z.number().finite() }).optional(),
  });
  const oldHeader = z.object({
    name: z.string().max(160).nullable().optional(),
    quoteNumber: z.string().max(60).nullable().optional(),
    currency: z.enum(QUOTE_CURRENCIES).optional(),
    pricingMethod: z.enum(PRICING_METHODS).optional(),
    pricingRate: num(),
    internalNotes: z.string().max(4000).nullable().optional(),
    engine: oldSchema.optional(),
  });
  const samples: unknown[] = [
    {},
    { tax: { hstPct: 13, gstPct: null, pstPct: null } },
    { tax: { hstPct: null, gstPct: null, pstPct: null }, scenarios: [{ key: "a", labelZh: "进攻", method: "MARGIN_ON_REVENUE", rate: 8 }] },
    { standingOffer: { supplierCostPerPiece: 2, supplierCurrency: "CNY", fxRate: 0.19, piecesPerBox: 10, boxesPerContainer: 100 }, marginRiskPct: { high: 5, medium: 10 } },
    { tax: { hstPct: 13 }, somethingUnknown: 1, legacy: { a: 1 } },
  ];
  ok(
    samples.every((s) => {
      const a = engineConfigSchema.parse(s) as Record<string, unknown>;
      const b = oldSchema.parse(s) as Record<string, unknown>;
      return isDeepStrictEqual(a, b) && !Object.keys(a).includes("entryMode");
    }),
    "没有做法字段的配置：解析结果与改前（冻结的旧 schema）深度相同、键集合相同（不多出 entryMode 键；未知键被剥除）",
  );
  const headers: unknown[] = [{}, { name: "合成", pricingMethod: "MARKUP_ON_COST", pricingRate: "" }, { engine: {} }, { engine: { tax: { hstPct: 13 }, x: 1 } }, { engine: { entryMode: "LINE" } }, { currency: "USD", engine: { standingOffer: null } }];
  ok(headers.every((h) => isDeepStrictEqual(quoteHeaderSchema.parse(h), oldHeader.parse(h))), "专业模式保存的报价表头：解析结果与改前（冻结的旧 schema）深度相同（含请求里带了 entryMode 的情况）");
  const hdr = quoteHeaderSchema.parse({ engine: { entryMode: "LINE", tax: { hstPct: 13 } } }).engine as Record<string, unknown>;
  ok(!Object.keys(hdr).includes("entryMode") && (hdr.tax as { hstPct: number }).hstPct === 13, "专业模式保存（报价表头）不收做法字段：手工请求带 entryMode 也写不进去（开关关时与改前相同）", hdr);
  const dbEngine = engineConfigSchema.parse({ tax: { hstPct: 13 }, entryMode: "LINE" });
  const patched = [{ entryMode: null }, { entryMode: "LUMP_SUM" }, {}].map((e) => engineConfigSchema.parse({ ...dbEngine, ...quoteHeaderSchema.parse({ engine: e }).engine }).entryMode);
  ok(patched.every((m) => m === "LINE"), "库里已是逐行报价：专业模式保存传 null / 不认识的值 / 空配置，合并后做法都还在", patched);
  ok(engineConfigSchema.parse({ tax: {}, entryMode: "LINE" }).entryMode === "LINE", "做法字段 LINE 被接受并保留");
  const unknown = engineConfigSchema.safeParse({ tax: { hstPct: 13 }, scenarios: [{ key: "a", labelZh: "进攻", method: "MARGIN_ON_REVENUE", rate: 8 }], entryMode: "LUMP_SUM" });
  ok(unknown.success && unknown.data.entryMode === undefined && unknown.data.tax?.hstPct === 13 && unknown.data.scenarios?.length === 1, "不认识的做法值（如回退后留下的 LUMP_SUM）：只丢掉这个字段，税与情景照旧，整份配置不失败", unknown);
  const merged = engineConfigSchema.parse({ ...engineConfigSchema.parse({ tax: {}, entryMode: "LINE" }), ...engineConfigSchema.parse({}) });
  ok(merged.entryMode === "LINE", "专业模式保存时回写空配置 {}：合并后做法字段还在（updateEngineQuote 的合并顺序）");
  ok(
    isLineModeQuote({ engineJson: { entryMode: "LINE" }, quoteType: "SUPPLY_ONLY" }) && !isLineModeQuote({ engineJson: { tax: {} }, quoteType: "SUPPLY_ONLY" }) && !isLineModeQuote({ engineJson: null, quoteType: "SUPPLY_ONLY" }),
    "有做法字段才是逐行报价；旧报价（没有字段）按专业模式打开",
  );
  ok(!isLineModeQuote({ engineJson: { entryMode: "LINE" }, quoteType: "PROJECT_SUPPLY_INSTALL" }) && !isLineModeQuote({ engineJson: { entryMode: "LINE" }, quoteType: "STANDING_OFFER" }) && isLineModeQuote === isLineModeQuoteContract, "不是只供货的报价即使带了做法字段也按专业模式打开（逐行只配只供货）");

  const t = templateSupplyOnlyLines();
  const lt = lineModeTemplate();
  const same = (a: { category: string; calculationType: string; calculationBase?: string | null; rate?: number | null; duration?: number | null; included: boolean; subcategory?: string | null }, b: typeof a) =>
    a.category === b.category && a.calculationType === b.calculationType && (a.calculationBase ?? null) === (b.calculationBase ?? null) && (a.rate ?? null) === (b.rate ?? null) && (a.duration ?? null) === (b.duration ?? null) && a.included === b.included && (a.subcategory ?? null) === (b.subcategory ?? null);
  ok(
    same(lt.preset.financing, t.find((x) => x.calculationType === "PCT_ANNUALIZED_ON_COST")!) &&
      same(lt.preset.admin, t.find((x) => x.calculationType === "PCT_SELF_INCLUSIVE_ON_COST")!) &&
      same(lt.preset.cash_allowance, t.find((x) => x.calculationType === "PCT_ON_COST_SUBTOTAL")!) &&
      same(lt.preset.commission, t.find((x) => x.calculationType === "PCT_OF_GROSS_PROFIT")!),
    "四项预置取自只供货模板（类别、计算方式、比例、月数、是否计入逐项相同）",
  );
  const writes = stateToWrites(defaultLineModeState([]), []);
  const presetWrites = writes.creates.filter((w) => readBidLineMeta(w.metadata)?.role === "preset");
  const tplPreset = t.filter((x) => ["PCT_ANNUALIZED_ON_COST", "PCT_SELF_INCLUSIVE_ON_COST", "PCT_ON_COST_SUBTOTAL", "PCT_OF_GROSS_PROFIT"].includes(x.calculationType));
  ok(
    presetWrites.length === 4 &&
      tplPreset.every((tp) => presetWrites.some((w) => w.category === tp.category && w.calculationType === tp.calculationType && w.rate === (tp.rate ?? null) && w.duration === (tp.duration ?? null) && w.included === tp.included && w.calculationBase === (tp.calculationBase ?? null))),
    "新建时写下的四条预置行与模板逐项相同（8% × 1 个月、自含 3%、1%、毛利 30%）",
    presetWrites.map((w) => [w.category, w.calculationType, w.rate, w.duration, w.included]),
  );
  const shared = writes.creates.filter((w) => readBidLineMeta(w.metadata)?.role === "shared");
  ok(shared.length === 4 && shared.every((w) => !w.included), "新建时四条共用参数行都在、空着 = 不计入（不是按 0 计入）");
  ok(writes.creates.length === 8 && writes.updates.length === 0 && writes.deleteIds.length === 0, "没有价格表时新建：只有 4 + 4 条");
  const seeded = seedRowsFromSchedule([
    { lineNo: 2, description: "合成第二行", quantity: "5", uom: "Box", packCount: 12 },
    { lineNo: 1, description: "合成第一行", quantity: 3, uom: "Each" },
  ]);
  ok(seeded.length === 2 && seeded[0].description === "合成第一行" && seeded[1].quantity === 5 && seeded[1].packCount === 12 && seeded.every((r) => r.rowSource === "schedule" && r.unitPrice == null), "价格表行按行号排好带进来，来源记「价格表」，报价空着");
}

/* ------------------------------ 2. 往返与只动自己的行 ------------------------------ */
console.log("\n━━━ 2. 状态 ↔ 成本行往返；只动自己管的行 ━━━");
{
  const s = sampleState();
  const lines = persist(s);
  ok(lines.length === 10, "两行 + 4 + 4 = 10 条成本行", lines.length);
  ok(lines.every((l) => readBidLineMeta(l.metadata) != null), "每条都带行身份");
  const b = lines.find((l) => (readBidLineMeta(l.metadata) as { lineNo?: number })?.lineNo === 2)!;
  ok(Number(b.unitCost) === 300 && (readBidLineMeta(b.metadata) as { enteredUnitPrice: number; basis: string }).enteredUnitPrice === 30, "按件 30 × 每包 10 → 成本行单价 300，原价与口径留在行身份里");
  ok(b.category === "PROCUREMENT" && b.calculationType === "PER_UNIT" && Number(b.fxRate) === 0.19 && b.source === "已签报价", "货品行：PROCUREMENT / 按件计、汇率写在行上、来源记证据类别");
  const back = costLinesToState(lines, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  const strip = (x: LineModeState) => ({ ...x, rows: x.rows.map((r) => ({ ...r, costLineId: null })) });
  ok(eq(strip(back.state), strip(s)) && back.notices.length === 0, "往返：读回来的状态与写入时相同，没有提示", { got: strip(back.state), want: strip(s), notices: back.notices });

  // 专业模式加的行 + 成本导入的 metadata
  const foreign: DbCostLine = { ...toDb({ ...stateToWrites(defaultLineModeState([]), []).creates[0], description: "加拿大境内运费", category: "FREIGHT", calculationType: "FIXED", unitCost: 400, included: true, metadata: {} }), id: "cl_foreign", metadata: null };
  const withImport = lines.map((l) => (readBidLineMeta(l.metadata)?.role === "goods" && (readBidLineMeta(l.metadata) as { lineNo: number }).lineNo === 1 ? { ...l, metadata: { ...(l.metadata as object), importId: "imp_1", sheet: "合成" } } : l));
  const all = [...withImport, foreign];
  const read2 = costLinesToState(all, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  ok(read2.others.length === 1 && read2.others[0].id === "cl_foreign", "没有行身份的行算作其它成本行");
  const w2 = stateToWrites(read2.state, all);
  ok(!w2.updates.some((u) => u.id === "cl_foreign") && !w2.deleteIds.includes("cl_foreign"), "逐行保存不更新、不删除其它成本行");
  const goodsUpdate = w2.updates.find((u) => (readBidLineMeta(u.data.metadata) as { lineNo?: number })?.lineNo === 1)!;
  ok((goodsUpdate.data.metadata as Record<string, unknown>).importId === "imp_1" && (goodsUpdate.data.metadata as Record<string, unknown>).sheet === "合成", "成本导入留在 metadata 里的来源记录原样保留，只合并行身份");

  // 删一行、行号重排、过期的 id 当新行
  const minus = { ...read2.state, rows: read2.state.rows.slice(1) };
  const w3 = stateToWrites(minus, all);
  const removedId = read2.state.rows[0].costLineId!;
  ok(w3.deleteIds.length === 1 && w3.deleteIds[0] === removedId, "删掉第 1 行 → 只删那一条货品行");
  ok((readBidLineMeta(w3.updates.find((u) => u.id === read2.state.rows[1].costLineId)!.data.metadata) as { lineNo: number }).lineNo === 1, "删行后行号从 1 重排");
  const stale = { ...read2.state, rows: [...read2.state.rows, row({ costLineId: "cl_gone", description: "过期 id 的行", quantity: 2 })] };
  const w4 = stateToWrites(stale, all);
  ok(w4.creates.some((c) => c.description === "过期 id 的行") && !w4.updates.some((u) => u.id === "cl_gone"), "行带的 id 不是这份报价的货品行 → 当新行建");

  // 共用参数关掉：保留原有的数，只是不计入
  const off = { ...read2.state, shared: { ...read2.state.shared, customs: { amount: null, currency: "CAD" } } };
  const w5 = stateToWrites(off, all);
  const customs = w5.updates.find((u) => (readBidLineMeta(u.data.metadata) as { key?: string })?.key === "customs")!;
  ok(customs.data.included === false && customs.data.unitCost === 250, "报关费清空 = 不计入，库里原来的 250 不清掉");
  const zero = stateToWrites({ ...read2.state, shared: { ...read2.state.shared, oceanFreight: { containers: 0, perContainer: 3000, currency: "CAD" } } }, all);
  ok(zero.updates.find((u) => (readBidLineMeta(u.data.metadata) as { key?: string })?.key === "ocean_freight")!.data.included === false, "海运柜数填 0 = 这项没有（不计入；引擎要求按柜计的箱数大于 0）");
}

/* ------------------------------ 3. 专业模式改过后的读法 ------------------------------ */
console.log("\n━━━ 3. 专业模式改过以后 ━━━");
{
  const lines = persist(sampleState());
  const a = lines.find((l) => (readBidLineMeta(l.metadata) as { lineNo?: number })?.lineNo === 1)!;
  const edited = lines.map((l) => (l.id === a.id ? { ...l, unitCost: new Prisma.Decimal(55) } : l));
  const r = costLinesToState(edited, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  ok(r.state.rows[0].unitPrice === 55 && r.state.rows[0].basis === "PER_TENDER_UOM" && r.notices.some((n) => n.includes("第 1 行的供应商报价在专业模式里改过")), "专业模式改了单价：按改后的价（招标单位）读出并提示");
  const fxDiff = lines.map((l) => (readBidLineMeta(l.metadata)?.role === "shared" && l.sourceCurrency === "CNY" ? { ...l, fxRate: new Prisma.Decimal(0.2) } : l));
  const r2 = costLinesToState(fxDiff, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  ok(r2.state.fx.CNY.rate === 0.19 && r2.notices.some((n) => n.includes("人民币（CNY）在不同的行上填了不同的汇率")), "同一币种不同汇率：读第一个并提示保存后统一");
  const noCommission = lines.filter((l) => (readBidLineMeta(l.metadata) as { key?: string })?.key !== "commission");
  const r3 = costLinesToState(noCommission, { pricingMethod: "MARKUP_ON_COST", pricingRate: new Prisma.Decimal(10) });
  ok(r3.state.presets.commission.included === false && r3.notices.some((n) => n.includes("提成")) && r3.state.targetMarginPct === null && r3.notices.some((n) => n.includes("成本加成")), "专业模式删了预置行 / 改了定价方式：按关掉读出、目标毛利率空着，并提示");
  const excluded = lines.map((l) => (l.id === a.id ? { ...l, included: false } : (readBidLineMeta(l.metadata) as { key?: string })?.key === "duty" ? { ...l, calculationBase: "DIRECT_COST" } : l));
  const r4 = costLinesToState(excluded, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  ok(r4.notices.some((n) => n.includes("第 1 行在专业模式里设成了不计入")) && r4.notices.some((n) => n.includes("「关税」") && n.includes("改回原来的算法")), "专业模式把货品行设成不计入、改了关税的基数：读出时提示（用短名），保存时会改回", r4.notices);
  // 海运按柜：专业模式改了「数量」→ 按 数量 × 柜数 读出，保存后金额不变
  const oceanQty = lines.map((l) => ((readBidLineMeta(l.metadata) as { key?: string })?.key === "ocean_freight" ? { ...l, quantity: new Prisma.Decimal(2) } : l));
  const r5 = costLinesToState(oceanQty, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  const before5 = buildLineComputed(fakeQuote(oceanQty, { pricingRate: 25 }));
  const after5 = buildLineComputed(fakeQuote(persist(r5.state, oceanQty), { pricingRate: 25 }));
  ok(
    r5.state.shared.oceanFreight.containers === 2 && r5.notices.some((n) => n.includes("海运费那一行的数量在专业模式里改成了 2")) && before5.computed.ok && after5.computed.ok && before5.computed.totals.sellingPrice === after5.computed.totals.sellingPrice,
    "专业模式改了海运行的数量：读成 2 柜并提示，原样保存后报价不变",
    { r5: r5.state.shared.oceanFreight, notices: r5.notices },
  );
  // 柜数 0 / 不计入：每柜的数照库里显示，不从界面上消失
  const oceanOff = persist({ ...sampleState(), shared: { ...sampleState().shared, oceanFreight: { containers: 0, perContainer: 3000, currency: "CAD" } } });
  const r6 = costLinesToState(oceanOff, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  ok(r6.state.shared.oceanFreight.containers === null && r6.state.shared.oceanFreight.perContainer === 3000, "柜数 0 = 这项没有：保存后柜数空着，每柜 3,000 还显示着", r6.state.shared.oceanFreight);
  // 专业模式里加的其它行用了另一个人民币汇率：照实提示，保存不碰它
  const otherFx = [...lines, { ...toDb({ ...stateToWrites(defaultLineModeState([]), []).creates[0], description: "合成其它人民币费用", category: "OTHER", calculationType: "FIXED", unitCost: 100, sourceCurrency: "CNY", fxRate: 0.2, included: true, metadata: {} }), metadata: null }];
  const r7 = costLinesToState(otherFx, { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: new Prisma.Decimal(25) });
  ok(r7.notices.some((n) => n.includes("合成其它人民币费用") && n.includes("0.2") && n.includes("0.19")), "专业模式里加的其它行用了另一个汇率：提示，在这里保存不会改它", r7.notices);
}

/* ------------------------------ 4. 四个数与引擎相同；分摊 ------------------------------ */
console.log("\n━━━ 4. 四个数只取引擎；按引擎结果分摊 ━━━");
{
  const lines = persist(sampleState());
  const q = fakeQuote(lines, { pricingRate: 25 });
  const built = buildLineComputed(q);
  const direct = computeQuote({ quoteCurrency: "CAD", lines: lines.map(toInput), pricing: { method: "MARGIN_ON_REVENUE", rate: 25 }, engine: null });
  ok(built.computed.ok && direct.ok, "引擎算得出");
  if (built.computed.ok && direct.ok) {
    const t = built.computed.totals;
    ok(t.sellingPrice === direct.sellingPrice && t.estimatedCost === direct.estimatedCost && t.grossProfit === direct.grossProfit && t.grossMarginPct === direct.grossMarginPct, "顶部四个数 = 直接调用 computeQuote 的卖价、成本、毛利、毛利率", { t, direct: [direct.sellingPrice, direct.estimatedCost, direct.grossProfit, direct.grossMarginPct] });
    ok(t.sellingPrice === 8092.08 && t.estimatedCost === 6675.97 && t.grossProfit === 1416.11, "合成数字手算核对：报价 8,092.08、成本 6,675.97、利润 1,416.11", t);
    const al = built.computed.allocation;
    ok(al.lines[0].unitPrice === 36.78 && al.lines[0].extended === 3678 && al.lines[1].unitPrice === 220.69 && al.lines[1].extended === 4413.8, "我方单价取到分、行合计 = 单价 × 数量（36.78 × 100、220.69 × 20）", al.lines);
    ok(al.linesTotal === 8091.8 && al.diff === -0.28 && al.diffBound === 0.6, "逐行合计 8,091.80 比报价合计少 0.28，上限 0.60", al);
    const landedSum = round2(al.lines.reduce((a, l) => a + (l.landedCostCad ?? 0), 0));
    ok(landedSum === t.landedCost && t.landedCost === round2(direct.directCost + direct.percentOfCostTotal), "各行到手成本之和 = 引擎的到手成本（直接成本 + 关税）", { landedSum, t: t.landedCost });
    ok(al.lines.every((l) => l.marginPct != null && Math.abs(l.marginPct - t.grossMarginPct) < 0.1), "各行毛利率与整体一致（到 0.1%）", al.lines.map((l) => l.marginPct));
    ok(eq(exportUnitPrices(al), { 1: "36.78", 2: "220.69" }), "导出用的单价就是逐行表的单价");
  }

  // 缺汇率
  const noFx = persist({ ...sampleState(), fx: { CNY: { rate: null, source: null } } });
  const b2 = buildLineComputed(fakeQuote(noFx, { pricingRate: 25 }));
  ok(!b2.computed.ok && b2.computed.errorsZh.some((e) => e.includes("汇率")), "人民币报价没填汇率：不出数，写明先填汇率");

  // 没填报价的行
  const partial = persist({ ...sampleState(), rows: [...sampleState().rows, row({ description: "还没报价", quantity: 7, evidenceKind: null })] });
  const b3 = buildLineComputed(fakeQuote(partial, { pricingRate: 25 }));
  ok(b3.computed.ok && b3.computed.allocation.lines[2].unitPrice === null && b3.computed.warnings.some((w) => w.code === "LINE_UNPRICED"), "没填报价的行没有单价，引擎报「未定价」");

  // 随机多组：不变量
  let seed = 20261123;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let okAll = true;
  const bad: unknown[] = [];
  for (let k = 0; k < 60; k++) {
    const n = 1 + Math.floor(rnd() * 8);
    const rows: LineRow[] = Array.from({ length: n }, (_, i) => {
      const frac = rnd() < 0.25;
      const ccy = (["CNY", "USD", "CAD"] as const)[Math.floor(rnd() * 3)];
      return row({ description: `合成 ${i + 1}`, quantity: frac ? Math.round(rnd() * 5000) / 100 + 0.01 : 1 + Math.floor(rnd() * 900), currency: ccy, unitPrice: rnd() < 0.15 ? null : Math.round(rnd() * 100000) / 100, evidenceKind: "ESTIMATE" });
    });
    const st: LineModeState = {
      ...defaultLineModeState(rows),
      fx: { CNY: { rate: 0.18 + rnd() * 0.02, source: null }, USD: { rate: 1.3 + rnd() * 0.1, source: null } },
      shared: { oceanFreight: { containers: Math.floor(rnd() * 3), perContainer: rnd() < 0.3 ? null : Math.round(rnd() * 500000) / 100, currency: "USD" }, customs: { amount: rnd() < 0.5 ? null : 250, currency: "CAD" }, domesticFreight: { amount: Math.round(rnd() * 300000) / 100, currency: "CNY" }, dutyPct: rnd() < 0.3 ? null : Math.round(rnd() * 1800) / 100 },
      targetMarginPct: Math.round(rnd() * 4000) / 100,
    };
    const ls = persist(st);
    const extra = rnd() < 0.4 ? [{ ...toDb({ ...stateToWrites(defaultLineModeState([]), []).creates[0], description: "其它", category: "INSURANCE", calculationType: "FIXED", unitCost: 123.45, included: true, metadata: {} }), metadata: null }] : [];
    const r = buildLineComputed(fakeQuote([...ls, ...extra], { pricingRate: st.targetMarginPct }));
    if (!r.computed.ok) continue;
    const al = r.computed.allocation;
    const priced = al.lines.filter((l) => l.unitPrice != null);
    if (priced.length === 0) continue;
    const landedSum = round2(priced.reduce((a, l) => a + (l.landedCostCad ?? 0), 0));
    const goods = r.read.state.rows.map((x, i) => ({ costLineId: r.read.goodsIds[i], lineNo: i + 1, quantity: x.quantity, priced: x.unitPrice != null }));
    const bound = diffBoundOf(goods);
    const c1 = landedSum === r.computed.totals.landedCost;
    const c2 = al.diff != null && Math.abs(al.diff) <= bound + 1e-9;
    const c3 = priced.every((l) => Math.abs(round2((l.unitPrice ?? 0) * r.read.state.rows[l.lineNo - 1].quantity) - (l.extended ?? 0)) <= 0.005 + 1e-9);
    if (!(c1 && c2 && c3)) {
      okAll = false;
      bad.push({ k, c1, c2, c3, landedSum, landed: r.computed.totals.landedCost, diff: al.diff, bound });
    }
  }
  ok(okAll, "60 组随机合成数据（外币、小数数量、未定价行、其它成本行）：到手成本之和等于引擎，逐行合计差额不超过上限，行合计 = 单价 × 数量", bad.slice(0, 3));
  // 报价填 0 的行：单价 0、行合计 0、能导出（不是「—」）
  const zero = persist({ ...sampleState(), rows: [...sampleState().rows, row({ description: "合成赠品", quantity: 5, unitPrice: 0, currency: "CAD", evidenceKind: "SIGNED_QUOTE" })] });
  const bz = buildLineComputed(fakeQuote(zero, { pricingRate: 25 }));
  ok(
    bz.computed.ok && bz.computed.allocation.lines[2].unitPrice === 0 && bz.computed.allocation.lines[2].extended === 0 && bz.computed.allocation.lines[2].marginPct === null && exportUnitPrices(bz.computed.allocation)[3] === "0.00" && bz.computed.allocation.lines[0].unitPrice === 36.78,
    "报价填 0 的行：单价 0.00、行合计 0.00、可以导出；别的行不受影响",
    bz.computed.ok ? bz.computed.allocation.lines : bz.computed,
  );
  // 到手单位成本留 4 位
  const tiny = allocateFromEngine([{ costLineId: "a", lineNo: 1, quantity: 1000, priced: true }], { lines: [{ id: "a", amount: 12.3 } as never], directCost: 12.3, percentOfCostTotal: 0, sellingPrice: 15, estimatedCost: 12.3 });
  ok(tiny.lines[0].landedUnitCostCad === 0.0123, "到手单位成本留 4 位（单价不到 1 分的货品不被取成 0.01）", tiny.lines[0]);
  const none = allocateFromEngine([{ costLineId: "x", lineNo: 1, quantity: 3, priced: false }], { lines: [], directCost: 0, percentOfCostTotal: 0, sellingPrice: 0, estimatedCost: 0 });
  ok(none.lines[0].unitPrice === null && none.linesTotal === null && none.diff === null, "一行都没报价：不分摊，各行显示「—」");
}

/* ------------------------------ 5. 校验 ------------------------------ */
console.log("\n━━━ 5. 保存前的校验 ━━━");
{
  const s = sampleState();
  ok(validateLineModeState(s).ok, "合成状态通过校验");
  const noEvidence = { ...s, rows: [s.rows[0], { ...s.rows[1], evidenceKind: null }] };
  const v1 = validateLineModeState(noEvidence);
  ok(!v1.ok && v1.issues.some((i) => i.rowNo === 2 && i.messageZh.includes("第 2 行的供应商报价是手填的，要选证据类别")), "手填没选证据类别 → 指出第 2 行");
  const picked = { ...s, rows: [{ ...s.rows[0], evidenceKind: null, inquiryItemId: "ii_1" }] };
  ok(validateLineModeState(picked).ok, "从询价回复点选的行不需要证据类别");
  const piece = { ...s, rows: [{ ...s.rows[1], packCount: null }] };
  const v2 = validateLineModeState(piece);
  ok(!v2.ok && v2.issues[0].messageZh.includes("不能按件报价") && v2.issues[0].messageZh.includes("改成按招标单位报价"), "成组单位按件报价但没有包装数 → 拒绝");
  const eachPiece = { ...s, rows: [{ ...s.rows[0], basis: "PER_PIECE" as const }] };
  ok(validateLineModeState(eachPiece).ok, "非成组单位（Each）按件报价可以（每单位 1 件）");
  const bads = validateLineModeState({ ...s, rows: [row({ description: "  ", quantity: 0, uom: "Dozen", unitPrice: -1, evidenceKind: "ESTIMATE" })], fx: { CNY: { rate: 0, source: null } }, targetMarginPct: 100 });
  ok(!bads.ok && ["要填品名", "数量要大于 0", "单位要从列表里选", "供应商报价不能是负数", "人民币（CNY）汇率要大于 0", "目标毛利率"].every((m) => bads.issues.some((i) => i.messageZh.includes(m))), "空品名 / 数量 0 / 不认识的单位 / 负价 / 汇率 0 / 毛利率 100 一次全列出", !bads.ok ? bads.issues : null);
  const usd = validateLineModeState({ ...s, rows: [row({ quantity: 1, unitPrice: 5, currency: "USD", evidenceKind: "ESTIMATE" })], fx: {} });
  ok(usd.ok && usd.state.fx.USD?.rate === null, "用了没登记的外币：补一个空汇率（之后引擎会提示先填汇率），不报错");
  const decimals = validateLineModeState({ ...s, rows: [row({ quantity: 2.12345, unitPrice: 1, evidenceKind: "ESTIMATE" }), row({ quantity: 0.00004, unitPrice: 1, evidenceKind: "ESTIMATE" }), row({ quantity: 2.1235, unitPrice: 1, evidenceKind: "ESTIMATE" })] });
  ok(!decimals.ok && decimals.issues.filter((i) => i.messageZh.includes("数量最多 4 位小数")).map((i) => i.rowNo).join() === "1,2", "数量超过 4 位小数（含 0.00004 这种存进库会变 0 的）指出第几行；4 位以内可以", !decimals.ok ? decimals.issues : null);
  const huge = validateLineModeState({ ...s, rows: [row({ quantity: 1e9, unitPrice: 1, evidenceKind: "ESTIMATE" }), row({ quantity: 1, unitPrice: 1e9, evidenceKind: "ESTIMATE" }), row({ quantity: 50_000_000, unitPrice: 50_000, evidenceKind: "ESTIMATE" })], fx: { CNY: { rate: 1e6, source: null } } });
  ok(!huge.ok && ["第 1 行数量太大", "第 2 行的供应商报价太大", "第 3 行金额太大", "汇率太大"].every((m) => huge.issues.some((i) => i.messageZh.includes(m))), "数量、单价、行金额、汇率超出库里能存的位数：校验时挡下（不让写库报 500）", !huge.ok ? huge.issues : null);
}

/* ------------------------------ 6. 粘贴与旧草稿 ------------------------------ */
console.log("\n━━━ 6. 粘贴、旧的本地成本草稿 ━━━");
{
  const pasteText = "行号\t品名\t数量\t单位\n1\t合成窗帘\t12\tEach\n2\t合成配件\t十二\tBox\n3\t合成卷\t4\tRoll\t25\n4\t合成没单位\t3\t";
  const parsed = parseSchedulePaste(pasteText);
  const rows = rowsFromParsed(parsed.lines, "paste");
  ok(remainingPasteText(pasteText, parsed.issues.map((x) => x.row)) === "2\t合成配件\t十二\tBox\n4\t合成没单位\t3", "粘贴框导入后只去掉已导入的行：数量不是数字、缺单位的行留在框里改了再导", remainingPasteText(pasteText, parsed.issues.map((x) => x.row)));
  const pre = (rows: Array<{ uom: string; sameAsLine: number | null }>, skipped = 0) => linePrefillMessageZh({ state: "ready", messageZh: "（投标工作区那句）", rows: rows as never, skipped: Array.from({ length: skipped }) as never, truncatedFrom: null });
  const m1 = pre([{ uom: "Each", sameAsLine: null }, { uom: "", sameAsLine: null }, { uom: "Box", sameAsLine: 1 }], 1);
  ok(m1.startsWith("招标分析里找到 3 行带数量的（其中 1 行没单位，导入前在粘贴框里补上）") && m1.includes("1 行与前面的行完全相同") && m1.includes("另有 1 条") && m1.includes("点下面按钮填进粘贴框") && !m1.includes("尺寸") && !m1.includes("保存时会被略过"), "从招标分析带入：逐行报价自己的说明（没有尺寸、认证要求列；没单位的行导入前补上）", m1);
  ok(linePrefillMessageZh({ state: "no_analysis", messageZh: "原句", rows: [], skipped: [], truncatedFrom: null }) === "原句", "没有可用的分析：沿用原来的说明");
  ok(rows.length === 2 && rows[1].packCount === 25 && rows.every((r) => r.rowSource === "paste") && parsed.issues.some((i) => i.messageZh.includes("第 3 行") && i.messageZh.includes("不是数字")), "粘贴：数量不是数字的那一行不导入、写明第几行，其它行导入", { rows, issues: parsed.issues });

  const base = { ...sampleState(), targetMarginPct: null, rows: sampleState().rows.map((r) => ({ ...r, unitPrice: null, evidenceKind: null })) };
  const draft = emptyCostDraft();
  draft.lines["1"] = { ...draft.lines["1"], sourcing: "IMPORT", unitPrice: "48.5", basis: "PER_TENDER_UOM", currency: "CNY", evidenceKind: "PLATFORM_LISTED", dutyRatePct: "8", hsCode: "", origin: "", dutySourceRef: "", dutyAsOf: "", freightCad: "", localDeliveryCad: "", otherCad: "" };
  draft.lines["2"] = { ...draft.lines["1"], unitPrice: "3", basis: "PER_PIECE", evidenceKind: "nonsense" };
  draft.fx = { CNY: { rate: "0.195", source: "合成来源", asOf: "" } };
  draft.pricingRatePct = "22";
  ok(draftHasLines(draft) && !draftHasLines(emptyCostDraft()) && !draftHasLines(draft, 0), "有报价的草稿才提示，空草稿不提示；表里一行都没有时不提示");
  const imp = importCostDraft(base, draft);
  ok(eq(imp.importedRows, [1, 2]) && imp.state.rows[0].unitPrice === 48.5 && imp.state.rows[0].evidenceKind === "PLATFORM_LISTED" && imp.state.rows[1].basis === "PER_PIECE" && imp.state.rows[1].evidenceKind === "ESTIMATE", "按行号带入报价、口径、证据类别（认不出的证据记为估计）");
  ok(imp.state.fx.CNY.rate === 0.195 && imp.state.fx.CNY.source === "合成来源" && imp.state.targetMarginPct === 22, "带入汇率与来源；目标毛利率只在报价还没填时带入");
  ok(imp.notes.some((x) => x.includes("关税率") && x.includes("没带入")) && imp.notes.some((x) => x.includes("进口 GST")) && imp.notes[0] === "已带入 2 行（第 1、2 行），请核对后点「保存」" && imp.notes.some((x) => x.includes("第 2 行草稿没写证据类别，按「估计」带入了")), "写明带入了哪几行、没带入的项（逐行关税率、进口 GST）、证据类别按估计带入的行；每条自己说清楚", imp.notes);
  ok(!imp.notes.some((x) => x.includes("不是从存下的价格表来的")), "行来自存下的价格表：不多说「按行号对上」");
  const pasted = { ...base, rows: base.rows.map((r) => ({ ...r, rowSource: "paste" as const })) };
  ok(importCostDraft(pasted, draft).notes.some((x) => x.includes("按行号对上的：请逐行核对品名")), "行是粘贴 / 招标分析带入的：提示按行号对上、要逐行核对品名");
  const priced = { ...base, rows: [{ ...base.rows[0], unitPrice: 60, evidenceKind: "SIGNED_QUOTE" as const }, base.rows[1]] };
  const pi = importCostDraft(priced, draft);
  ok(eq(pi.importedRows, [2]) && pi.state.rows[0].unitPrice === 60 && pi.notes.some((x) => x.includes("第 1 行已经有供应商报价，草稿里的没带入")), "表里已经填了供应商报价的行不覆盖，写明哪几行", pi.notes);
  const none = importCostDraft({ ...base, rows: [base.rows[0]] }, (() => { const d = emptyCostDraft(); d.lines["5"] = { ...draft.lines["1"] }; return d; })());
  ok(none.importedRows.length === 0 && none.notes[0].includes("草稿里没有能对上的行") && !none.notes[0].includes("（无）"), "一行都对不上：照实说什么都没带入（不写「第 （无） 行」）", none.notes);
  const keep = importCostDraft({ ...base, targetMarginPct: 30 }, draft);
  ok(keep.state.targetMarginPct === 30, "报价已经填了目标毛利率：草稿不覆盖");
  ok(base.rows[0].unitPrice === null, "导入不改原来的状态对象（纯函数）");
  const cases: Array<[string, number | null | "bad"]> = [["", null], ["  ", null], ["0.", 0], ["12.", 12], ["12.5", 12.5], ["0.19", 0.19], [".5", 0.5], ["1,234.5", 1234.5], ["-3", -3], ["-", "bad"], ["abc", "bad"], ["1.2.3", "bad"], ["12a", "bad"], ["1e3", "bad"]];
  const wrong = cases.filter(([t, want]) => {
    const r = parseNumInput(t);
    return want === "bad" ? r.ok : !(r.ok && r.value === want);
  });
  ok(wrong.length === 0, "数字输入框：「12.」「0.」按已写出的数算（小数点不被吞掉），千分位逗号可以，「-」「abc」「1.2.3」不合法", wrong);
  const raw = JSON.stringify(draft);
  ok(
    draftToPrompt(null, raw, parseCostDraft, 2)?.lines["1"].unitPrice === "48.5" &&
      draftToPrompt("1", raw, parseCostDraft, 2) === null &&
      draftToPrompt(null, null, parseCostDraft, 2) === null &&
      draftToPrompt(null, JSON.stringify(emptyCostDraft()), parseCostDraft, 2) === null &&
      draftToPrompt(null, "{坏的", parseCostDraft, 2) === null &&
      draftToPrompt(null, raw, parseCostDraft, 0) === null,
    "要不要提示：有填了报价的草稿、没提示过、表里有对得上的行才提示；提示过、没有草稿、空草稿、读不出的草稿、表还是空的都不提示",
  );
  const odd = emptyCostDraft();
  odd.lines["1"] = { ...draft.lines["1"], currency: "rmb" };
  odd.lines["2"] = { ...draft.lines["1"], currency: "usd" };
  odd.fx = { usd: { rate: "1.35", source: "", asOf: "" } };
  const oddImp = importCostDraft(base, odd);
  ok(eq(oddImp.importedRows, [2]) && oddImp.state.rows[1].currency === "USD" && oddImp.state.fx.USD?.rate === 1.35 && oddImp.notes.some((x) => x.includes("rmb")), "草稿币种转大写；不在报价币种里的（rmb）那一行不带入并写明", oddImp);
}

/* ------------------------------ 7a. 「下一步」已定的去处 ------------------------------ */
console.log("\n━━━ 7a. 「已定」按我方报价的做法去 ② / ③ ━━━");
{
  const factsOf = (lineMode: boolean | undefined): BidPageFacts => ({
    now: new Date("2026-11-23T00:00:00Z"),
    analysisStatus: "APPROVED",
    supplierCount: 1,
    pendingRfqApprovals: 0,
    inquiry: { askedCount: 1, respondedCount: 1, quotedCount: 1, repliedNoQuoteCount: 0, waitingCount: 0, waitingSince: null },
    quote: { available: true, bid: { status: "AUTHORITATIVE", version: 2, amount: null, ...(lineMode === undefined ? {} : { lineMode }) }, openDraft: null, approvedUnselected: 0 },
    documents: { canGenerate: true, generatedKinds: 0 },
    canViewAmounts: true,
  });
  const yes = decideBidPageNextStep(factsOf(true));
  const hidden = decideBidPageNextStep({ ...factsOf(true), canViewAmounts: false });
  const no = decideBidPageNextStep(factsOf(false));
  const unknown = decideBidPageNextStep(factsOf(undefined));
  ok(yes.rule === "bid_decided" && yes.action.labelZh === "去导出价格表" && yes.expanded === "quote" && eq(yes.action.target, { kind: "section", section: "quote" }), "我方报价是逐行报价：「导出价格表 / 生成投标文件」去 ②，按钮写「去导出价格表」（不叫已定的人再去「定报价」）", yes);
  ok(hidden.rule === "bid_decided" && hidden.action.labelZh === "去「出文件」" && hidden.expanded === "documents", "看不到金额的人：即使是逐行报价也照旧去 ③（② 对他们锁着；去处不随做法变）", hidden);
  ok(no.action.labelZh === "去「出文件」" && no.expanded === "documents" && unknown.action.labelZh === "去「出文件」" && unknown.expanded === "documents", "不是逐行报价、或不知道：照旧去 ③", [no.action, unknown.action]);
  ok(BID_PAGE_RULE_TARGET.bid_decided === "documents", "对应表里「已定」的默认去处仍是 ③（BIDPAGE-1 原样）");
  const summarySvc = stripComments(read("src/lib/bid-page-v2/service.ts"));
  ok(/access\.canViewAmounts && status === "AUTHORITATIVE" && q \? await db\.projectQuote\.findFirst\(\{ where: \{ id: q\.id, projectId, orgId \}, select: \{ engineJson: true, quoteType: true \} \}\)/.test(summarySvc) && /isLineModeQuote\(bidQuote\)/.test(summarySvc) && /lineMode,/.test(summarySvc), "汇总只给看得到金额的人多读我方报价的做法字段与类型（按项目与组织限定，不读成本行）");
}

/* ------------------------------ 7. 接口与组件源码 ------------------------------ */
console.log("\n━━━ 7. 接口写法与不写的地方 ━━━");
{
  const routes: Array<[string, string, string]> = [
    ["src/app/api/projects/[id]/bid-page/quotes/route.ts", "GET", "internal_cost"],
    ["src/app/api/projects/[id]/bid-page/quotes/route.ts", "POST", "edit"],
    ["src/app/api/projects/[id]/bid-page/quotes/[quoteId]/line/route.ts", "GET", "internal_cost"],
    ["src/app/api/projects/[id]/bid-page/quotes/[quoteId]/line/route.ts", "PUT", "edit"],
    ["src/app/api/projects/[id]/bid-page/quotes/[quoteId]/export/route.ts", "GET", "internal_cost"],
  ];
  for (const [file, method, level] of routes) {
    const src = stripComments(read(file));
    const body = src.slice(src.indexOf(`export async function ${method}(`));
    const re = new RegExp(
      `^export async function ${method}\\([^)]*\\)[^{]*\\{\\s*const \\{ id: projectId(, quoteId)? \\} = await params;\\s*const access = await requireQuoteAccess\\(request, projectId, "${level}"\\);\\s*if \\(access instanceof NextResponse\\) return access;\\s*const gate = await lineModeGate\\(access\\);\\s*if \\(gate instanceof NextResponse\\) return gate;`,
    );
    ok(re.test(body), `${file.replace("src/app/api/projects/[id]/", "")} ${method}：第一句报价权限守卫（${level}）并紧接着检查，之后是开关与金额门`);
  }
  const gate = stripComments(read("src/lib/bid-page-v2/quote-line/api-gate.ts"));
  const i404 = gate.indexOf("isBidPageV2EnabledForOrg(access.orgId)");
  const iFin = gate.indexOf("resolveFinancePrivilege(access.user, access.orgId, access.project.ownerId)");
  const svcSrc = stripComments(read("src/lib/bid-page-v2/quote-line/service.ts"));
  const iInt = gate.indexOf("if (!access.canViewInternal) return NextResponse.json({ error: LINE_MODE_AMOUNTS_FORBIDDEN_ZH }, { status: 403 })");
  ok(i404 > 0 && iInt > i404 && iFin > iInt && /workDomain !== "tender"/.test(gate) && /!finance\.canReadAll\) return NextResponse\.json\(\{ error: LINE_MODE_AMOUNTS_FORBIDDEN_ZH \}, \{ status: 403 \}\)/.test(gate), "门：先开关与招投标项目（404），再内部成本权限与财务查看权（403；写接口也返回成本，所以也要内部成本权限）");
  ok(["=SUM(A1)", "+1", "-2", "@x", "\tA"].every((t) => csvSafeText(t) === `'${t}`) && csvSafeText("合成卷帘 A") === "合成卷帘 A" && /description: csvSafeText\(r\.description\)/.test(svcSrc), "导出的品名以 = + - @ 制表符开头时前面加 '（表格软件不把它当公式）；其余原样");
  ok(quoteDisplayName({ name: null, quoteNumber: "Q-1", quoteType: "PROJECT_SUPPLY_INSTALL" }) === "供货加安装报价 · Q-1" && quoteDisplayName({ name: " 合成 ", quoteNumber: "Q-1", quoteType: "SUPPLY_ONLY" }) === "合成" && !/q\.title/.test(svcSrc), "报价显示名：有名字用名字；没有就写业务类型中文 + 报价编号（不显示内部标题里的英文类型码）");
  const svc = stripComments(read("src/lib/bid-page-v2/quote-line/service.ts"));
  ok(!/quoteLineItem|lineItems\s*:\s*\{\s*create/.test(svc) && !/bidIntelligenceRoom/.test(svc) && !/saveWorkspaceBlocks/.test(svc), "服务不写给客户报价单的明细行、不写投标工作区");
  ok(/computeForQuote\(q\)/.test(svc) && !/computeCostScenario|prepareLine|finalizeLine/.test(svc), "数只来自报价引擎（computeForQuote），不用 tender-bid-cost 的逐行核算");
  ok(/updatedAt: q\.updatedAt/.test(svc) && /QUOTE_CHANGED/.test(svc), "保存按读取时的修改时间占住报价（别人改过 → 409）");
  const comp = stripComments(read("src/components/bid-page-v2/quote-step.tsx"));
  const sets = comp.match(/localStorage\.setItem\(/g) ?? [];
  ok(sets.length === 1 && /localStorage\.setItem\(costDraftPromptedKey\(projectId\), "1"\)/.test(comp), "组件只往本地存储写一个不含金额的「提示过」标记，不写成本");
  ok(!/sessionStorage/.test(comp) && /localStorage\.getItem\(costDraftStorageKey\(projectId\)\)/.test(comp), "旧草稿只读不改，不用 sessionStorage");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
