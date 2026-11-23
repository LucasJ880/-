/**
 * BIDPAGE-4 逐行 ↔ 总价的互转（纯函数；design D9，spec「逐行报价转成只报总价」「只报总价转成逐行报价」「转换前后报价引擎算出的数不变」）
 *
 * - `convertLineToLump` / `convertLumpToLine`：由现有成本行算出要写的行；不能转时给出中文原因。
 * - `simulateWrites`：把要写的行按库里能存的位数（`Decimal(18,4)` 等）落到内存里，供 `compareEngine` 用报价引擎核对前后结果。
 * 不改 `computeQuote`；货品行与预置一行都不改写。
 */
import { Prisma } from "@prisma/client";
import { computeQuote, round2 } from "@/lib/quote-engine/calc";
import type { CostLineInput, EngineConfig } from "@/lib/quote-engine/contract";
import { SHARED_KEYS, readBidLineMeta, type SharedKey } from "../quote-line/contract";
import { defaultLineModeState, indexManagedLines, sharedAlgoChanged, sharedWrite, type DbCostLine } from "../quote-line/mapping";
import { LUMP_ITEM_SPEC, lumpItemDescriptionZh, mergeLumpMeta, type LumpItemKey } from "./contract";
import { GOODS_TOTAL_SORT, indexLumpLines, lumpItemSort, type LumpWrite, type LumpWrites } from "./mapping";

export type ConvertResult = { ok: true; writes: LumpWrites } | { ok: false; reasonZh: string };

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const dp = (v: number | null, places: number): number | null => (v == null ? null : Number(new Prisma.Decimal(v.toFixed(8)).toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP)));
const SHARED_SHORT_ZH: Record<SharedKey, string> = { ocean_freight: "海运费", customs: "报关费", duty: "关税", domestic_freight: "国内运费" };

/** 一条已有成本行原样转成要写的内容（再按需覆盖几个字段）；备注不写（undefined = 不碰） */
function asWrite(l: DbCostLine): LumpWrite {
  return {
    sortOrder: l.sortOrder,
    category: l.category,
    subcategory: l.subcategory,
    description: l.description,
    quantity: num(l.quantity),
    unit: l.unit,
    unitCost: num(l.unitCost),
    sourceCurrency: l.sourceCurrency,
    fxRate: num(l.fxRate),
    fxRateSource: l.fxRateSource,
    calculationType: l.calculationType,
    calculationBase: l.calculationBase,
    rate: num(l.rate),
    duration: num(l.duration),
    supplierId: l.supplierId,
    supplierName: l.supplierName,
    source: l.source,
    included: l.included,
    metadata: (l.metadata && typeof l.metadata === "object" && !Array.isArray(l.metadata) ? { ...(l.metadata as Record<string, unknown>) } : {}) as Record<string, unknown>,
  };
}

