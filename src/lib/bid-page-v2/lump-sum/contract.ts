/**
 * BIDPAGE-4 只报总价 — 契约（纯定义 + 校验，前后端共用；不引 Prisma，可进浏览器包）
 * （openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode，design D2–D6）
 *
 * 总价构成表是报价引擎成本行的又一种排法：
 *   - 货品：一条「货品总数」（PROCUREMENT / FIXED），或展开成明细（沿用 BIDPAGE-3 逐行表的货品行身份）；
 *   - 各大项：一项一条成本行，落到既有类别与计算方式（`LUMP_ITEM_SPEC`），行身份 `metadata.bidLine = { role: "lump", key }`；
 *   - 四条预置沿用 BIDPAGE-3 的预置行身份；销售税不是成本行，写在报价配置的税里。
 * `role: "lump"` 故意不放进 BIDPAGE-3 的 `bidLineMetaSchema`：逐行表读到它当作其它成本行、照样计入、逐行保存不碰（D2）。
 */
import { z } from "zod";
import { QUOTE_CURRENCIES, engineConfigSchema } from "@/lib/quote-engine/contract";
import {
  BID_LINE_META_KEY,
  BID_LINE_META_VERSION,
  LINE_EVIDENCE_KINDS,
  LINE_FX_RATE_MAX,
  LINE_MODE_MAX_ROWS,
  LINE_SHARED_AMOUNT_MAX,
  currencyLabelZh,
  fitsDecimals,
  lineModeStateSchema,
  squash,
  validateLineModeState,
  type FxEntry,
  type InquiryQuoteOption,
  type LineEvidenceKind,
  type LineModeIssue,
  type LineRow,
  type OtherCostLineView,
  type PresetState,
} from "../quote-line/contract";

/* ---------------------------------- 项 ---------------------------------- */

/** 构成表里各大项的身份（表上的顺序）；货品总数另记 `goods_total` */
export const LUMP_ITEM_KEYS = [
  "ocean_freight",
  "duty",
  "domestic_freight",
  "customs",
  "inland_freight",
  "packaging",
  "installation",
  "measurement",
  "shop_drawing",
  "equipment_site",
  "bond",
  "insurance",
  "cleaning",
  "travel",
  "project_management",
  "warranty_reserve",
  "contingency",
  "other",
] as const;
export type LumpItemKey = (typeof LUMP_ITEM_KEYS)[number];
export const LUMP_META_KEYS = ["goods_total", ...LUMP_ITEM_KEYS] as const;
export type LumpMetaKey = (typeof LUMP_META_KEYS)[number];

/** 新建时就有的两项（再加货品、销售税 = 开始的 4 行） */
export const LUMP_INITIAL_KEYS: readonly LumpItemKey[] = ["ocean_freight", "duty"];
/** 「添加一项」的中文清单（任务书顺序）；开始就有的两项被删掉后排到最前面再出现 */
export const LUMP_ADDABLE_KEYS: readonly LumpItemKey[] = [
  "domestic_freight",
  "customs",
  "inland_freight",
  "packaging",
  "installation",
  "measurement",
  "shop_drawing",
  "equipment_site",
  "bond",
  "insurance",
  "cleaning",
  "travel",
  "project_management",
  "warranty_reserve",
  "contingency",
  "other",
];

export type LumpItemKind = "amount" | "percent";
export type LumpPercentSpec = { calculationType: "PERCENT_OF_COST" | "PERCENT_OF_REVENUE"; calculationBase: "PROCUREMENT" | "DIRECT_COST" | null; max: number; maxInclusive: boolean; baseZh: string };
export type LumpItemSpec = { labelZh: string; category: string; percent: LumpPercentSpec | null; defaultKind: LumpItemKind };

