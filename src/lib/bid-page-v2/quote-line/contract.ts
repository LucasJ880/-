/**
 * BIDPAGE-3 逐行报价 — 契约（纯定义 + 校验，前后端共用；不引 Prisma，可进浏览器包）
 *
 * 逐行报价是报价引擎成本行的另一种排法（design D2 / D3）：
 *   - 一个价格表行 = 一条货品成本行（PROCUREMENT / PER_UNIT）；
 *   - 四项共用参数（海运费、报关费、关税、国内运费）与四项预置（资金使用、管理费、现金备用金、提成）各一条成本行；
 *   - 汇率不是成本行，写在每条该币种的行上（一种币一个汇率）。
 * 由逐行表管理的成本行在 `QuoteCostLine.metadata.bidLine` 里带行身份；没有它的行（专业模式里加的）逐行保存不碰。
 *
 * 词表与两个既有词表逐项相同（`QUOTE_EVIDENCE_KINDS`、`PRICE_SCHEDULE_UOMS`——那两处引 Prisma，进不了浏览器），由测试对照。
 */
import type { OurBidLine } from "../quote-confirm/contract";
import { z } from "zod";
import { QUOTE_CURRENCIES, engineConfigSchema } from "@/lib/quote-engine/contract";

export const BID_LINE_META_KEY = "bidLine" as const;
export const BID_LINE_META_VERSION = 1 as const;

/** 行数上限（与招标分析带入价格表同一上限） */
export const LINE_MODE_MAX_ROWS = 300;
/** 品名上限（与价格表行说明一致）；成本行 description 只收 300 字，超出时截断、完整说明留在行身份里 */
export const LINE_DESCRIPTION_MAX = 500;
export const COST_LINE_DESCRIPTION_MAX = 300;

/** 与 `tender-bid-cost/contract.ts` 的 QUOTE_EVIDENCE_KINDS / 中文名逐项相同 */
export const LINE_EVIDENCE_KINDS = ["SIGNED_QUOTE", "PLATFORM_LISTED", "RETAIL_PRICE", "ESTIMATE"] as const;
export type LineEvidenceKind = (typeof LINE_EVIDENCE_KINDS)[number];
export const LINE_EVIDENCE_LABELS_ZH: Record<LineEvidenceKind, string> = {
  SIGNED_QUOTE: "已签报价",
  PLATFORM_LISTED: "平台标价",
  RETAIL_PRICE: "零售价",
  ESTIMATE: "估计",
};

/** 与 `tender-price-schedule/contract.ts` 的 PRICE_SCHEDULE_UOMS 逐项相同 */
export const LINE_UOMS = ["Each", "Pack", "Box", "Roll", "Pair", "Set", "Case", "Bag", "kg", "m", "ft", "sqft"] as const;
/** 单位保留招标方价格表的原文（导出原样写回），下拉里附中文（任务书附录 A） */
export const LINE_UOM_ZH: Record<(typeof LINE_UOMS)[number], string> = {
  Each: "个",
  Pack: "包",
  Box: "盒",
  Roll: "卷",
  Pair: "双",
  Set: "套",
  Case: "箱",
  Bag: "袋",
  kg: "千克",
  m: "米",
  ft: "英尺",
  sqft: "平方英尺",
};
export const uomLabelZh = (u: string) => {
  const zh = (LINE_UOM_ZH as Record<string, string>)[u];
  return zh ? `${u}（${zh}）` : u;
};

/** 币种中文名（与「下一步」金额写法同一张表） */
export const CURRENCY_NAME_ZH: Record<string, string> = { CAD: "加元", USD: "美元", CNY: "人民币", EUR: "欧元", GBP: "英镑" };
export const currencyLabelZh = (c: string) => (CURRENCY_NAME_ZH[c] ? `${CURRENCY_NAME_ZH[c]}（${c}）` : c);

