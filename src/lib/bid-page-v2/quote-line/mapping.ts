/**
 * BIDPAGE-3 逐行报价 — 编辑状态 ↔ 报价引擎成本行（纯函数，服务端用；定点换算用 Prisma.Decimal）
 *
 * - 写：`stateToWrites(state, current)` 只产出由逐行表管理的行（货品 / 共用参数 / 预置）的新建、更新与删除；
 *   没有行身份的成本行（专业模式里加的）一律不出现在结果里，也就不会被碰。
 * - 读：`costLinesToState(lines, quote)` 把成本行还原成编辑状态，专业模式里改过的地方照实读出并给一句提示。
 * - 种子：`seedRowsFromSchedule` / `defaultLineModeState`；预置与共用参数的计算方式、比例、月数取自
 *   `templateSupplyOnlyLines()`（与专业模式只供货模板同一来源，测试逐项对照）。
 */
import { Prisma } from "@prisma/client";
import type { PriceScheduleLine } from "@/lib/tender-price-schedule/contract";
import { templateSupplyOnlyLines } from "@/lib/quote-engine/templates";
import {
  COST_LINE_DESCRIPTION_MAX,
  LINE_EVIDENCE_LABELS_ZH,
  LINE_UOMS,
  mergeBidLineMeta,
  piecesPerUnit,
  readBidLineMeta,
  type BidLineMeta,
  type GoodsLineMeta,
  type LineModeState,
  type LineQuoteBasis,
  type LineRow,
  type LineRowSource,
  type PresetKey,
  type SharedKey,
} from "./contract";

/** 成本行（库里的一行；与 `QuoteRecord["costLines"][number]` 字段相同，只取用到的） */
export type DbCostLine = {
  id: string;
  sortOrder: number;
  category: string;
  subcategory: string | null;
  description: string;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  unitCost: Prisma.Decimal | null;
  sourceCurrency: string;
  fxRate: Prisma.Decimal | null;
  fxRateSource: string | null;
  calculationType: string;
  calculationBase: string | null;
  rate: Prisma.Decimal | null;
  duration: Prisma.Decimal | null;
  supplierId: string | null;
  supplierName: string | null;
  source: string | null;
  notes: string | null;
  included: boolean;
  metadata: unknown;
};

/** 一条要写的成本行（字段与 `QuoteCostLine` 相同；数字用 number，写库时由服务转 Decimal） */
export type CostLineWrite = {
  sortOrder: number;
  category: string;
  subcategory: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number | null;
  sourceCurrency: string;
  fxRate: number | null;
  fxRateSource: string | null;
  calculationType: string;
  calculationBase: string | null;
  rate: number | null;
  duration: number | null;
  supplierId: string | null;
  supplierName: string | null;
  source: string | null;
  included: boolean;
  metadata: Record<string, unknown>;
};

export type Writes = { updates: Array<{ id: string; data: CostLineWrite }>; creates: CostLineWrite[]; deleteIds: string[] };

/* --------------------------------- 模板 --------------------------------- */

type TemplateSeed = ReturnType<typeof templateSupplyOnlyLines>[number];

/** 从只供货模板里取逐行报价用到的行（按类别 + 计算方式认，同一组合取第一条） */
export function lineModeTemplate(): { goods: TemplateSeed; shared: Record<SharedKey, TemplateSeed>; preset: Record<PresetKey, TemplateSeed> } {
  const t = templateSupplyOnlyLines();
  const pick = (category: string, calculationType: string): TemplateSeed => {
    const hit = t.find((l) => l.category === category && l.calculationType === calculationType);
    if (!hit) throw new Error(`只供货模板里没有 ${category}/${calculationType}`);
    return hit;
  };
  return {
    goods: pick("PROCUREMENT", "PER_UNIT"),
    shared: {
      ocean_freight: pick("FREIGHT", "PER_CONTAINER"),
      customs: pick("CUSTOMS", "FIXED"),
      duty: pick("DUTY", "PERCENT_OF_COST"),
      domestic_freight: pick("LOGISTICS", "FIXED"),
    },
    preset: {
      financing: pick("FINANCING", "PCT_ANNUALIZED_ON_COST"),
      admin: pick("ADMIN", "PCT_SELF_INCLUSIVE_ON_COST"),
      cash_allowance: pick("OTHER", "PCT_ON_COST_SUBTOTAL"),
      commission: pick("COMMISSION", "PCT_OF_GROSS_PROFIT"),
    },
  };
}