/** 逐行 → 总价（没冻结的逐行报价） */
export function convertLineToLump(lines: readonly DbCostLine[]): ConvertResult {
  const li = indexManagedLines(lines);
  for (const key of SHARED_KEYS) {
    const l = li.shared[key];
    if (l && sharedAlgoChanged(key, l)) return { ok: false, reasonZh: `「${SHARED_SHORT_ZH[key]}」的类别或算法在专业模式里改过：先在逐行表里保存一次（会改回原来的算法），或在专业模式里改回，再转` };
  }
  const lumpIdx = indexLumpLines(lines);
  const out: LumpWrites = { updates: [], creates: [], deleteIds: [] };
  for (const key of SHARED_KEYS) {
    const l = li.shared[key];
    if (!l) continue;
    const already = lumpIdx.items.find((i) => i.meta.key === key) ?? null;
    if (!l.included) {
      // 没计入的共用参数：已有同一项的总价项 → 删掉这条空的；否则变成空着的项（不带逐行表「不计入时保留原值」留下的数）
      if (already) out.deleteIds.push(l.id);
      else out.updates.push({ id: l.id, data: emptyLumpFrom(l, key) });
      continue;
    }
    if (already) {
      if (already.line.included) {
        const what = key === "ocean_freight" ? "海运柜数" : key === "duty" ? "关税率" : SHARED_SHORT_ZH[key];
        return { ok: false, reasonZh: `转换后会有两项${SHARED_SHORT_ZH[key]}：请先在逐行表里清掉${what}，或在专业模式里删掉另一条「${already.line.description}」` };
      }
      out.deleteIds.push(already.line.id);
    }
    out.updates.push({ id: l.id, data: lumpFromShared(l, key) });
  }
  if (!lumpIdx.goodsTotal) {
    const hasGoods = li.goods.size > 0;
    out.creates.push({
      sortOrder: GOODS_TOTAL_SORT,
      category: "PROCUREMENT",
      subcategory: null,
      description: "货品（总数）",
      quantity: null,
      unit: null,
      unitCost: null,
      sourceCurrency: "CAD",
      fxRate: null,
      fxRateSource: null,
      calculationType: "FIXED",
      calculationBase: null,
      rate: null,
      duration: null,
      supplierId: null,
      supplierName: null,
      source: null,
      // 有货品行 → 明细模式，总数不计入；没有货品行 → 填总数模式（空着，由引擎提示未定价，金额按 0，前后不变）
      included: !hasGoods,
      notes: null,
      metadata: mergeLumpMeta(null, { v: 1, role: "lump", key: "goods_total", evidenceKind: null, inquiryItemId: null }),
    });
  }
  return { ok: true, writes: out };
}

function emptyLumpFrom(l: DbCostLine, key: SharedKey): LumpWrite {
  const k = key as LumpItemKey;
  const kind = LUMP_ITEM_SPEC[k].defaultKind;
  return {
    ...asWrite(l),
    sortOrder: lumpItemSort(k, null),
    category: LUMP_ITEM_SPEC[k].category,
    description: lumpItemDescriptionZh(k, kind, null),
    quantity: null,
    unit: null,
    unitCost: null,
    sourceCurrency: "CAD",
    fxRate: null,
    fxRateSource: null,
    calculationType: "FIXED",
    calculationBase: null,
    rate: null,
    duration: null,
    included: false,
    metadata: mergeLumpMeta(l.metadata, { v: 1, role: "lump", key: k }),
  };
}

function lumpFromShared(l: DbCostLine, key: SharedKey): LumpWrite {
  const k = key as LumpItemKey;
  const base = { ...asWrite(l), sortOrder: lumpItemSort(k, null), category: LUMP_ITEM_SPEC[k].category, metadata: mergeLumpMeta(l.metadata, { v: 1, role: "lump", key: k }) };
  if (key === "ocean_freight") {
    // 按柜：数量（缺省 1）× 柜数 × 每柜 → 一个金额（原币、汇率不变）；按库里 4 位小数取，前后由引擎核对
    // 每柜或柜数缺（专业模式里清掉的）= 引擎按未定价算：换过去仍是未定价（金额空着），不变成「已定价 0」
    const unpriced = l.unitCost == null || l.duration == null;
    const qty = l.quantity == null ? new Prisma.Decimal(1) : new Prisma.Decimal(l.quantity);
    const amount = unpriced ? null : Number(qty.times(l.duration!).times(l.unitCost!).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP));
    return { ...base, description: lumpItemDescriptionZh(k, "amount", null), quantity: null, unit: null, unitCost: amount, calculationType: "FIXED", calculationBase: null, rate: null, duration: null };
  }
  if (key === "duty") return { ...base, description: lumpItemDescriptionZh(k, "percent", null), unitCost: null, quantity: null, unit: null, duration: null };
  return { ...base, description: lumpItemDescriptionZh(k, "amount", null), quantity: null, unit: null, duration: null };
}