/** 数量、金额的上限：超出库里 Decimal 的位数会写库失败（只为挡住明显填错的数） */
export const LINE_QUANTITY_MAX = 100_000_000;
export const LINE_PACK_COUNT_MAX = 100_000;
export const LINE_PRICE_MAX = 100_000_000;
export const LINE_ROW_AMOUNT_MAX = 1_000_000_000_000;
export const LINE_FX_RATE_MAX = 10_000;
export const LINE_SHARED_AMOUNT_MAX = 10_000_000_000;

/** 成组单位（与 `tender-price-schedule/contract.ts` 的 GROUPED_UOMS 相同）：按件报价必须有包装数 */
export const LINE_GROUPED_UOMS = ["Pack", "Box", "Roll", "Set", "Case", "Bag"] as const;
export function piecesPerUnit(uom: string, packCount: number | null): number | null {
  if (packCount != null) return packCount;
  return (LINE_GROUPED_UOMS as readonly string[]).includes(uom) ? null : 1;
}

/** 报价口径：按件 / 按招标单位（与 `unit-conversion.ts` 的 QUOTE_BASES 相同） */
export const LINE_QUOTE_BASES = ["PER_PIECE", "PER_TENDER_UOM"] as const;
export type LineQuoteBasis = (typeof LINE_QUOTE_BASES)[number];

export const LINE_ROW_SOURCES = ["schedule", "analysis", "paste", "manual"] as const;
export type LineRowSource = (typeof LINE_ROW_SOURCES)[number];

export const SHARED_KEYS = ["ocean_freight", "customs", "duty", "domestic_freight"] as const;
export type SharedKey = (typeof SHARED_KEYS)[number];
export const PRESET_KEYS = ["financing", "admin", "cash_allowance", "commission"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/** 逐行报价 = 做法字段是 LINE，且是只供货报价（逐行只配只供货；别的类型即使带了这个字段也按专业模式打开） */
export function isLineModeQuote(q: { engineJson: unknown; quoteType: string }): boolean {
  if (q.quoteType !== "SUPPLY_ONLY") return false;
  const parsed = engineConfigSchema.safeParse(q.engineJson ?? {});
  return parsed.success && parsed.data.entryMode === "LINE";
}

/* ------------------------------ 行身份（metadata.bidLine） ------------------------------ */

const goodsMetaSchema = z.object({
  v: z.literal(BID_LINE_META_VERSION),
  role: z.literal("goods"),
  lineNo: z.number().int().min(1),
  description: z.string().min(1).max(LINE_DESCRIPTION_MAX),
  uom: z.string().min(1).max(30),
  packCount: z.number().int().min(1).nullable(),
  basis: z.enum(LINE_QUOTE_BASES),
  /** 人填 / 点选时的原价（按 basis 口径、原币），字符串保留原样；成本行 unitCost 是换成招标单位后的价 */
  enteredUnitPrice: z.number().finite().min(0).nullable(),
  evidenceKind: z.enum(LINE_EVIDENCE_KINDS).nullable(),
  inquiryItemId: z.string().min(1).max(64).nullable(),
  rowSource: z.enum(LINE_ROW_SOURCES),
});
const sharedMetaSchema = z.object({ v: z.literal(BID_LINE_META_VERSION), role: z.literal("shared"), key: z.enum(SHARED_KEYS) });
const presetMetaSchema = z.object({ v: z.literal(BID_LINE_META_VERSION), role: z.literal("preset"), key: z.enum(PRESET_KEYS) });
export const bidLineMetaSchema = z.discriminatedUnion("role", [goodsMetaSchema, sharedMetaSchema, presetMetaSchema]);
export type GoodsLineMeta = z.infer<typeof goodsMetaSchema>;
export type BidLineMeta = z.infer<typeof bidLineMetaSchema>;

/** 从成本行的 metadata 读行身份；没有或读不出 → null（当作专业模式里加的其它成本行） */
export function readBidLineMeta(metadata: unknown): BidLineMeta | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>)[BID_LINE_META_KEY];
  const parsed = bidLineMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** 合并行身份进既有 metadata：其它键（成本导入的来源记录等）原样保留 */
export function mergeBidLineMeta(metadata: unknown, meta: BidLineMeta): Record<string, unknown> {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  base[BID_LINE_META_KEY] = meta;
  return base;
}