/** 逐行报价新建的行用的中文说明（新代码路径；模板本身的说明不改，见 BIDPAGE-8） */
export const SHARED_DESCRIPTION_ZH: Record<SharedKey, string> = {
  ocean_freight: "海运费（柜数 × 每柜）",
  customs: "报关费",
  duty: "关税（货值 × 关税率）",
  domestic_freight: "国内运费（中国境内）",
};
export const PRESET_DESCRIPTION_ZH: Record<PresetKey, string> = {
  financing: "资金使用（到手成本 × 年化比例 ÷ 12 × 月数）",
  admin: "管理费（自含：基数 ÷（1 − 比例）− 基数，100 → 103.09）",
  cash_allowance: "现金备用金（到手成本 × 比例）",
  commission: "提成（毛利 × 比例，计入成本）",
};

const SHARED_SORT: Record<SharedKey, number> = { domestic_freight: 1010, ocean_freight: 1020, customs: 1030, duty: 1040 };
const PRESET_SORT: Record<PresetKey, number> = { financing: 2010, admin: 2020, cash_allowance: 2030, commission: 2040 };

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
/** 与库里 Decimal(18,4) 落库一致：先在这里取到 4 位 */
const to4 = (v: Prisma.Decimal.Value) => Number(new Prisma.Decimal(v).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP));

/** 按口径把供应商报价换成招标单位价（取到 4 位）；按件且缺包装数 → null（校验时已拒绝） */
export function tenderUnitCost(row: Pick<LineRow, "unitPrice" | "basis" | "uom" | "packCount">): number | null {
  if (row.unitPrice == null) return null;
  if (row.basis === "PER_TENDER_UOM") return to4(row.unitPrice);
  const pieces = piecesPerUnit(row.uom, row.packCount);
  if (pieces == null) return null;
  return to4(new Prisma.Decimal(row.unitPrice).times(pieces));
}

/* --------------------------------- 种子 --------------------------------- */

export function emptyRow(source: LineRowSource): LineRow {
  return { costLineId: null, description: "", quantity: 1, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: null, currency: "CNY", evidenceKind: null, inquiryItemId: null, supplierId: null, supplierName: null, rowSource: source };
}

/** 价格表行 → 逐行报价的行（来源：价格表） */
export function seedRowsFromSchedule(lines: readonly PriceScheduleLine[], source: LineRowSource = "schedule"): LineRow[] {
  return [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => ({
      ...emptyRow(source),
      description: l.description,
      quantity: Number(l.quantity),
      uom: l.uom,
      packCount: l.packCount ?? null,
    }));
}

export function defaultLineModeState(rows: LineRow[]): LineModeState {
  const t = lineModeTemplate();
  const rateOf = (s: TemplateSeed) => s.rate ?? null;
  return {
    rows,
    fx: rows.some((r) => r.currency !== "CAD") ? Object.fromEntries([...new Set(rows.filter((r) => r.currency !== "CAD").map((r) => r.currency))].map((c) => [c, { rate: null, source: null }])) : {},
    shared: {
      oceanFreight: { containers: null, perContainer: null, currency: "CAD" },
      customs: { amount: null, currency: "CAD" },
      domesticFreight: { amount: null, currency: "CAD" },
      dutyPct: null,
    },
    presets: {
      financing: { ratePct: rateOf(t.preset.financing), months: t.preset.financing.duration ?? null, included: t.preset.financing.included },
      admin: { ratePct: rateOf(t.preset.admin), included: t.preset.admin.included },
      cashAllowance: { ratePct: rateOf(t.preset.cash_allowance), included: t.preset.cash_allowance.included },
      commission: { ratePct: rateOf(t.preset.commission), included: t.preset.commission.included },
    },
    targetMarginPct: null,
  };
}

/* --------------------------------- 写 --------------------------------- */

type ManagedIndex = {
  goods: Map<string, DbCostLine>;
  shared: Partial<Record<SharedKey, DbCostLine>>;
  preset: Partial<Record<PresetKey, DbCostLine>>;
  others: DbCostLine[];
};

