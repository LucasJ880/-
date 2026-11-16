/**
 * 文件金额 / 青砚金额对照（QUOTE-1b，design D3–D5、D8）
 *
 * 纯函数。
 * - 青砚金额：映射出的表单行 → 行构造（buildOrderFormItems）→ 企业默认折扣（applyOrgDiscountDefaults）→ 引擎
 *   （calculateQuoteTotal），与保存时服务端的调用顺序相同，输入取页面已加载的企业设置。
 * - 文件金额：文件里没有任何合计字段，按文件自己的参数（面料档、尺寸、无绳、褶皱率、折扣、成交价）用青砚引擎重算，
 *   逐行取整照工具的写法。只有文件价表与青砚现行价表一致时才算、才显示。
 * - 特别让利 = 青砚比文件贵的行差 + 负数附加项目 + 运费差，取到分。
 */
import type { CordlessPolicy, ProductName, QuoteTotalResult } from "@/lib/blinds/pricing-types";
import { calculateQuoteTotal, priceFor } from "@/lib/blinds/pricing-engine";
import {
  BRACKETS,
  DEFAULT_DISCOUNTS,
  INSTALL_RULES,
  MSRP_ROLLER,
  PRICE_FLOOR,
  ROLLER_FABRICS,
  getMsrpTable,
} from "@/lib/blinds/pricing-data";
import { applyOrgDiscountDefaults, type DiscountsByProduct } from "@/lib/blinds/discount-settings";
import { partBRowsToAddonInputs } from "@/lib/blinds/pricing-addons";
import { buildOrderFormItems } from "@/app/(main)/sales/quote-sheet/order-items";
import type { FileItem, FilePlan, FilePricing, FileProduct, ImportHint, ParsedQuoteFile } from "./types";
import {
  applyFullnessChoices,
  fileFullnessOf,
  pendingFullnessRows,
  type FullnessChoice,
  type MappedQuote,
  type MappedRow,
} from "./map";

export interface CompareSettings {
  /** 页面已加载的各产品企业折扣；缺的品类按缺省值 */
  orgDiscounts: Partial<Record<ProductName, number>> | undefined;
  cordlessPolicy: CordlessPolicy;
  sunnyMotorPrice: number;
  minInstallFee: number;
  deliveryFee: number;
  addonPrices?: Record<string, number>;
  /** 文件没有可用税率时用的税率（表单当前值） */
  fallbackTaxRate: number;
}

export type RowHandling =
  | "match"
  | "keep_discount"
  | "promotion"
  | "warn_higher"
  | "pending_fullness"
  | "block"
  | "no_file_amount";

export interface FullnessOption {
  /** 该档的青砚金额；该档超出价表时为 null */
  qingyanAmount: number | null;
  /** 青砚金额 − 文件金额；文件金额不可用或该档不可用时为 null */
  diff: number | null;
  /** 该档不可选的原因 */
  errorZh: string | null;
}

export interface CompareRow {
  rowIndex: number;
  room: string;
  product: ProductName;
  fabric: string;
  sizeLabel: string;
  qty: number;
  /** 文件金额（整行，含数量）；价表不一致或该行被阻断时为 null */
  fileAmount: number | null;
  /** 青砚金额（整行）；待选褶皱率或被阻断时为 null */
  qingyanAmount: number | null;
  /** 青砚金额 − 文件金额 */
  diff: number | null;
  handling: RowHandling;
  handlingZh: string;
  /** 该行计入特别让利的金额 */
  promotion: number;
  keptDiscountPct: number | null;
  /** 待选褶皱率的行：两档各自的青砚金额 */
  fullnessOptions: Record<FullnessChoice, FullnessOption> | null;
  fullnessChoice: FullnessChoice | null;
}

export interface SideTotals {
  products: number;
  addons: number;
  install: number;
  delivery: number;
  /** 特别让利（文件一侧恒为 0） */
  promotion: number;
  preTax: number;
  tax: number;
  grand: number;
}