/* ------------------------------ 编辑状态（接口 ↔ 界面） ------------------------------ */

export type LineRow = {
  /** 已存的货品成本行 id；新行为 null */
  costLineId: string | null;
  description: string;
  quantity: number;
  uom: string;
  packCount: number | null;
  basis: LineQuoteBasis;
  /** 供应商报价（原币，按 basis 口径）；null = 还没填 */
  unitPrice: number | null;
  currency: string;
  evidenceKind: LineEvidenceKind | null;
  inquiryItemId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  rowSource: LineRowSource;
};

export type FxEntry = { rate: number | null; source: string | null };
export type MoneyParam = { amount: number | null; currency: string };
export type SharedState = {
  oceanFreight: { containers: number | null; perContainer: number | null; currency: string };
  customs: MoneyParam;
  domesticFreight: MoneyParam;
  dutyPct: number | null;
};
export type PresetState = {
  financing: { ratePct: number | null; months: number | null; included: boolean };
  admin: { ratePct: number | null; included: boolean };
  cashAllowance: { ratePct: number | null; included: boolean };
  commission: { ratePct: number | null; included: boolean };
};
export type LineModeState = {
  rows: LineRow[];
  /** 每种外币一个汇率：1 原币 = rate 加元 */
  fx: Record<string, FxEntry>;
  shared: SharedState;
  presets: PresetState;
  /** 目标毛利率（按售价，%）——报价引擎 MARGIN_ON_REVENUE 的比例 */
  targetMarginPct: number | null;
};

const nullableNum = z.number().finite().nullable();
const currency = z.enum(QUOTE_CURRENCIES);
const rowSchema = z.object({
  costLineId: z.string().min(1).max(64).nullable(),
  description: z.string(),
  quantity: z.number().finite(),
  uom: z.string(),
  packCount: z.number().int().nullable(),
  basis: z.enum(LINE_QUOTE_BASES),
  unitPrice: nullableNum,
  currency,
  evidenceKind: z.enum(LINE_EVIDENCE_KINDS).nullable(),
  inquiryItemId: z.string().min(1).max(64).nullable(),
  supplierId: z.string().min(1).max(64).nullable(),
  supplierName: z.string().max(120).nullable(),
  rowSource: z.enum(LINE_ROW_SOURCES),
});
const moneySchema = z.object({ amount: nullableNum, currency });
export const lineModeStateSchema = z.object({
  rows: z.array(rowSchema).max(LINE_MODE_MAX_ROWS),
  fx: z.record(z.string(), z.object({ rate: nullableNum, source: z.string().max(40).nullable() })),
  shared: z.object({
    oceanFreight: z.object({ containers: nullableNum, perContainer: nullableNum, currency }),
    customs: moneySchema,
    domesticFreight: moneySchema,
    dutyPct: nullableNum,
  }),
  presets: z.object({
    financing: z.object({ ratePct: nullableNum, months: nullableNum, included: z.boolean() }),
    admin: z.object({ ratePct: nullableNum, included: z.boolean() }),
    cashAllowance: z.object({ ratePct: nullableNum, included: z.boolean() }),
    commission: z.object({ ratePct: nullableNum, included: z.boolean() }),
  }),
  targetMarginPct: nullableNum,
});

export const saveLineModeRequestSchema = z.object({
  /** 读取时报价的修改时间（ISO）；与库里不同 → 409 */
  baseUpdatedAt: z.string().min(1).max(40),
  state: lineModeStateSchema,
});
export type SaveLineModeRequest = z.infer<typeof saveLineModeRequestSchema>;

export type LineModeIssue = { rowNo: number | null; messageZh: string };

export const squash = (s: string) => s.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
/** 小数位不超过 n（与库里 Decimal 的位数一致；0.00004 这类会被取成 0 的数也在这里挡住） */
export const fitsDecimals = (v: number, n: number) => {
  const t = String(Math.abs(v));
  if (/e-/i.test(t)) return false;
  if (/e\+/i.test(t)) return true;
  return (t.split(".")[1] ?? "").length <= n;
};