const DUTY_PCT: LumpPercentSpec = { calculationType: "PERCENT_OF_COST", calculationBase: "PROCUREMENT", max: 100, maxInclusive: true, baseZh: "按货值（货品合计）的比例" };
const DIRECT_PCT: LumpPercentSpec = {
  calculationType: "PERCENT_OF_COST",
  calculationBase: "DIRECT_COST",
  max: 100,
  maxInclusive: true,
  baseZh: "按直接成本的比例（直接成本 = 货品 + 填金额的各项，含专业模式里按金额加的行；不含按比例算的关税、保函和四条预置）",
};
const BOND_PCT: LumpPercentSpec = { calculationType: "PERCENT_OF_REVENUE", calculationBase: null, max: 100, maxInclusive: false, baseZh: "按税前报价的比例（税前报价会相应抬高：算报价时分母里再减去这个比例）" };

/** 每项落到的既有类别与计算方式（design D3；不新增类别、不新增计算方式） */
export const LUMP_ITEM_SPEC: Record<LumpItemKey, LumpItemSpec> = {
  ocean_freight: { labelZh: "海运费", category: "FREIGHT", percent: null, defaultKind: "amount" },
  duty: { labelZh: "关税", category: "DUTY", percent: DUTY_PCT, defaultKind: "amount" },
  domestic_freight: { labelZh: "国内运费", category: "LOGISTICS", percent: null, defaultKind: "amount" },
  customs: { labelZh: "报关费", category: "CUSTOMS", percent: null, defaultKind: "amount" },
  inland_freight: { labelZh: "加拿大境内运费", category: "FREIGHT", percent: null, defaultKind: "amount" },
  packaging: { labelZh: "包装", category: "LOGISTICS", percent: null, defaultKind: "amount" },
  installation: { labelZh: "安装", category: "LABOUR", percent: null, defaultKind: "amount" },
  measurement: { labelZh: "测量", category: "LABOUR", percent: null, defaultKind: "amount" },
  shop_drawing: { labelZh: "深化图", category: "ENGINEERING", percent: null, defaultKind: "amount" },
  equipment_site: { labelZh: "设备 / 场地", category: "SITE_GENERAL", percent: null, defaultKind: "amount" },
  bond: { labelZh: "保函", category: "BOND", percent: BOND_PCT, defaultKind: "percent" },
  insurance: { labelZh: "保险", category: "INSURANCE", percent: null, defaultKind: "amount" },
  cleaning: { labelZh: "清洁", category: "OTHER", percent: null, defaultKind: "amount" },
  travel: { labelZh: "差旅", category: "SITE_GENERAL", percent: null, defaultKind: "amount" },
  project_management: { labelZh: "项目管理", category: "PROJECT_MANAGEMENT", percent: null, defaultKind: "amount" },
  warranty_reserve: { labelZh: "售后预留", category: "OTHER", percent: DIRECT_PCT, defaultKind: "percent" },
  contingency: { labelZh: "下错单 / 漏单预备金", category: "CONTINGENCY", percent: DIRECT_PCT, defaultKind: "percent" },
  other: { labelZh: "其它", category: "OTHER", percent: null, defaultKind: "amount" },
};
export const GOODS_TOTAL_SPEC = { labelZh: "货品", category: "PROCUREMENT", calculationType: "FIXED" } as const;

/** 「其它」的名称就是成本行的说明：与成本行说明的上限相同（专业模式改长了也能原样保存） */
export const LUMP_OTHER_LABEL_MAX = 300;
export const LUMP_NOTES_MAX = 2000;
export const LUMP_AMOUNT_MAX = LINE_SHARED_AMOUNT_MAX;

/** 成本行上的说明（项目名称；按比例时带上算法）；「其它」用人填的名称 */
export function lumpItemDescriptionZh(key: LumpItemKey, kind: LumpItemKind, label: string | null): string {
  if (key === "other") return label ?? "其它";
  const s = LUMP_ITEM_SPEC[key];
  if (kind === "percent" && s.percent) {
    return s.percent.calculationType === "PERCENT_OF_REVENUE" ? `${s.labelZh}（税前报价 × 比例）` : s.percent.calculationBase === "PROCUREMENT" ? `${s.labelZh}（货值 × 比例）` : `${s.labelZh}（直接成本 × 比例）`;
  }
  return s.labelZh;
}
export const GOODS_TOTAL_DESCRIPTION_ZH = "货品（总数）";