export interface CompareResult {
  rows: CompareRow[];
  pricelistMatch: boolean;
  /** 价表不一致的具体位置（给核对窗与测试看） */
  pricelistDiffs: string[];
  /** 文件一侧的合计；价表不一致时为 null。附加项目含 Downtown 服务费 */
  fileTotals: SideTotals | null;
  /** 青砚一侧的合计；还有行待选褶皱率或有阻断时为 null */
  qingyanTotals: SideTotals | null;
  promotion: { rows: number; addons: number; delivery: number; total: number };
  hints: ImportHint[];
  pendingFullnessRows: number[];
  canFill: boolean;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `$${cents(n).toFixed(2)}`;
const pctLabel = (n: number) => `${Math.round(n * 1000) / 10}%`;
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

function sameList(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((v, i) => same(v, b[i]));
}

function sameMatrix(a: readonly (readonly number[])[] | null | undefined, b: readonly (readonly number[])[] | null | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((row, i) => sameList(row, b[i]));
}

/** 文件安装费标准的键 → 青砚 INSTALL_RULES */
const INSTALL_RULE_PAIRS: Array<[string, number]> = [
  ["regular", INSTALL_RULES.regular],
  ["wide_threshold_in", INSTALL_RULES.wideThresholdIn],
  ["wide", INSTALL_RULES.wide],
  ["drapery_regular", INSTALL_RULES.draperySheerNarrow],
  ["drapery_wide", INSTALL_RULES.draperySheerWide],
  ["shutter_panel_width_in", INSTALL_RULES.shuttersPanelWidthIn],
  ["shutter_panel_price", INSTALL_RULES.shutterPerPanel],
  ["minimum_total", INSTALL_RULES.minimumTotal],
];

/**
 * 文件自带价表与青砚现行价表是否一致。只比本次用到的品类与面料档：
 * 宽高档位、MSRP、最低价，外加整份的安装费标准与算文件金额要用到的折扣 / 无绳 / 税率参数是否齐全。
 */
export function comparePricelist(pricing: FilePricing | null, items: readonly FileItem[]): { match: boolean; diffs: string[] } {
  if (!pricing) return { match: false, diffs: ["文件没有带价表"] };
  const diffs: string[] = [];
  const used = new Map<FileProduct, Set<string>>();
  for (const it of items) {
    if (!used.has(it.product)) used.set(it.product, new Set());
    used.get(it.product)!.add(it.fabric);
  }
  for (const [product, fabrics] of used) {
    const fp = pricing.products[product];
    if (!fp) { diffs.push(`${product}：文件里没有这个品类的价表`); continue; }
    if (!sameList(fp.widths, BRACKETS[product].widths) || !sameList(fp.heights, BRACKETS[product].heights)) {
      diffs.push(`${product}：宽高档位不同`);
      continue;
    }
    for (const fabric of fabrics) {
      const ff = fp.fabrics[fabric];
      if (!ff) { diffs.push(`${product} / ${fabric}：文件里没有这个配置`); continue; }
      if (product === "Sheer" && fabric === "Door Screen Sheer") {
        if (ff.special !== "door_screen_sheer") diffs.push(`${product} / ${fabric}：计价方式不同`);
      } else if (product === "Roller") {
        const mine = ROLLER_FABRICS[fabric];
        if (!mine || !ff.msrpRef || ff.msrpRef !== mine.msrpRef || ff.cassette !== mine.cassette) diffs.push(`${product} / ${fabric}：配置不同`);
        else if (!sameMatrix(fp.rollerTables[ff.msrpRef], MSRP_ROLLER[mine.msrpRef])) diffs.push(`${product} / ${fabric}：MSRP 不同`);
      } else if (!sameMatrix(ff.msrp, getMsrpTable(product, fabric))) {
        diffs.push(`${product} / ${fabric}：MSRP 不同`);
      }
    }
    const floor = pricing.floors[product];
    if (typeof floor !== "number" || !same(floor, PRICE_FLOOR[product] || 0)) diffs.push(`${product}：最低价不同`);
    if (typeof pricing.discounts[product] !== "number") diffs.push(`${product}：文件里没有默认折扣`);
  }
  for (const [key, mine] of INSTALL_RULE_PAIRS) {
    const theirs = pricing.install[key];
    if (typeof theirs !== "number" || !same(theirs, mine)) { diffs.push("安装费标准不同"); break; }
  }
  if (items.some((it) => it.cordless && (it.product === "Zebra" || it.product === "Roller"))) {
    const ok = [pricing.cordlessDiscount, pricing.cordlessMultiplier, pricing.cordlessFloors.Zebra, pricing.cordlessFloors.Roller].every((v) => typeof v === "number");
    if (!ok) diffs.push("文件里的无绳参数不完整");
  }
  if (typeof pricing.tax !== "number" || pricing.tax < 0 || pricing.tax > 1) diffs.push("文件里没有可用的税率");
  return { match: diffs.length === 0, diffs };
}

/** 文件一行的金额：单价取到分 × 数量再取到分（工具 totals() 的写法）；算不出返回 null */
function fileRowAmount(item: FileItem, file: ParsedQuoteFile): { total: number; install: number } | null {
  const pr = file.pricing;
  if (!pr || item.w === null || item.h === null || item.qty === null) return null;
  const cordless = item.cordless && (item.product === "Zebra" || item.product === "Roller");
  const isDoorScreen = item.product === "Sheer" && item.fabric === "Door Screen Sheer";
  // Door Screen Sheer 按工具的口径不打折（行上自带折扣时照用）；其余：行折扣，否则文件自己的默认折扣
  const discount = isDoorScreen
    ? item.discountOverridePct
    : item.discountOverridePct ?? (cordless ? pr.cordlessDiscount : pr.discounts[item.product] ?? null);
  if (!isDoorScreen && discount === null) return null;
  const policy: CordlessPolicy = {
    discount: pr.cordlessDiscount ?? 0,
    floors: { Zebra: pr.cordlessFloors.Zebra ?? 0, Roller: pr.cordlessFloors.Roller ?? 0 },
    multiplier: pr.cordlessMultiplier ?? 1,
  };
  const usesFullness = (item.product === "Drapery" || item.product === "Sheer") && !isDoorScreen;
  const r = priceFor(item.product, item.fabric, item.w, item.h, discount, item.cordless, policy, usesFullness ? fileFullnessOf(item, file) : null);
  if ("error" in r) return null;
  const unit = cents(item.offer !== null ? item.offer : r.price);
  return { total: cents(unit * item.qty), install: r.install * item.qty };
}

function fullDiscounts(settings: CompareSettings): DiscountsByProduct {
  const out = { ...DEFAULT_DISCOUNTS };
  for (const [k, v] of Object.entries(settings.orgDiscounts ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) out[k as ProductName] = v;
  }
  return out;
}

/** 与 quotes/route.ts 相同的调用顺序 */
function qingyanCalc(mapped: MappedQuote, settings: CompareSettings, specialPromotion: number, withAddons: boolean): QuoteTotalResult {
  const items = buildOrderFormItems({
    shadeOrders: mapped.shadeOrders,
    shutterOrders: mapped.shutterOrders,
    drapeOrders: mapped.drapeOrders,
    shutterMaterial: mapped.shutterMaterial ?? "Vinyl",
    shadeValanceType: "",
  });
  return calculateQuoteTotal({
    items: applyOrgDiscountDefaults(items, fullDiscounts(settings)),
    addons: withAddons ? partBRowsToAddonInputs(mapped.partBAddons) : [],
    addonPrices: settings.addonPrices,
    installMode: mapped.installMode,
    deliveryFee: settings.deliveryFee,
    taxRate: mapped.taxRate ?? settings.fallbackTaxRate,
    sunnyMotorPrice: settings.sunnyMotorPrice,
    minInstallTotal: settings.minInstallFee,
    cordlessPolicy: settings.cordlessPolicy,
    specialPromotion,
  });
}

/** 只含某一行拆出的表单行 */
function onlyRow(mapped: MappedQuote, row: MappedRow): MappedQuote {
  const ids = new Set(row.lineIds);
  return {
    ...mapped,
    shadeOrders: mapped.shadeOrders.filter((l) => ids.has(l.id)),
    shutterOrders: mapped.shutterOrders.filter((l) => ids.has(l.id)),
    drapeOrders: mapped.drapeOrders.filter((l) => ids.has(l.id)),
  };
}

/** 一行的青砚金额（整行）；有行算不出时返回错误 */
function qingyanRowAmount(mapped: MappedQuote, row: MappedRow, settings: CompareSettings): { amount: number } | { error: string } {
  const calc = qingyanCalc(onlyRow(mapped, row), settings, 0, false);
  if (calc.errors.length > 0) return { error: calc.errors[0].error };
  if (calc.itemResults.length !== row.lineIds.length) return { error: "该行没有产生可计价的表单行" };
  return { amount: cents(calc.merchSubtotal) };
}

function sizeLabel(item: FileItem): string {
  return `${item.w ?? "?"}" × ${item.h ?? "?"}"`;
}

/**
 * 逐行对照 + 两边合计 + 特别让利。
 * @param choices 待选褶皱率的行：文件行号 → 销售选的档
 */
export function compareWithQingyan(
  file: ParsedQuoteFile,
  plan: FilePlan,
  mapped: MappedQuote,
  settings: CompareSettings,
  choices: Record<number, FullnessChoice | undefined> = {},
): CompareResult {
  const hints: ImportHint[] = [...mapped.hints];
  const { match: pricelistMatch, diffs: pricelistDiffs } = comparePricelist(file.pricing, plan.items);
  if (!pricelistMatch) {
    hints.push({
      level: "warn",
      code: "pricelist_mismatch",
      messageZh: "该文件的价表与公司现行价表不同：不显示文件金额与差额，只显示青砚金额；行级差额未计入特别让利，请自行核对后在表单里填写",
    });
  }

  const applied = applyFullnessChoices(mapped, choices);
  const pending = pendingFullnessRows(mapped, choices);
  const rows: CompareRow[] = [];
  let rowPromotion = 0;
  let fileProducts = 0;
  let fileInstallRaw = 0;
  let fileComplete = pricelistMatch;

  plan.items.forEach((item, i) => {
    const m = mapped.rows[i];
    const base: CompareRow = {
      rowIndex: m.rowIndex,
      room: item.room,
      product: item.product,
      fabric: item.fabric,
      sizeLabel: sizeLabel(item),
      qty: item.qty ?? 0,
      fileAmount: null,
      qingyanAmount: null,
      diff: null,
      handling: "block",
      handlingZh: "阻断",
      promotion: 0,
      keptDiscountPct: m.keptDiscountPct,
      fullnessOptions: null,
      fullnessChoice: m.needsFullnessChoice ? choices[m.rowIndex] ?? null : null,
    };
    rows.push(base);

    const fileRow = pricelistMatch && !m.blocked ? fileRowAmount(item, file) : null;
    if (pricelistMatch && !m.blocked && !fileRow) fileComplete = false;
    if (fileRow) {
      base.fileAmount = fileRow.total;
      fileProducts += fileRow.total;
      fileInstallRaw += fileRow.install;
    } else if (pricelistMatch) {
      fileComplete = false;
    }
    if (m.blocked) return;

    const tol = 0.01 * (item.qty ?? 1) + 1e-9;

    // ── 待选褶皱率：两档各自的青砚金额 ──
    if (m.needsFullnessChoice) {
      const options = {} as Record<FullnessChoice, FullnessOption>;
      for (const tier of ["180", "230"] as const) {
        const r = qingyanRowAmount(applyFullnessChoices(mapped, { [m.rowIndex]: tier }), m, settings);
        options[tier] = "error" in r
          ? { qingyanAmount: null, diff: null, errorZh: `选 ${tier} 时该尺寸超出青砚价表范围` }
          : { qingyanAmount: r.amount, diff: base.fileAmount !== null ? cents(r.amount - base.fileAmount) : null, errorZh: null };
      }
      base.fullnessOptions = options;
      const chosen = choices[m.rowIndex];
      if (!chosen) {
        base.handling = "pending_fullness";
        base.handlingZh = "待选褶皱率：请选 180 或 230";
        return;
      }
      if (options[chosen].qingyanAmount === null) {
        base.handling = "block";
        base.handlingZh = "阻断";
        hints.push({ level: "block", code: "fullness_out_of_range", rowIndex: m.rowIndex, messageZh: `第 ${m.rowIndex} 行：${options[chosen].errorZh}，请改选另一档` });
        return;
      }
    }

    const q = qingyanRowAmount(applied, m, settings);
    if ("error" in q) {
      base.handling = "block";
      base.handlingZh = "阻断";
      hints.push({ level: "block", code: "price_error", rowIndex: m.rowIndex, messageZh: `第 ${m.rowIndex} 行：青砚算不出这一行的价格（${q.error}）` });
      return;
    }
    base.qingyanAmount = q.amount;
    const kept = m.keptDiscountPct !== null ? `保留行折扣 ${pctLabel(m.keptDiscountPct)}` : "";

    if (base.fileAmount === null) {
      base.handling = kept ? "keep_discount" : "no_file_amount";
      base.handlingZh = kept || "无文件金额";
      return;
    }
    base.diff = cents(q.amount - base.fileAmount);
    if (Math.abs(base.diff) <= tol) {
      base.handling = kept ? "keep_discount" : "match";
      base.handlingZh = kept || "一致";
    } else if (base.diff > 0) {
      base.handling = "promotion";
      base.promotion = base.diff;
      rowPromotion += base.diff;
      base.handlingZh = `${kept ? `${kept}，` : ""}计入让利 ${base.diff.toFixed(2)}`;
    } else {
      base.handling = "warn_higher";
      base.handlingZh = `${kept ? `${kept}；` : ""}提醒：青砚金额低于文件 ${(-base.diff).toFixed(2)}`;
      hints.push({
        level: "warn",
        code: "qingyan_lower",
        rowIndex: m.rowIndex,
        messageZh: `第 ${m.rowIndex} 行：青砚金额 ${money(q.amount)} 低于文件 ${money(base.fileAmount)}（差 ${money(-base.diff)}），导入后以青砚金额为准，特别让利不因此变化`,
      });
    }
  });

  const hasBlock = hints.some((h) => h.level === "block");
  const promotion = {
    rows: cents(rowPromotion),
    addons: mapped.addonPromotion,
    delivery: mapped.deliveryPromotion,
    total: cents(rowPromotion + mapped.addonPromotion + mapped.deliveryPromotion),
  };

  // ── 文件一侧的合计（工具 totals() 的算法；Downtown 并入附加项目，便于与青砚的 Part B 并排）──
  let fileTotals: SideTotals | null = null;
  if (fileComplete && file.pricing && !mapped.rows.some((r) => r.blocked)) {
    const hasItems = plan.items.length > 0;
    const addons = cents(plan.addons.reduce((s, a) => s + (a.qty ?? 0) * (a.price ?? 0), 0));
    const downtown = plan.downtown && hasItems ? plan.downtownAmount ?? 0 : 0;
    const install = plan.install && hasItems ? Math.max(fileInstallRaw, file.pricing.install.minimum_total ?? 0) : 0;
    const delivery = plan.delivery && hasItems ? plan.deliveryAmount ?? 0 : 0;
    const products = cents(fileProducts);
    const preTax = cents(products + addons + install + delivery + downtown);
    const tax = cents(preTax * (file.pricing.tax ?? 0));
    fileTotals = { products, addons: cents(addons + downtown), install, delivery, promotion: 0, preTax, tax, grand: cents(preTax + tax) };
  }

  // ── 青砚一侧的合计（服务端同一个计价函数）──
  let qingyanTotals: SideTotals | null = null;
  if (!hasBlock && pending.length === 0) {
    const calc = qingyanCalc(applied, settings, promotion.total, true);
    qingyanTotals = {
      products: cents(calc.merchSubtotal),
      addons: cents(calc.addonsSubtotal),
      install: cents(calc.installApplied),
      delivery: cents(calc.deliveryFee),
      promotion: cents(calc.promotionApplied),
      preTax: cents(calc.preTaxTotal),
      tax: cents(calc.taxAmount),
      grand: cents(calc.grandTotal),
    };
  }

  return {
    rows,
    pricelistMatch,
    pricelistDiffs,
    fileTotals,
    qingyanTotals,
    promotion,
    hints,
    pendingFullnessRows: pending,
    canFill: !hasBlock && pending.length === 0,
  };
}