/**
 * 业务校验（结构由 zod 先过）：中文说明指到第几行；全部问题一次列出，不猜不改。
 * 返回整理过的状态（品名并空白、行内没用的字段清空）。
 */
export function validateLineModeState(state: LineModeState): { ok: true; state: LineModeState } | { ok: false; issues: LineModeIssue[] } {
  const issues: LineModeIssue[] = [];
  const usedCurrencies = new Set<string>();
  const rows: LineRow[] = state.rows.map((r, i) => {
    const rowNo = i + 1;
    const description = squash(r.description);
    if (!description) issues.push({ rowNo, messageZh: `第 ${rowNo} 行要填品名` });
    else if (description.length > LINE_DESCRIPTION_MAX) issues.push({ rowNo, messageZh: `第 ${rowNo} 行品名最多 ${LINE_DESCRIPTION_MAX} 字` });
    if (!(r.quantity > 0)) issues.push({ rowNo, messageZh: `第 ${rowNo} 行数量要大于 0` });
    else if (!fitsDecimals(r.quantity, 4)) issues.push({ rowNo, messageZh: `第 ${rowNo} 行数量最多 4 位小数` });
    else if (r.quantity > LINE_QUANTITY_MAX) issues.push({ rowNo, messageZh: `第 ${rowNo} 行数量太大（最多 ${LINE_QUANTITY_MAX.toLocaleString("en-US")}），请检查` });
    if (!(LINE_UOMS as readonly string[]).includes(r.uom)) issues.push({ rowNo, messageZh: `第 ${rowNo} 行的单位要从列表里选` });
    if (r.packCount != null && (r.packCount < 1 || r.packCount > LINE_PACK_COUNT_MAX)) issues.push({ rowNo, messageZh: `第 ${rowNo} 行包装数要是 1 到 ${LINE_PACK_COUNT_MAX.toLocaleString("en-US")} 之间的整数` });
    if (r.unitPrice != null && r.unitPrice < 0) issues.push({ rowNo, messageZh: `第 ${rowNo} 行的供应商报价不能是负数` });
    else if (r.unitPrice != null && r.unitPrice > LINE_PRICE_MAX) issues.push({ rowNo, messageZh: `第 ${rowNo} 行的供应商报价太大（最多 ${LINE_PRICE_MAX.toLocaleString("en-US")}），请检查` });
    else if (r.unitPrice != null && r.quantity > 0 && r.unitPrice * r.quantity * (r.basis === "PER_PIECE" ? piecesPerUnit(r.uom, r.packCount) ?? 1 : 1) > LINE_ROW_AMOUNT_MAX) {
      issues.push({ rowNo, messageZh: `第 ${rowNo} 行金额太大（数量 × 单价超过一万亿），请检查数量和单价` });
    }
    if (r.basis === "PER_PIECE" && piecesPerUnit(r.uom, r.packCount) == null) {
      issues.push({ rowNo, messageZh: `第 ${rowNo} 行单位是 ${r.uom}、没有包装数，不能按件报价：请改成按招标单位报价，或删掉这一行、在粘贴框里写上包装数后重新导入` });
    }
    if (r.unitPrice != null && !r.inquiryItemId && !r.evidenceKind) issues.push({ rowNo, messageZh: `第 ${rowNo} 行的供应商报价是手填的，要选证据类别（已签报价 / 平台标价 / 零售价 / 估计）` });
    if (r.unitPrice != null && r.currency !== "CAD") usedCurrencies.add(r.currency);
    return {
      ...r,
      description,
      // 从询价回复点选的行不需要证据类别；手填的行不带回复
      evidenceKind: r.inquiryItemId ? null : r.evidenceKind,
      supplierId: r.supplierId,
      supplierName: r.supplierName ? squash(r.supplierName) || null : null,
    };
  });
  const s = state.shared;
  const nonNeg = (v: number | null, label: string) => {
    if (v != null && v < 0) issues.push({ rowNo: null, messageZh: `${label}不能是负数` });
    else if (v != null && v > LINE_SHARED_AMOUNT_MAX) issues.push({ rowNo: null, messageZh: `${label}太大，请检查` });
  };
  nonNeg(s.oceanFreight.containers, "海运柜数");
  if (s.oceanFreight.containers != null && s.oceanFreight.containers > 0 && !fitsDecimals(s.oceanFreight.containers, 4)) issues.push({ rowNo: null, messageZh: "海运柜数最多 4 位小数" });
  nonNeg(s.oceanFreight.perContainer, "每柜海运费");
  nonNeg(s.customs.amount, "报关费");
  nonNeg(s.domesticFreight.amount, "国内运费");
  if (s.dutyPct != null && (s.dutyPct < 0 || s.dutyPct > 100)) issues.push({ rowNo: null, messageZh: "关税率要在 0 到 100 之间" });
  if (s.oceanFreight.perContainer != null && s.oceanFreight.currency !== "CAD") usedCurrencies.add(s.oceanFreight.currency);
  if (s.customs.amount != null && s.customs.currency !== "CAD") usedCurrencies.add(s.customs.currency);
  if (s.domesticFreight.amount != null && s.domesticFreight.currency !== "CAD") usedCurrencies.add(s.domesticFreight.currency);

  const p = state.presets;
  const pct = (v: number | null, label: string, max = 100) => {
    if (v != null && (v < 0 || v >= max)) issues.push({ rowNo: null, messageZh: `${label}要大于等于 0、小于 ${max}` });
  };
  pct(p.financing.ratePct, "资金使用年化比例");
  pct(p.admin.ratePct, "管理费比例");
  pct(p.cashAllowance.ratePct, "现金备用金比例");
  pct(p.commission.ratePct, "销售提成比例");
  if (p.financing.months != null && (p.financing.months <= 0 || p.financing.months > 120)) issues.push({ rowNo: null, messageZh: "资金使用月数要大于 0、不超过 120（不足一月按一月）" });
  pct(state.targetMarginPct, "目标毛利率");

  const fx: Record<string, FxEntry> = {};
  for (const [ccy, e] of Object.entries(state.fx)) {
    if (ccy === "CAD") continue;
    if (!(QUOTE_CURRENCIES as readonly string[]).includes(ccy)) {
      issues.push({ rowNo: null, messageZh: `币种 ${ccy} 用不了，请改成加元 / 人民币 / 美元 / 欧元 / 英镑之一` });
      continue;
    }
    if (e.rate != null && !(e.rate > 0)) issues.push({ rowNo: null, messageZh: `${currencyLabelZh(ccy)}汇率要大于 0` });
    else if (e.rate != null && e.rate > LINE_FX_RATE_MAX) issues.push({ rowNo: null, messageZh: `${currencyLabelZh(ccy)}汇率太大，请检查（1 ${ccy} = 多少加元）` });
    fx[ccy] = { rate: e.rate, source: e.source ? squash(e.source).slice(0, 40) || null : null };
  }
  for (const ccy of usedCurrencies) if (!fx[ccy]) fx[ccy] = { rate: null, source: null };

  if (issues.length) return { ok: false, issues };
  return { ok: true, state: { ...state, rows, fx } };
}