/** 一条成本行的类别与算法是不是这一项允许的组合（不是 → 专业模式里改过，归其它成本行，D8） */
export function lumpComboAllowed(key: LumpMetaKey, line: { category: string; calculationType: string; calculationBase: string | null }): boolean {
  if (key === "goods_total") return line.category === GOODS_TOTAL_SPEC.category && line.calculationType === "FIXED";
  const s = LUMP_ITEM_SPEC[key];
  if (line.category !== s.category) return false;
  if (line.calculationType === "FIXED") return true;
  return !!s.percent && line.calculationType === s.percent.calculationType && (line.calculationBase ?? null) === s.percent.calculationBase;
}
/** 由一条允许组合的成本行看出是金额还是比例 */
export const lumpKindOf = (calculationType: string): LumpItemKind => (calculationType === "FIXED" ? "amount" : "percent");

/* ------------------------------ 行身份（metadata.bidLine） ------------------------------ */

export const lumpMetaSchema = z.object({
  v: z.literal(BID_LINE_META_VERSION),
  role: z.literal("lump"),
  key: z.enum(LUMP_META_KEYS),
  /** 「其它」可以多条：序号区分 */
  seq: z.number().int().min(1).max(9999).optional(),
  /** 货品总数：手填时的证据类别 / 点选的询价回复 */
  evidenceKind: z.enum(LINE_EVIDENCE_KINDS).nullable().optional(),
  inquiryItemId: z.string().min(1).max(64).nullable().optional(),
});
export type LumpMeta = z.infer<typeof lumpMetaSchema>;

export function readLumpMeta(metadata: unknown): LumpMeta | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const parsed = lumpMetaSchema.safeParse((metadata as Record<string, unknown>)[BID_LINE_META_KEY]);
  return parsed.success ? parsed.data : null;
}
export function mergeLumpMeta(metadata: unknown, meta: LumpMeta): Record<string, unknown> {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  base[BID_LINE_META_KEY] = meta;
  return base;
}

/* ------------------------------ 做法判定 ------------------------------ */

export const LUMP_QUOTE_TYPES = ["SUPPLY_ONLY", "PROJECT_SUPPLY_INSTALL"] as const;

/** 总价报价 = 做法字段是 LUMP_SUM，且是只供货或供货加安装报价（长期供货协议即使带了也按专业模式打开） */
export function isLumpSumQuote(q: { engineJson: unknown; quoteType: string }): boolean {
  if (!(LUMP_QUOTE_TYPES as readonly string[]).includes(q.quoteType)) return false;
  const parsed = engineConfigSchema.safeParse(q.engineJson ?? {});
  return parsed.success && parsed.data.entryMode === "LUMP_SUM";
}

/* ------------------------------ 编辑状态（接口 ↔ 界面） ------------------------------ */

export type LumpItem = {
  /** 已存的成本行 id；新加的项为 null */
  costLineId: string | null;
  key: LumpItemKey;
  /** 「其它」的序号（新加的为 null，保存时排号） */
  seq: number | null;
  /** 「其它」的名称；其余项为 null */
  label: string | null;
  kind: LumpItemKind;
  /** 填金额时的金额（原币）；null = 没填（不计入） */
  amount: number | null;
  currency: string;
  /** 填比例时的比例（%）；null = 没填（不计入） */
  ratePct: number | null;
  notes: string | null;
};

export type LumpGoods = {
  /** total = 填一个总数；detail = 展开成明细（总数留着、不计入） */
  mode: "total" | "detail";
  /** 货品总数那条成本行的 id（新建时就有；专业模式删掉了为 null，保存时重建） */
  costLineId: string | null;
  amount: number | null;
  currency: string;
  inquiryItemId: string | null;
  evidenceKind: LineEvidenceKind | null;
  supplierId: string | null;
  supplierName: string | null;
  notes: string | null;
};

export type LumpTax = { hstPct: number | null; gstPct: number | null; pstPct: number | null };