/** 总价 → 逐行（只供货、货品是明细且总数不计入） */
export function convertLumpToLine(lines: readonly DbCostLine[], quoteType: string): ConvertResult {
  if (quoteType !== "SUPPLY_ONLY") return { ok: false, reasonZh: "逐行报价限于只供货的报价，供货加安装的报价不能转成逐行报价" };
  const idx = indexLumpLines(lines);
  if (idx.goods.length === 0) return { ok: false, reasonZh: "货品是一个总数，先展开成明细再转成逐行报价" };
  if (idx.goodsTotal?.included) return { ok: false, reasonZh: "货品总数和明细都计入了：先在总价表里保存一次（总数会改成不计入），再转" };
  const leftShared = new Map<SharedKey, DbCostLine>();
  for (const o of idx.others) {
    const m = readBidLineMeta(o.line.metadata);
    if (m?.role === "shared" && !leftShared.has(m.key)) leftShared.set(m.key, o.line);
  }
  const out: LumpWrites = { updates: [], creates: [], deleteIds: [] };
  const empty = defaultLineModeState([]);
  for (const key of SHARED_KEYS) {
    const item = idx.items.find((i) => i.meta.key === key) ?? null;
    const left = leftShared.get(key) ?? null;
    const l = item?.line ?? null;
    const mappable = !!l && l.included && (key === "customs" || key === "domestic_freight" ? l.calculationType === "FIXED" : key === "duty" ? l.calculationType === "PERCENT_OF_COST" : false);
    const emptyItem = !!l && !l.included;
    if (mappable || emptyItem) {
      if (left) {
        if (left.included && mappable) return { ok: false, reasonZh: `转换后会有两项${SHARED_SHORT_ZH[key]}：请先在专业模式里删掉另一条「${left.description}」` };
        if (left.included) {
          // 总价表这一项空着、另有一条计入的同名共用参数：留下计入的那条，删掉空着的总价项
          out.deleteIds.push(l!.id);
          continue;
        }
        out.deleteIds.push(left.id);
      }
      out.updates.push({ id: l!.id, data: sharedFromLump(l!, key, mappable, empty) });
      continue;
    }
    // 留作总价项（海运金额、关税金额）或根本没有这一项：保证逐行表四条共用参数都在（空着 = 不计入）
    if (!left) out.creates.push(sharedWrite(empty, key, null));
  }
  return { ok: true, writes: out };
}

function sharedFromLump(l: DbCostLine, key: SharedKey, mappable: boolean, empty: ReturnType<typeof defaultLineModeState>): LumpWrite {
  // 子类别照原样留着（专业模式里按子类别算比例的行不受影响）
  if (!mappable) return { ...sharedWrite(empty, key, null), subcategory: l.subcategory, metadata: sharedWrite(empty, key, l).metadata, supplierId: l.supplierId, supplierName: l.supplierName, source: l.source };
  const fx = l.sourceCurrency === "CAD" ? {} : { [l.sourceCurrency]: { rate: num(l.fxRate), source: l.fxRateSource } };
  const amount = num(l.unitCost);
  const state = {
    ...empty,
    fx,
    shared: {
      ...empty.shared,
      customs: key === "customs" ? { amount, currency: l.sourceCurrency } : empty.shared.customs,
      domesticFreight: key === "domestic_freight" ? { amount, currency: l.sourceCurrency } : empty.shared.domesticFreight,
      dutyPct: key === "duty" ? num(l.rate) : null,
    },
  };
  return { ...sharedWrite(state, key, l), subcategory: l.subcategory };
}

/* ------------------------------ 前后核对 ------------------------------ */

/** 核对不过时写的原因：逐行 → 总价、按柜计的海运费换成一个金额要取到 4 位小数（真的四舍五入了）时，才说是海运费取整；否则多半是行的先后 */
export function convertHintZh(lines: readonly DbCostLine[], to: "LUMP_SUM" | "LINE"): string | undefined {
  const rounded =
    to === "LUMP_SUM" &&
    lines.some((l) => {
      if (!l.included || l.calculationType !== "PER_CONTAINER" || readBidLineMeta(l.metadata)?.role !== "shared" || l.unitCost == null || l.duration == null) return false;
      const exact = (l.quantity == null ? new Prisma.Decimal(1) : new Prisma.Decimal(l.quantity)).times(l.duration).times(l.unitCost);
      return exact.decimalPlaces() > 4;
    });
  return rounded ? "多半是海运费按柜换成一个金额时四舍五入不同：可以先把每柜金额改成两位小数再转，或在专业模式里改" : undefined;
}