/* ------------------------------ 读接口的视图（只给看得到金额的人） ------------------------------ */

export type LineAllocationView = {
  /** 与 rows 同序；null = 这一行没填报价或引擎没算出 */
  lines: Array<{
    lineNo: number;
    goodsCad: number | null;
    landedCostCad: number | null;
    landedUnitCostCad: number | null;
    unitPrice: number | null;
    extended: number | null;
    marginPct: number | null;
  }>;
  /** Σ 行合计（已填报价的行） */
  linesTotal: number | null;
  /** 逐行合计 − 报价合计；不为 0 时界面单列说明 */
  diff: number | null;
  /** 差额上限 Σ(数量 × 0.005) */
  diffBound: number;
};

export type LineModeTotals = {
  sellingPrice: number;
  estimatedCost: number;
  grossProfit: number;
  grossMarginPct: number;
  landedCost: number;
};

export type LineModeWarning = { code: string; messageZh: string };

export type InquiryQuoteOption = {
  inquiryItemId: string;
  supplierId: string;
  supplierName: string;
  roundNumber: number;
  repliedAt: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string;
};

/** fromLump：带「只报总价」行身份的行（总价报价转成逐行后留下的项），界面写明来历，不说成专业模式里加的 */
export type OtherCostLineView = { id: string; description: string; category: string; amount: number | null; included: boolean; fromLump?: boolean };