export type LumpState = {
  goods: LumpGoods;
  /** 货品明细：与逐行表的行同一结构（按件报价、包装数原样往返，design D6） */
  details: LineRow[];
  items: LumpItem[];
  tax: LumpTax;
  /** 每种外币一个汇率：1 原币 = rate 加元 */
  fx: Record<string, FxEntry>;
  presets: PresetState;
  /** 目标毛利率（按售价，%） */
  targetMarginPct: number | null;
};

const nullableNum = z.number().finite().nullable();
const currency = z.enum(QUOTE_CURRENCIES);
const shape = lineModeStateSchema.shape;
export const lumpStateSchema = z.object({
  goods: z.object({
    mode: z.enum(["total", "detail"]),
    costLineId: z.string().min(1).max(64).nullable(),
    amount: nullableNum,
    currency,
    inquiryItemId: z.string().min(1).max(64).nullable(),
    evidenceKind: z.enum(LINE_EVIDENCE_KINDS).nullable(),
    supplierId: z.string().min(1).max(64).nullable(),
    supplierName: z.string().max(120).nullable(),
    notes: z.string().max(LUMP_NOTES_MAX * 2).nullable(),
  }),
  details: shape.rows,
  items: z
    .array(
      z.object({
        costLineId: z.string().min(1).max(64).nullable(),
        key: z.enum(LUMP_ITEM_KEYS),
        seq: z.number().int().min(1).max(9999).nullable(),
        label: z.string().max(LUMP_OTHER_LABEL_MAX * 4).nullable(),
        kind: z.enum(["amount", "percent"]),
        amount: nullableNum,
        currency,
        ratePct: nullableNum,
        notes: z.string().max(LUMP_NOTES_MAX * 2).nullable(),
      }),
    )
    .max(200),
  tax: z.object({ hstPct: nullableNum, gstPct: nullableNum, pstPct: nullableNum }),
  fx: shape.fx,
  presets: shape.presets,
  targetMarginPct: nullableNum,
});

export const saveLumpRequestSchema = z.object({
  /** 读取时报价的修改时间（ISO）；与库里不同 → 409 */
  baseUpdatedAt: z.string().min(1).max(40),
  state: lumpStateSchema,
});
export type SaveLumpRequest = z.infer<typeof saveLumpRequestSchema>;

export const convertRequestSchema = z.object({
  to: z.enum(["LUMP_SUM", "LINE"]),
  baseUpdatedAt: z.string().min(1).max(40),
});
export type ConvertRequest = z.infer<typeof convertRequestSchema>;

/* ---------------------------------- 校验 ---------------------------------- */

/** 新加的一项（默认填法见 `LUMP_ITEM_SPEC.defaultKind`） */
export function emptyLumpItem(key: LumpItemKey): LumpItem {
  return { costLineId: null, key, seq: null, label: key === "other" ? "" : null, kind: LUMP_ITEM_SPEC[key].defaultKind, amount: null, currency: "CAD", ratePct: null, notes: null };
}

/** 「添加一项」里现在能选的：开始就有的两项被删掉后排到最前面，其余按任务书顺序、没加过的；其它总在 */
export function addableKeys(items: readonly Pick<LumpItem, "key">[]): LumpItemKey[] {
  const has = new Set(items.map((i) => i.key));
  return [...LUMP_INITIAL_KEYS, ...LUMP_ADDABLE_KEYS].filter((k) => k === "other" || !has.has(k));
}

export const itemNameZh = (it: Pick<LumpItem, "key" | "label">) => (it.key === "other" ? `「${it.label?.trim() || "其它"}」` : LUMP_ITEM_SPEC[it.key].labelZh);

/** 备注：统一换行、去掉控制字符与看不见的格式字符（保留换行与制表符；\u0000 进不了库），去首尾空白 */
const cleanNotes = (s: string | null) => {
  if (s == null) return null;
  const t = s.replace(/\r\n?/g, "\n").replace(/[^\S\n\t]|[\p{Cc}\p{Cf}]/gu, (ch) => (ch === "\n" || ch === "\t" ? ch : /\s/.test(ch) ? " " : "")).trim();
  return t ? t : null;
};

