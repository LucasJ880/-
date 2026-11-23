/**
 * BIDPAGE-4 只报总价 — 编辑状态 ↔ 报价引擎成本行（纯函数，服务端用；定点换算用 Prisma.Decimal）
 * （openspec change quote-lump-sum-mode，design D2 / D3 / D6 / D7 / D8）
 *
 * - 写：`lumpStateToWrites(state, current)` 只产出总价表管的行（货品总数、明细、各项、预置）的新建、更新、删除；
 *   其它成本行（专业模式里加的、类别或算法被改成这一项不允许的、同一项多出来的）一律不出现在结果里。
 * - 读：`lumpStateFromLines(lines, quote)` 还原成编辑状态；专业模式里改过的照实读出并给一句提示。
 * - 明细与预置的读写直接复用逐行表（`quote-line/mapping.ts`），按件报价、包装数原样往返。
 */
import { Prisma } from "@prisma/client";
import { engineConfigSchema } from "@/lib/quote-engine/contract";
import { LINE_EVIDENCE_LABELS_ZH, readBidLineMeta, type FxEntry, type LineRow, type PresetKey } from "../quote-line/contract";
import {
  createFxReader,
  defaultLineModeState,
  goodsWrite,
  othersFxNotices,
  presetWrite,
  readGoodsRows,
  readPresets,
  type CostLineWrite,
  type DbCostLine,
} from "../quote-line/mapping";
import {
  GOODS_TOTAL_DESCRIPTION_ZH,
  GOODS_TOTAL_SPEC,
  LUMP_INITIAL_KEYS,
  LUMP_ITEM_KEYS,
  LUMP_ITEM_SPEC,
  LUMP_MARKUP_NOTE_ZH,
  lumpComboAllowed,
  lumpItemDescriptionZh,
  lumpKindOf,
  mergeLumpMeta,
  readLumpMeta,
  type LumpGoods,
  type LumpItem,
  type LumpItemKey,
  type LumpMeta,
  type LumpState,
  emptyLumpItem,
} from "./contract";
export { emptyLumpItem };

/** 总价表写的行带备注；`notes` 为 undefined 时不写备注（明细、预置照逐行表，不碰备注） */
export type LumpWrite = CostLineWrite & { notes?: string | null };
export type LumpWrites = { updates: Array<{ id: string; data: LumpWrite }>; creates: LumpWrite[]; deleteIds: string[] };

export const GOODS_TOTAL_SORT = 0;
export const lumpItemSort = (key: LumpItemKey, seq: number | null) => (key === "other" ? 3900 + (seq ?? 0) : 3010 + LUMP_ITEM_KEYS.indexOf(key) * 10);

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const keyIndex = (k: LumpItemKey) => LUMP_ITEM_KEYS.indexOf(k);
const fmtAmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export const ALGO_CHANGED_REASON_ZH = "在专业模式里改了算法，这里不再管它（照样计入）";
const DUP_REASON_ZH = "同一项有两条，这里只管第一条（这一条照样计入）";
const SHARED_LEFT_REASON_ZH = "逐行报价留下的共用参数（照样计入，在这里不改）";

/* --------------------------------- 分类 --------------------------------- */

export type LumpIndex = {
  goodsTotal: DbCostLine | null;
  goods: DbCostLine[];
  items: Array<{ line: DbCostLine; meta: LumpMeta & { key: LumpItemKey } }>;
  preset: Partial<Record<PresetKey, DbCostLine>>;
  others: Array<{ line: DbCostLine; reasonZh: string | null; fromLump: boolean }>;
  notices: string[];
};

const nameOfMeta = (meta: LumpMeta, line: DbCostLine) => (meta.key === "goods_total" ? GOODS_TOTAL_SPEC.labelZh : meta.key === "other" ? line.description : LUMP_ITEM_SPEC[meta.key].labelZh);