export type LineModeView = {
  quote: { id: string; name: string | null; quoteNumber: string | null; quoteType: string; version: number; status: string; currency: string; updatedAt: string; frozen: boolean };
  capabilities: { canEdit: boolean; canApprove: boolean };
  state: LineModeState;
  /** 读取时的提示（例如同一币种有不同汇率、专业模式里删过共用参数行） */
  notices: string[];
  others: OtherCostLineView[];
  computed:
    | { ok: true; totals: LineModeTotals; allocation: LineAllocationView; warnings: LineModeWarning[] }
    | { ok: false; errorsZh: string[] };
  inquiryQuotes: InquiryQuoteOption[];
  /** 表里还没有行时才给：投标工作区存下的价格表是否可用、招标分析带入的粘贴文本 */
  seed: null | { scheduleLineCount: number; prefill: { state: string; messageZh: string; text: string } };
  proModeHref: string;
};

export type QuoteListItem = {
  id: string;
  name: string | null;
  quoteNumber: string | null;
  version: number;
  status: string;
  quoteType: string;
  /** 报价币种（专业模式能改）；逐行报价只按加元做 */
  currency: string;
  /** LINE = 逐行报价，LUMP_SUM = 只报总价（BIDPAGE-4），null = 专业模式 */
  entryMode: "LINE" | "LUMP_SUM" | null;
  sellingPrice: number | null;
  updatedAt: string;
  isOurBid: boolean;
  proModeHref: string;
};

export type ExportAvailability = { available: true; quoteId: string; version: number } | { available: false; reasonZh: string };

export type QuoteListView = {
  capabilities: { canEdit: boolean; canApprove: boolean };
  quotes: QuoteListItem[];
  scheduleLineCount: number;
  export: ExportAvailability;
  /** BIDPAGE-6：② 最上面的「我方报价」一行 */
  ourBid: OurBidLine;
};