/**
 * 业务校验（结构由 zod 先过）：范围与库里能存的一致（spec「金额、比例与汇率的范围」），说明指到哪一项；
 * 明细、汇率、预置、目标毛利率沿用逐行表的校验。全部问题一次列出，不改人填的数。
 */
export function validateLumpState(state: LumpState): { ok: true; state: LumpState } | { ok: false; issues: LineModeIssue[] } {
  const issues: LineModeIssue[] = [];
  const base = validateLineModeState({
    rows: state.details,
    fx: state.fx,
    shared: { oceanFreight: { containers: null, perContainer: null, currency: "CAD" }, customs: { amount: null, currency: "CAD" }, domesticFreight: { amount: null, currency: "CAD" }, dutyPct: null },
    presets: state.presets,
    targetMarginPct: state.targetMarginPct,
  });
  if (!base.ok) issues.push(...base.issues.map((i) => ({ rowNo: i.rowNo, messageZh: i.rowNo != null ? `货品明细${i.messageZh}` : i.messageZh })));
  if (state.details.length > LINE_MODE_MAX_ROWS) issues.push({ rowNo: null, messageZh: `货品明细最多 ${LINE_MODE_MAX_ROWS} 行` });

  const used = new Set<string>();
  const money = (v: number | null, label: string) => {
    if (v == null) return;
    if (v < 0) issues.push({ rowNo: null, messageZh: `${label}不能是负数` });
    else if (v > LUMP_AMOUNT_MAX) issues.push({ rowNo: null, messageZh: `${label}太大（最多 10,000,000,000），请检查` });
    else if (!fitsDecimals(v, 4)) issues.push({ rowNo: null, messageZh: `${label}最多 4 位小数` });
  };
  const pct = (v: number | null, label: string, max: number, inclusive: boolean) => {
    if (v == null) return;
    if (v < 0 || (inclusive ? v > max : v >= max)) issues.push({ rowNo: null, messageZh: inclusive ? `${label}的比例要在 0 到 ${max} 之间` : `${label}的比例要大于等于 0、小于 ${max}` });
    else if (!fitsDecimals(v, 4)) issues.push({ rowNo: null, messageZh: `${label}的比例最多 4 位小数` });
  };
  const notesOk = (s: string | null, label: string) => {
    const n = cleanNotes(s);
    if (n && n.length > LUMP_NOTES_MAX) issues.push({ rowNo: null, messageZh: `${label}的备注最多 ${LUMP_NOTES_MAX} 字` });
    return n;
  };

  // 货品
  const g = state.goods;
  if (g.mode === "total" && state.details.length > 0) issues.push({ rowNo: null, messageZh: "货品已展开成明细，要改回填总数请先删掉明细" });
  if (g.mode === "detail" && state.details.length === 0) issues.push({ rowNo: null, messageZh: "货品展开成明细后至少要有一行；不要明细就改回填一个总数" });
  money(g.amount, "货品总数");
  if (g.mode === "total" && g.amount != null && !g.inquiryItemId && !g.evidenceKind) issues.push({ rowNo: null, messageZh: "货品总数是手填的，要选证据类别（已签报价 / 平台标价 / 零售价 / 估计）" });
  if (g.amount != null && g.currency !== "CAD") used.add(g.currency);
  const goodsNotes = notesOk(g.notes, "货品");

  // 各项
  const seen = new Set<LumpItemKey>();
  const items: LumpItem[] = state.items.map((it) => {
    const s = LUMP_ITEM_SPEC[it.key];
    const name = itemNameZh(it);
    let label: string | null = null;
    if (it.key === "other") {
      label = squash(it.label ?? "") || null;
      if (!label) issues.push({ rowNo: null, messageZh: "「其它」要填名称" });
      else if (label.length > LUMP_OTHER_LABEL_MAX) issues.push({ rowNo: null, messageZh: `「其它」的名称最多 ${LUMP_OTHER_LABEL_MAX} 字` });
    } else {
      if (seen.has(it.key)) issues.push({ rowNo: null, messageZh: `${s.labelZh}只能有一项` });
      seen.add(it.key);
    }
    if (it.kind === "percent" && !s.percent) issues.push({ rowNo: null, messageZh: `${name}只能填金额` });
    if (it.kind === "amount") {
      money(it.amount, name);
      if (it.amount != null && it.currency !== "CAD") used.add(it.currency);
    } else if (s.percent) pct(it.ratePct, name, s.percent.max, s.percent.maxInclusive);
    const notes = notesOk(it.notes, name);
    return { ...it, label, notes, currency: it.kind === "percent" ? "CAD" : it.currency };
  });

  // 销售税
  for (const [k, label] of [["hstPct", "销售税 HST"], ["gstPct", "销售税 GST"], ["pstPct", "销售税 PST"]] as const) {
    const v = state.tax[k];
    if (v == null) continue;
    if (v < 0 || v > 100) issues.push({ rowNo: null, messageZh: `${label} 要在 0 到 100 之间` });
    else if (!fitsDecimals(v, 4)) issues.push({ rowNo: null, messageZh: `${label} 最多 4 位小数` });
  }

  if (issues.length) return { ok: false, issues };
  const fx: Record<string, FxEntry> = { ...(base.ok ? base.state.fx : {}) };
  for (const c of used) {
    if (c === "CAD") continue;
    if (!fx[c]) fx[c] = { rate: null, source: null };
  }
  void LINE_FX_RATE_MAX; // 汇率范围由逐行表的校验（同一个上限）判过
  return { ok: true, state: { ...state, goods: { ...g, notes: goodsNotes, evidenceKind: g.inquiryItemId ? null : g.evidenceKind }, details: base.ok ? base.state.rows : state.details, items, fx } };
}