/** 按行身份分：货品总数、明细、各项、预置、其它（只在类别与算法是这一项允许的组合的行里认，同一项只认第一条，design D2 / D8） */
export function indexLumpLines(lines: readonly DbCostLine[]): LumpIndex {
  const idx: LumpIndex = { goodsTotal: null, goods: [], items: [], preset: {}, others: [], notices: [] };
  const seen = new Set<string>();
  for (const l of [...lines].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))) {
    const lump = readLumpMeta(l.metadata);
    if (lump) {
      if (!lumpComboAllowed(lump.key, l)) {
        idx.others.push({ line: l, reasonZh: ALGO_CHANGED_REASON_ZH, fromLump: true });
        idx.notices.push(`「${nameOfMeta(lump, l)}」${ALGO_CHANGED_REASON_ZH}`);
        continue;
      }
      if (lump.key === "goods_total") {
        if (!idx.goodsTotal) idx.goodsTotal = l;
        else idx.others.push({ line: l, reasonZh: DUP_REASON_ZH, fromLump: true });
        continue;
      }
      if (lump.key !== "other" && seen.has(lump.key)) {
        idx.others.push({ line: l, reasonZh: DUP_REASON_ZH, fromLump: true });
        continue;
      }
      seen.add(lump.key);
      idx.items.push({ line: l, meta: lump as LumpMeta & { key: LumpItemKey } });
      continue;
    }
    const bid = readBidLineMeta(l.metadata);
    if (bid?.role === "goods") idx.goods.push(l);
    else if (bid?.role === "preset" && !idx.preset[bid.key]) idx.preset[bid.key] = l;
    else if (bid?.role === "shared") idx.others.push({ line: l, reasonZh: SHARED_LEFT_REASON_ZH, fromLump: false });
    else idx.others.push({ line: l, reasonZh: null, fromLump: false });
  }
  idx.items.sort((a, b) => keyIndex(a.meta.key) - keyIndex(b.meta.key) || (a.meta.seq ?? 0) - (b.meta.seq ?? 0) || a.line.sortOrder - b.line.sortOrder);
  return idx;
}

/* --------------------------------- 种子 --------------------------------- */


/** 新建的总价报价：货品、海运费、关税（都空着）+ 四条预置（值与只供货模板相同）；税三项为空（design D1 / spec「新建的总价报价只有用得上的行」） */
export function defaultLumpState(): LumpState {
  return {
    goods: { mode: "total", costLineId: null, amount: null, currency: "CAD", inquiryItemId: null, evidenceKind: null, supplierId: null, supplierName: null, notes: null },
    details: [],
    items: LUMP_INITIAL_KEYS.map(emptyLumpItem),
    tax: { hstPct: null, gstPct: null, pstPct: null },
    fx: {},
    presets: defaultLineModeState([]).presets,
    targetMarginPct: null,
  };
}

/* --------------------------------- 读 --------------------------------- */