export const BUSINESS_TYPES = ["SUPPLY_ONLY", "SUPPLY_INSTALL", "STANDING_OFFER"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_ZH: Record<BusinessType, string> = { SUPPLY_ONLY: "只供货", SUPPLY_INSTALL: "供货加安装", STANDING_OFFER: "长期供货协议" };
export const BUSINESS_TYPE_TO_QUOTE_TYPE: Record<BusinessType, string> = { SUPPLY_ONLY: "SUPPLY_ONLY", SUPPLY_INSTALL: "PROJECT_SUPPLY_INSTALL", STANDING_OFFER: "STANDING_OFFER" };

export const createQuoteRequestSchema = z.object({
  entryMode: z.enum(["LINE", "LUMP_SUM"]),
  businessType: z.enum(BUSINESS_TYPES).default("SUPPLY_ONLY"),
  name: z.string().max(160).nullable().optional(),
});

/** 报价类型 → 中文（列表、编辑器里报价没起名字时用） */
export const QUOTE_TYPE_ZH: Record<string, string> = { SUPPLY_ONLY: "只供货", PROJECT_SUPPLY_INSTALL: "供货加安装", STANDING_OFFER: "长期供货协议" };

/** 报价显示名：有名字用名字；没有就用「业务类型 + 报价 · 报价编号」（不显示内部标题，那里可能是英文类型码） */
export function quoteDisplayName(q: { name: string | null; quoteNumber: string | null; quoteType: string }): string {
  if (q.name?.trim()) return q.name.trim();
  const kind = `${QUOTE_TYPE_ZH[q.quoteType] ?? ""}报价`;
  return q.quoteNumber ? `${kind} · ${q.quoteNumber}` : kind;
}

export const proModeHrefOf = (projectId: string, quoteId: string) => `/projects/${encodeURIComponent(projectId)}/quote-engine/${encodeURIComponent(quoteId)}`;

/** 引擎错误 / 警告码 → 中文（逐行报价里看到的） */
export function engineErrorZh(code: string, fallback: string): string {
  switch (code) {
    case "FX_REQUIRED":
      return "有外币的行还没填汇率：先在共用参数里填汇率";
    case "MARGIN_TOO_HIGH":
    case "REVENUE_PCT_TOTAL_TOO_HIGH":
      return "目标毛利率太高：加上专业模式里按售价算的费用，合计到了 100% 或以上，算不出报价。请调低目标毛利率";
    case "PRICING_RATE_INVALID":
      return "目标毛利率要填 0 到 100 之间的数（不含 100）";
    case "DIVISION_BY_ZERO":
      return "有一项比例填到了 100% 或以上，算不出报价：请检查目标毛利率和下面几项比例";
    default:
      // 引擎的其它报错多半来自专业模式里加的行，原文带英文与内部词，不在这里照搬（fallback 只给排查用，不显示）
      void fallback;
      return "有一条成本行填得不对（多半是在专业模式里加的那条），这里算不出：请在专业模式里打开这份报价检查";
  }
}

export function engineWarningZh(code: string, fallback: string): string {
  switch (code) {
    case "LINE_UNPRICED":
      return "有的行还没填供应商报价（或某项比例空着），暂按 0 算；填完才能提交、批准";
    case "NO_CONTINGENCY":
      return "没有预备金（用来兜下错单、漏单的钱，和上面的现金备用金不是一回事）；需要的话在专业模式里加";
    case "NEGATIVE_MARGIN":
      return "报价低于成本（亏损）：请调高目标毛利率或检查成本";
    default:
      return fallback;
  }
}

/* ------------------------------ 粘贴 / 带入的行（浏览器里用） ------------------------------ */

type ParsedLike = { description: string; quantity: string; uom: string; packCount?: number | null };

/** 粘贴框解析出的行（`parseSchedulePaste`）→ 逐行报价的新行；数量照原文转数字，单位不在列表里的留着由保存校验指出 */
export function rowsFromParsed(lines: readonly ParsedLike[], source: LineRowSource): LineRow[] {
  return lines.map((l) => ({
    costLineId: null,
    description: l.description,
    quantity: Number(String(l.quantity).replace(/,/g, "")),
    uom: l.uom,
    packCount: l.packCount ?? null,
    basis: "PER_TENDER_UOM",
    unitPrice: null,
    currency: "CNY",
    evidenceKind: null,
    inquiryItemId: null,
    supplierId: null,
    supplierName: null,
    rowSource: source,
  }));
}

/**
 * 粘贴框导入后留在框里的文字：只去掉已导入的行，没导入的（缺单位、数量不是数字……）留着改了再导。
 * `issueRows` 是 `parseSchedulePaste` 报问题的行号（按非空行从 1 数，含表头）。
 */
export function remainingPasteText(text: string, issueRows: readonly number[]): string {
  const rows = text.split(/\r?\n/).map((r) => r.replace(/\s+$/, "")).filter((r) => r.trim().length > 0);
  const keep = new Set(issueRows);
  return rows.filter((_, i) => keep.has(i + 1)).join("\n");
}

export const QUOTE_STATUS_ZH: Record<string, string> = {
  draft: "草稿",
  review: "待批准",
  approved: "已批准",
  superseded: "已被新版替代",
  awarded: "已中标",
  cancelled: "已作废",
};

/* ------------------------------ 数字输入框（浏览器里用） ------------------------------ */

/**
 * 输入框里的文字 → 数。空 = null；带千分位逗号可以；「12.」「0.」这类还在输入中的写法按已写出的数算（不把小数点吞掉）；
 * 「-」「abc」「1.2.3」这类不是数 → 不合法（界面标红、不让保存），不猜。
 */
export function parseNumInput(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.replace(/,/g, "").trim();
  if (!t) return { ok: true, value: null };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}