/* ------------------------------ 读接口的视图（只给看得到金额的人） ------------------------------ */

export type LumpTotals = {
  /** 成本合计（引擎 estimatedCost，含销售提成与按报价算的各项） */
  estimatedCost: number;
  /** 税前报价（引擎 sellingPrice；系统记的我方报价） */
  sellingPrice: number;
  /** 销售税 = round2(GST + HST + PST) */
  salesTax: number;
  /** 含税总价（引擎 tax.total） */
  totalWithTax: number;
  grossProfit: number;
  grossMarginPct: number;
};

/** 算式用到的引擎结果（design D5）；按售价毛利以外的定价方式为 null */
export type LumpFormula = {
  baseCost: number;
  marginPct: number;
  /** 按报价算的各项比例合计（保函等，含专业模式里加的售价百分比行） */
  revenuePct: number;
  commission: { ratePct: number; amount: number } | null;
  sellingPrice: number;
  salesTax: number;
  totalWithTax: number;
};

export type LumpOtherLine = OtherCostLineView & { reasonZh: string | null };

export type LumpView = {
  quote: { id: string; name: string | null; quoteNumber: string | null; quoteType: string; version: number; status: string; currency: string; updatedAt: string; frozen: boolean; pricingMethod: string };
  capabilities: { canEdit: boolean; canApprove: boolean };
  state: LumpState;
  notices: string[];
  others: LumpOtherLine[];
  computed:
    | { ok: true; totals: LumpTotals; formula: LumpFormula | null; amountById: Record<string, number>; goodsAmount: number; warnings: Array<{ code: string; messageZh: string }> }
    | { ok: false; errorsZh: string[] };
  inquiryQuotes: InquiryQuoteOption[];
  proModeHref: string;
  /** 能不能转成逐行报价（不能时的原因） */
  convertToLine: { available: true } | { available: false; reasonZh: string };
};

/* ------------------------------ 中文提示 ------------------------------ */

export const LUMP_NOT_LUMP_ZH = "这份报价不是按「只报总价」做的，请回到报价列表，按列表上写的做法打开（长期供货协议只能在专业模式里做）";