export function lumpStateFromLines(
  lines: readonly DbCostLine[],
  quote: { pricingMethod: string; pricingRate: Prisma.Decimal | null; engineJson: unknown },
): { state: LumpState; notices: string[]; others: LumpIndex["others"]; detailIds: string[] } {
  const idx = indexLumpLines(lines);
  const notices = [...idx.notices];
  const fxr = createFxReader();
  const { rows, ids } = readGoodsRows(idx.goods, fxr, notices, "货品明细第");

  const gt = idx.goodsTotal;
  const gm = gt ? readLumpMeta(gt.metadata) : null;
  if (gt) fxr.note(gt);
  const mode: LumpGoods["mode"] = rows.length > 0 ? "detail" : "total";
  if (mode === "detail" && gt?.included) notices.push("货品总数和明细都计入了（重复）；在这里保存时总数会改成不计入");
  if (mode === "total" && gt && !gt.included) notices.push("货品总数设成了不计入；在这里保存时会重新计入");
  if (mode === "total" && !gt) notices.push("货品总数那一行在专业模式里删掉了，在这里保存时会重新建一条");
  const goods: LumpGoods = {
    mode,
    costLineId: gt?.id ?? null,
    amount: num(gt?.unitCost),
    currency: gt?.sourceCurrency ?? "CAD",
    inquiryItemId: gm?.inquiryItemId ?? null,
    evidenceKind: gm?.inquiryItemId ? null : gm?.evidenceKind ?? null,
    supplierId: gt?.supplierId ?? null,
    supplierName: gt?.supplierName ?? null,
    notes: gt?.notes ?? null,
  };

  const items: LumpItem[] = idx.items.map(({ line, meta }) => {
    const key = meta.key;
    const kind = lumpKindOf(line.calculationType);
    const name = key === "other" ? `「${line.description}」` : `「${LUMP_ITEM_SPEC[key].labelZh}」`;
    if (line.included && kind === "amount") fxr.note(line);
    const stored = kind === "amount" ? num(line.unitCost) : num(line.rate);
    if (!line.included && stored != null) notices.push(`${name}设成了不计入（库里记着 ${kind === "amount" ? fmtAmt(stored) : `${fmtAmt(stored)}%`}），这里按没填显示；要计入请重新填`);
    if (key !== "other") {
      const expected = lumpItemDescriptionZh(key, kind, null);
      if (line.description !== expected) notices.push(`「${LUMP_ITEM_SPEC[key].labelZh}」的说明在专业模式里改成了「${line.description}」，在这里保存时会改回「${expected}」`);
    }
    return {
      costLineId: line.id,
      key,
      seq: meta.seq ?? null,
      label: key === "other" ? line.description : null,
      kind,
      amount: kind === "amount" && line.included ? stored : null,
      currency: kind === "amount" ? line.sourceCurrency : "CAD",
      ratePct: kind === "percent" && line.included ? stored : null,
      notes: line.notes,
    };
  });

  const presets = readPresets(idx.preset, notices);
  notices.push(...fxr.conflictNotices());
  notices.push(...othersFxNotices(idx.others.map((o) => o.line), fxr.fx));
  if (quote.pricingMethod !== "MARGIN_ON_REVENUE") notices.push(LUMP_MARKUP_NOTE_ZH);
  const engine = engineConfigSchema.safeParse(quote.engineJson ?? {});
  const tax = engine.success ? engine.data.tax : undefined;

  return {
    state: {
      goods,
      details: rows,
      items,
      tax: { hstPct: tax?.hstPct ?? null, gstPct: tax?.gstPct ?? null, pstPct: tax?.pstPct ?? null },
      fx: fxr.fx,
      presets,
      targetMarginPct: quote.pricingMethod === "MARGIN_ON_REVENUE" ? num(quote.pricingRate) : null,
    },
    notices,
    others: idx.others,
    detailIds: ids,
  };
}

/* --------------------------------- 写 --------------------------------- */

function fxOf(fx: Record<string, FxEntry>, currency: string): { fxRate: number | null; fxRateSource: string | null } {
  if (currency === "CAD") return { fxRate: null, fxRateSource: null };
  const e = fx[currency];
  return { fxRate: e?.rate ?? null, fxRateSource: e?.source ?? null };
}

function goodsTotalWrite(state: LumpState, existing: DbCostLine | null): LumpWrite {
  const g = state.goods;
  const meta: LumpMeta = { v: 1, role: "lump", key: "goods_total", evidenceKind: g.inquiryItemId ? null : g.evidenceKind, inquiryItemId: g.inquiryItemId };
  return {
    sortOrder: GOODS_TOTAL_SORT,
    category: GOODS_TOTAL_SPEC.category,
    subcategory: existing?.subcategory ?? null,
    description: GOODS_TOTAL_DESCRIPTION_ZH,
    quantity: null,
    unit: null,
    unitCost: g.amount,
    sourceCurrency: g.currency,
    ...fxOf(state.fx, g.currency),
    calculationType: "FIXED",
    calculationBase: null,
    rate: null,
    duration: null,
    supplierId: g.supplierId,
    supplierName: g.supplierName,
    source: g.inquiryItemId ? "询价回复" : g.evidenceKind ? LINE_EVIDENCE_LABELS_ZH[g.evidenceKind] : null,
    // 明细模式：总数留着、不计入（D6）；填总数模式：计入（空着 = 未定价，由引擎提示）
    included: g.mode === "total",
    notes: g.notes,
    metadata: mergeLumpMeta(existing?.metadata ?? null, meta),
  };
}