/** 要写的行按库里的位数落到内存（数量 / 金额 / 时长 4 位、汇率 8 位、比例 4 位），返回转换后的成本行输入 */
export function simulateWrites(current: readonly DbCostLine[], writes: LumpWrites): CostLineInput[] {
  const del = new Set(writes.deleteIds);
  const upd = new Map(writes.updates.map((u) => [u.id, u.data]));
  const toInput = (id: string, w: LumpWrite, notes: string | null): CostLineInput => ({
    id,
    sortOrder: w.sortOrder,
    category: w.category,
    subcategory: w.subcategory,
    description: w.description,
    quantity: dp(w.quantity, 4),
    unit: w.unit,
    unitCost: dp(w.unitCost, 4),
    sourceCurrency: w.sourceCurrency,
    fxRate: dp(w.fxRate, 8),
    calculationType: w.calculationType,
    calculationBase: w.calculationBase,
    rate: dp(w.rate, 4),
    duration: dp(w.duration, 4),
    included: w.included,
    supplierName: w.supplierName,
    notes: w.notes === undefined ? notes : w.notes,
  });
  const kept = current.filter((l) => !del.has(l.id)).map((l) => toInput(l.id, upd.get(l.id) ?? asWrite(l), l.notes));
  // 引擎按行的先后累加（第 ① 遍不取整的合计会被当基数用）：按 sortOrder 排（getQuote 也按 sortOrder 读）；
  // 同序的行在库里读出的先后不固定（getQuote 只按 sortOrder 排），这里按 id 定一个，写库后在事务里按真实读出的顺序再核对一次
  return [...kept, ...writes.creates.map((c, i) => toInput(`new-${i}`, c, null))].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function inputsOf(current: readonly DbCostLine[]): CostLineInput[] {
  return simulateWrites(current, { updates: [], creates: [], deleteIds: [] });
}

export type EngineCompare = { ok: true } | { ok: false; reasonZh: string };

/** 用报价引擎算转换前后：成本合计、税前报价、利润、销售税任一项不同 → 不转（design D9 ①） */
export function compareEngine(input: { quoteCurrency: string; pricing: { method: string; rate: number | null }; engine: EngineConfig; before: CostLineInput[]; after: CostLineInput[]; hintZh?: string }): EngineCompare {
  const run = (lines: CostLineInput[]) => computeQuote({ quoteCurrency: input.quoteCurrency, lines, pricing: input.pricing, engine: input.engine });
  const a = run(input.before);
  if (!a.ok) return { ok: false, reasonZh: "这份报价现在算不出（例如缺汇率），先在原来的表里填好再转" };
  const b = run(input.after);
  if (!b.ok) return { ok: false, reasonZh: "转换后报价会算不出，没有转换；请在专业模式里检查这份报价" };
  const tax = (r: typeof a) => (r.ok ? round2(r.tax.gst + r.tax.hst + r.tax.pst) : 0);
  const pairs: Array<[string, number, number]> = [
    ["成本合计", a.estimatedCost, b.estimatedCost],
    ["税前报价", a.sellingPrice, b.sellingPrice],
    ["利润", a.grossProfit, b.grossProfit],
    ["销售税", tax(a), tax(b)],
  ];
  const diff = pairs.find(([, x, y]) => x !== y);
  if (diff) {
    const d = round2(Math.abs(diff[2] - diff[1]));
    return { ok: false, reasonZh: `转换后${diff[0]}会差 ${d.toFixed(2)} 加元，没有转换：${input.hintZh ?? "多半是四舍五入的先后不同（例如专业模式里加的按比例算的行），请在专业模式里检查这份报价"}` };
  }
  // 未定价的行不能变少：不能把「未定价」换成「已定价 0」，送审门靠它拦（fail-closed）。
  // 变多是更保守的方向（例如还没有货品行的逐行报价转过来，新建的货品总数空着、按未定价提示），照转
  const unpriced = (r: typeof a) => (r.ok ? r.warnings.filter((w) => w.code === "LINE_UNPRICED").length : 0);
  if (unpriced(b) < unpriced(a)) return { ok: false, reasonZh: "转换后有的还没填价的行会被当成已填 0，没有转换：请先把空着的价填好或在专业模式里检查" };
  return { ok: true };
}