/** 引擎错误码 → 中文（总价表里看到的） */
export function lumpEngineErrorZh(code: string, fallback: string): string {
  switch (code) {
    case "FX_REQUIRED": {
      // 引擎原文形如「USD→CAD 需要汇率」：取出币种写成中文
      const ccy = /^([A-Z]{3})→/.exec(fallback)?.[1];
      return ccy ? `有${currencyLabelZh(ccy)}的项还没填汇率：在下面「汇率」一栏填上 1 ${currencyLabelZh(ccy)} = 多少加元` : "有外币的项还没填汇率：在下面「汇率」一栏填上（1 外币 = 多少加元）";
    }
    case "MARGIN_TOO_HIGH":
    case "REVENUE_PCT_TOTAL_TOO_HIGH":
      return "目标毛利率加上按税前报价算的各项比例（保函等），合计到了 100% 或以上，算不出报价：请调低目标毛利率或这些比例";
    case "PRICING_RATE_INVALID":
      return "目标毛利率要填 0 到 100 之间的数（不含 100）";
    case "REVENUE_PCT_TOO_HIGH":
      return "保函（或专业模式里加的按售价算的费用）的比例要小于 100%";
    case "DIVISION_BY_ZERO":
      return "有一项比例填到了 100% 或以上，算不出报价：请检查目标毛利率和各项比例";
    default:
      void fallback;
      return "有一条成本行填得不对（多半是在专业模式里加的那条），这里算不出：请在专业模式里打开这份报价检查";
  }
}

export function lumpEngineWarningZh(code: string, fallback: string): string {
  switch (code) {
    case "LINE_UNPRICED":
      return "货品（或货品明细里有的行）还没填价，或某一项计入了但没填数、某条预置的比例 / 月数空着，暂按 0 算；填完才能提交、批准";
    case "NO_CONTINGENCY":
      return "没有下错单 / 漏单预备金；需要的话从「添加一项」里加";
    case "NEGATIVE_MARGIN":
      return "报价低于成本（亏损）：请调高目标毛利率或检查成本";
    default:
      return fallback;
  }
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTxt = (n: number) => `${Number(n.toFixed(4))}%`;

/**
 * 定价一行下方的算式（design D5；用引擎结果的数，不另算）；null = 定价方式不是按售价毛利。
 * 引擎：税前报价 = baseCost ÷（1 − 毛利率 − 按税前报价算的各项比例）；销售提成 =（税前报价 − baseCost）× 比例。
 * baseCost 不含销售提成与按税前报价算的各项（保函等），两句都直接写出它的数，免得人拿「成本合计 − 提成」去算。
 */
export function lumpFormulaLinesZh(f: LumpFormula | null): string[] {
  if (!f) return [];
  const denom = [`1 − ${pctTxt(f.marginPct)}`, ...(f.revenuePct > 0 ? [pctTxt(f.revenuePct)] : [])].join(" − ");
  const without = [...(f.commission ? ["销售提成"] : []), ...(f.revenuePct > 0 ? ["按税前报价算的各项（保函等）"] : [])];
  const costWord = without.length ? `不含${without.join("和")}的成本 ${fmt(f.baseCost)}` : fmt(f.baseCost);
  const lines = [`税前报价 ${fmt(f.sellingPrice)} = ${costWord} ÷（${denom}）`];
  if (f.commission) lines.push(`销售提成 ${fmt(f.commission.amount)} =（税前报价 ${fmt(f.sellingPrice)} − ${fmt(f.baseCost)}）× ${pctTxt(f.commission.ratePct)}，算进成本合计`);
  lines.push(`含税总价 ${fmt(f.totalWithTax)} = ${fmt(f.sellingPrice)} + 销售税 ${fmt(f.salesTax)}`);
  return lines;
}

export const LUMP_MARKUP_NOTE_ZH = "定价方式在专业模式里改成了成本加成率（按成本），上面的数是按它算的；这里只能按目标毛利率（按售价）定价：填上目标毛利率再保存，定价方式会一起改回按售价";

export { currencyLabelZh };