function itemWrite(state: LumpState, item: LumpItem, seq: number | null, existing: DbCostLine | null): LumpWrite {
  const s = LUMP_ITEM_SPEC[item.key];
  const value = item.kind === "amount" ? item.amount : item.ratePct;
  const pct = item.kind === "percent" ? s.percent : null;
  let vals: { unitCost: number | null; rate: number | null; sourceCurrency: string; fxRate: number | null; fxRateSource: string | null; included: boolean };
  if (value != null) {
    vals = item.kind === "amount"
      ? { unitCost: value, rate: null, sourceCurrency: item.currency, ...fxOf(state.fx, item.currency), included: true }
      : { unitCost: null, rate: value, sourceCurrency: "CAD", fxRate: null, fxRateSource: null, included: true };
  } else if (existing && !existing.included) {
    // 原来就不计入（例如专业模式里设成不计入、还带着数）：数留着、仍不计入（D8）
    vals = { unitCost: num(existing.unitCost), rate: num(existing.rate), sourceCurrency: existing.sourceCurrency, fxRate: num(existing.fxRate), fxRateSource: existing.fxRateSource, included: false };
  } else {
    // 人清空了这一项：不计入，数写空
    vals = { unitCost: null, rate: null, sourceCurrency: item.kind === "amount" ? item.currency : "CAD", fxRate: null, fxRateSource: null, included: false };
  }
  const meta: LumpMeta = { v: 1, role: "lump", key: item.key, ...(item.key === "other" && seq != null ? { seq } : {}) };
  return {
    sortOrder: lumpItemSort(item.key, seq),
    category: s.category,
    subcategory: existing?.subcategory ?? null,
    description: lumpItemDescriptionZh(item.key, item.kind, item.label),
    quantity: null,
    unit: null,
    unitCost: vals.unitCost,
    sourceCurrency: vals.sourceCurrency,
    fxRate: vals.fxRate,
    fxRateSource: vals.fxRateSource,
    calculationType: pct ? pct.calculationType : "FIXED",
    calculationBase: pct ? pct.calculationBase : null,
    rate: vals.rate,
    duration: null,
    supplierId: existing?.supplierId ?? null,
    supplierName: existing?.supplierName ?? null,
    source: existing?.source ?? null,
    included: vals.included,
    notes: item.notes,
    metadata: mergeLumpMeta(existing?.metadata ?? null, meta),
  };
}

/**
 * 编辑状态 → 要写的成本行（只涉及总价表管的行；明细行号按 details 的顺序从 1 重排）。
 * 带的成本行 id 不是这份报价里同一项的行时当作新的，原来那一行不动（同逐行表）。
 */
export function lumpStateToWrites(state: LumpState, current: readonly DbCostLine[]): LumpWrites {
  const idx = indexLumpLines(current);
  const out: LumpWrites = { updates: [], creates: [], deleteIds: [] };

  const gt = goodsTotalWrite(state, idx.goodsTotal);
  if (idx.goodsTotal) out.updates.push({ id: idx.goodsTotal.id, data: gt });
  else out.creates.push(gt);

  const goodsById = new Map(idx.goods.map((l) => [l.id, l]));
  const usedGoods = new Set<string>();
  state.details.forEach((row: LineRow, i) => {
    const existing = row.costLineId && goodsById.has(row.costLineId) && !usedGoods.has(row.costLineId) ? goodsById.get(row.costLineId)! : null;
    const data = goodsWrite(state, row, i + 1, existing);
    if (existing) {
      usedGoods.add(existing.id);
      out.updates.push({ id: existing.id, data });
    } else out.creates.push(data);
  });
  for (const id of goodsById.keys()) if (!usedGoods.has(id)) out.deleteIds.push(id);

  const itemsById = new Map(idx.items.map((i) => [i.line.id, i]));
  const usedItems = new Set<string>();
  let nextSeq = Math.max(0, ...idx.items.map((i) => i.meta.seq ?? 0), ...state.items.map((i) => i.seq ?? 0));
  for (const item of state.items) {
    const hit = item.costLineId ? itemsById.get(item.costLineId) : undefined;
    const existing = hit && hit.meta.key === item.key && !usedItems.has(hit.line.id) ? hit : null;
    const seq = item.key === "other" ? existing?.meta.seq ?? item.seq ?? ++nextSeq : null;
    const data = itemWrite(state, item, seq, existing?.line ?? null);
    if (existing) {
      usedItems.add(existing.line.id);
      out.updates.push({ id: existing.line.id, data });
    } else out.creates.push(data);
  }
  for (const id of itemsById.keys()) if (!usedItems.has(id)) out.deleteIds.push(id);

  for (const key of ["financing", "admin", "cash_allowance", "commission"] as const) {
    const existing = idx.preset[key] ?? null;
    const data = presetWrite(state, key, existing);
    if (existing) out.updates.push({ id: existing.id, data });
    else out.creates.push(data);
  }
  return out;
}