/** 按行身份把现有成本行分成：货品、共用参数、预置、其它（同一键出现两次时只认第一条，其余算其它） */
export function indexManagedLines(lines: readonly DbCostLine[]): ManagedIndex {
  const idx: ManagedIndex = { goods: new Map(), shared: {}, preset: {}, others: [] };
  for (const l of [...lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const meta = readBidLineMeta(l.metadata);
    if (meta?.role === "goods") idx.goods.set(l.id, l);
    else if (meta?.role === "shared" && !idx.shared[meta.key]) idx.shared[meta.key] = l;
    else if (meta?.role === "preset" && !idx.preset[meta.key]) idx.preset[meta.key] = l;
    else idx.others.push(l);
  }
  return idx;
}

function fxFor(state: LineModeState, currency: string): { fxRate: number | null; fxRateSource: string | null } {
  if (currency === "CAD") return { fxRate: null, fxRateSource: null };
  const e = state.fx[currency];
  return { fxRate: e?.rate ?? null, fxRateSource: e?.source ?? null };
}

function goodsWrite(state: LineModeState, row: LineRow, lineNo: number, existing: DbCostLine | null): CostLineWrite {
  const t = lineModeTemplate().goods;
  const meta: GoodsLineMeta = {
    v: 1,
    role: "goods",
    lineNo,
    description: row.description,
    uom: row.uom,
    packCount: row.packCount,
    basis: row.basis,
    enteredUnitPrice: row.unitPrice,
    evidenceKind: row.inquiryItemId ? null : row.evidenceKind,
    inquiryItemId: row.inquiryItemId,
    rowSource: row.rowSource,
  };
  const source = row.inquiryItemId ? "询价回复" : row.evidenceKind ? LINE_EVIDENCE_LABELS_ZH[row.evidenceKind] : null;
  return {
    sortOrder: lineNo,
    category: t.category,
    subcategory: t.subcategory ?? null,
    description: clip(row.description, COST_LINE_DESCRIPTION_MAX),
    quantity: row.quantity,
    unit: row.uom,
    unitCost: tenderUnitCost(row),
    sourceCurrency: row.currency,
    ...fxFor(state, row.currency),
    calculationType: t.calculationType,
    calculationBase: null,
    rate: null,
    duration: null,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    source,
    included: true,
    metadata: mergeBidLineMeta(existing?.metadata ?? null, meta),
  };
}

function sharedWrite(state: LineModeState, key: SharedKey, existing: DbCostLine | null): CostLineWrite {
  const t = lineModeTemplate().shared[key];
  const meta: BidLineMeta = { v: 1, role: "shared", key };
  const s = state.shared;
  // 空着 = 这项没有（不计入）；不计入时保留库里原有的数，不清掉
  const keep = { quantity: num(existing?.quantity), unitCost: num(existing?.unitCost), rate: num(existing?.rate), duration: num(existing?.duration), sourceCurrency: existing?.sourceCurrency ?? "CAD" };
  let vals: { quantity: number | null; unitCost: number | null; rate: number | null; duration: number | null; sourceCurrency: string; included: boolean };
  if (key === "ocean_freight") {
    const on = s.oceanFreight.perContainer != null && s.oceanFreight.containers != null;
    vals = on ? { quantity: null, unitCost: s.oceanFreight.perContainer, rate: null, duration: s.oceanFreight.containers, sourceCurrency: s.oceanFreight.currency, included: true } : { ...keep, included: false };
  } else if (key === "customs" || key === "domestic_freight") {
    const p = key === "customs" ? s.customs : s.domesticFreight;
    vals = p.amount != null ? { quantity: null, unitCost: p.amount, rate: null, duration: null, sourceCurrency: p.currency, included: true } : { ...keep, included: false };
  } else {
    vals = s.dutyPct != null ? { quantity: null, unitCost: null, rate: s.dutyPct, duration: null, sourceCurrency: "CAD", included: true } : { ...keep, included: false };
  }
  return {
    sortOrder: SHARED_SORT[key],
    category: t.category,
    subcategory: t.subcategory ?? null,
    description: SHARED_DESCRIPTION_ZH[key],
    quantity: vals.quantity,
    unit: t.unit ?? null,
    unitCost: vals.unitCost,
    sourceCurrency: vals.sourceCurrency,
    ...fxFor(state, vals.sourceCurrency),
    calculationType: t.calculationType,
    calculationBase: t.calculationBase ?? null,
    rate: vals.rate,
    duration: vals.duration,
    supplierId: existing?.supplierId ?? null,
    supplierName: existing?.supplierName ?? null,
    source: existing?.source ?? null,
    included: vals.included,
    metadata: mergeBidLineMeta(existing?.metadata ?? null, meta),
  };
}

function presetWrite(state: LineModeState, key: PresetKey, existing: DbCostLine | null): CostLineWrite {
  const t = lineModeTemplate().preset[key];
  const meta: BidLineMeta = { v: 1, role: "preset", key };
  const p = state.presets;
  const v = key === "financing" ? p.financing : key === "admin" ? p.admin : key === "cash_allowance" ? p.cashAllowance : p.commission;
  return {
    sortOrder: PRESET_SORT[key],
    category: t.category,
    subcategory: t.subcategory ?? null,
    description: PRESET_DESCRIPTION_ZH[key],
    quantity: null,
    unit: null,
    unitCost: null,
    sourceCurrency: "CAD",
    fxRate: null,
    fxRateSource: null,
    calculationType: t.calculationType,
    calculationBase: t.calculationBase ?? null,
    rate: v.ratePct,
    duration: key === "financing" ? p.financing.months : null,
    supplierId: null,
    supplierName: null,
    source: existing?.source ?? null,
    included: v.included,
    metadata: mergeBidLineMeta(existing?.metadata ?? null, meta),
  };
}

/**
 * 编辑状态 → 要写的成本行。只涉及由逐行表管理的行；行号按 rows 的顺序从 1 重排。
 * 行带的 costLineId 不属于这份报价的货品行（例如已被专业模式删掉）时，当作新行。
 */
export function stateToWrites(state: LineModeState, current: readonly DbCostLine[]): Writes {
  const idx = indexManagedLines(current);
  const out: Writes = { updates: [], creates: [], deleteIds: [] };
  const used = new Set<string>();
  state.rows.forEach((row, i) => {
    const existing = row.costLineId && idx.goods.has(row.costLineId) && !used.has(row.costLineId) ? idx.goods.get(row.costLineId)! : null;
    const data = goodsWrite(state, row, i + 1, existing);
    if (existing) {
      used.add(existing.id);
      out.updates.push({ id: existing.id, data });
    } else out.creates.push(data);
  });
  for (const id of idx.goods.keys()) if (!used.has(id)) out.deleteIds.push(id);
  for (const key of ["domestic_freight", "ocean_freight", "customs", "duty"] as const) {
    const existing = idx.shared[key] ?? null;
    const data = sharedWrite(state, key, existing);
    if (existing) out.updates.push({ id: existing.id, data });
    else out.creates.push(data);
  }
  for (const key of ["financing", "admin", "cash_allowance", "commission"] as const) {
    const existing = idx.preset[key] ?? null;
    const data = presetWrite(state, key, existing);
    if (existing) out.updates.push({ id: existing.id, data });
    else out.creates.push(data);
  }
  return out;
}

/* --------------------------------- 读 --------------------------------- */

export function costLinesToState(
  lines: readonly DbCostLine[],
  quote: { pricingMethod: string; pricingRate: Prisma.Decimal | null },
): { state: LineModeState; goodsIds: string[]; others: DbCostLine[]; notices: string[] } {
  const idx = indexManagedLines(lines);
  const notices: string[] = [];
  const t = lineModeTemplate();
  const goods = [...idx.goods.values()]
    .map((l) => ({ l, meta: readBidLineMeta(l.metadata) as GoodsLineMeta }))
    .sort((a, b) => a.meta.lineNo - b.meta.lineNo || a.l.sortOrder - b.l.sortOrder);

  const fx: LineModeState["fx"] = {};
  const fxSeen = new Map<string, Set<number>>();
  const noteFx = (l: DbCostLine) => {
    if (l.sourceCurrency === "CAD") return;
    const r = num(l.fxRate);
    if (!fx[l.sourceCurrency]) fx[l.sourceCurrency] = { rate: r, source: l.fxRateSource };
    else if (fx[l.sourceCurrency].rate == null && r != null) fx[l.sourceCurrency] = { rate: r, source: l.fxRateSource };
    if (r != null) {
      const s = fxSeen.get(l.sourceCurrency) ?? new Set<number>();
      s.add(r);
      fxSeen.set(l.sourceCurrency, s);
    }
  };

  const rows: LineRow[] = goods.map(({ l, meta }, i) => {
    const rowNo = i + 1;
    noteFx(l);
    const stored = num(l.unitCost);
    let unitPrice = meta.enteredUnitPrice;
    let basis: LineQuoteBasis = meta.basis;
    const expected = tenderUnitCost({ unitPrice, basis, uom: meta.uom, packCount: meta.packCount });
    if (stored !== expected) {
      // 专业模式里直接改了单价：按改后的价（招标单位）读出
      unitPrice = stored;
      basis = "PER_TENDER_UOM";
      if (stored != null || expected != null) notices.push(`第 ${rowNo} 行的单价在专业模式里改过，这里按改后的价显示（按招标单位）`);
    }
    const description = clip(meta.description, COST_LINE_DESCRIPTION_MAX) === l.description ? meta.description : l.description;
    if (description !== meta.description) notices.push(`第 ${rowNo} 行的品名在专业模式里改过，这里按改后的显示`);
    return {
      costLineId: l.id,
      description,
      quantity: num(l.quantity) ?? 0,
      uom: (LINE_UOMS as readonly string[]).includes(meta.uom) ? meta.uom : "Each",
      packCount: meta.packCount,
      basis,
      unitPrice,
      currency: l.sourceCurrency,
      evidenceKind: meta.evidenceKind,
      inquiryItemId: meta.inquiryItemId,
      supplierId: l.supplierId,
      supplierName: l.supplierName,
      rowSource: meta.rowSource,
    };
  });

  const sh = idx.shared;
  for (const key of ["ocean_freight", "customs", "duty", "domestic_freight"] as const) {
    const l = sh[key];
    if (!l) notices.push(`「${SHARED_DESCRIPTION_ZH[key]}」这一行在专业模式里删掉了，保存时会重新建一条（空着就不计入）`);
    else if (l.included) noteFx(l);
  }
  const on = (l: DbCostLine | undefined) => (l && l.included ? l : null);
  const ocean = on(sh.ocean_freight);
  const customs = on(sh.customs);
  const dom = on(sh.domestic_freight);
  const duty = on(sh.duty);

  const pr = idx.preset;
  const presetOf = (key: PresetKey) => {
    const l = pr[key];
    if (!l) {
      notices.push(`「${PRESET_DESCRIPTION_ZH[key]}」这一行在专业模式里删掉了，这里先按关掉显示`);
      return { ratePct: t.preset[key].rate ?? null, included: false, months: t.preset[key].duration ?? null };
    }
    return { ratePct: num(l.rate), included: l.included, months: num(l.duration) };
  };
  const fin = presetOf("financing");

  for (const [ccy, rates] of fxSeen) {
    if (rates.size > 1) notices.push(`${ccy} 在不同的行上填了不同的汇率（${[...rates].join("、")}），这里显示第一个，保存后统一成一个`);
  }
  if (quote.pricingMethod !== "MARGIN_ON_REVENUE") notices.push("定价方式在专业模式里改成了成本加成；逐行报价按售价毛利定价，保存时会改回");

  return {
    state: {
      rows,
      fx,
      shared: {
        oceanFreight: { containers: num(ocean?.duration), perContainer: num(ocean?.unitCost), currency: ocean?.sourceCurrency ?? "CAD" },
        customs: { amount: num(customs?.unitCost), currency: customs?.sourceCurrency ?? "CAD" },
        domesticFreight: { amount: num(dom?.unitCost), currency: dom?.sourceCurrency ?? "CAD" },
        dutyPct: num(duty?.rate),
      },
      presets: {
        financing: { ratePct: fin.ratePct, months: fin.months, included: fin.included },
        admin: (({ ratePct, included }) => ({ ratePct, included }))(presetOf("admin")),
        cashAllowance: (({ ratePct, included }) => ({ ratePct, included }))(presetOf("cash_allowance")),
        commission: (({ ratePct, included }) => ({ ratePct, included }))(presetOf("commission")),
      },
      targetMarginPct: quote.pricingMethod === "MARGIN_ON_REVENUE" ? num(quote.pricingRate) : null,
    },
    goodsIds: goods.map((g) => g.l.id),
    others: idx.others,
    notices,
  };
}
