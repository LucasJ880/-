/**
 * 报价文件 → 详细订单表单数据（QUOTE-1b，design D6–D9）
 *
 * 纯函数：选定的一套方案 + 页面已加载的企业设置 → 三张表的行、Part B 行、安装方式、税率、客户四项、
 * 提示清单（阻断 / 提醒）、待选褶皱率的行、不经逐行对照就能确定的让利来源（负数附加项目、运费差）。
 * 逐行金额与「文件比青砚便宜」的差额在 compare.ts 里算。
 *
 * 不读、不产出窗户照片 / 试装图 / 面料资料；工艺参数（Mount、Lift、Bracket、褶型、Panels…）一律留空或表单默认值。
 */
import type { ProductName, InstallMode } from "@/lib/blinds/pricing-types";
import { BRACKETS, DEFAULT_DISCOUNTS, DOOR_SCREEN_SHEER_RULES, getAvailableFabrics } from "@/lib/blinds/pricing-data";
import { ADDON_CATALOG, PART_B_CUSTOM_SKU } from "@/lib/blinds/pricing-addons";
import { parseRollerFabric, VALANCE_NONE } from "@/lib/blinds/valance-options";
import type {
  DrapeOrderLine,
  PartBAddon,
  QuoteImportSource,
  ShadeOrderLine,
  ShutterOrderLine,
} from "@/app/(main)/sales/quote-sheet/types";
import {
  MAX_FORM_ROWS,
  QUOTE_FILE_FORMAT,
  type FileItem,
  type FilePlan,
  type ImportHint,
  type ParsedQuoteFile,
} from "./types";

const DOWNTOWN_ADDON_KEY = "downtown_fee";

export type FullnessChoice = "180" | "230";

export interface MapContext {
  /** 页面已加载的各产品企业折扣；缺的品类按缺省值 */
  orgDiscounts: Partial<Record<ProductName, number>> | undefined;
  /** 企业无绳折扣（无绳的 Zebra / Roller 行的「企业默认」是它） */
  cordlessDiscount: number;
  /** 企业运费 */
  deliveryFee: number;
  /** 该 SKU 是否在青砚的 SKU 目录里；不传则不做这项提醒 */
  isSkuInCatalog?: (product: ProductName, sku: string) => boolean;
  /** 生成行 id */
  newId: () => string;
}

/** 文件里的一行映射成了什么 */
export interface MappedRow {
  /** 文件里的第几行（从 1 起） */
  rowIndex: number;
  table: "shade" | "shutter" | "drape" | null;
  /** 该行拆出的表单行 id（数量 N → N 个）；被阻断的行为空 */
  lineIds: string[];
  blocked: boolean;
  /** 褶皱率不是 1.8 / 2.3，需要销售选 180 或 230 */
  needsFullnessChoice: boolean;
  /** 保留到行上的行级折扣；没有为 null */
  keptDiscountPct: number | null;
  /** 映射时采用的褶皱率档（已是两档之一的行）；待选或不适用为 null */
  fullnessTier: FullnessChoice | null;
}

export interface MappedQuote {
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  drapeOrders: DrapeOrderLine[];
  /** 方案里有百叶窗行时的材质；没有百叶窗行为 null（表单保持原值） */
  shutterMaterial: "Wooden" | "Vinyl" | null;
  partBAddons: PartBAddon[];
  partBNotes: string;
  installMode: InstallMode;
  /** 文件税率；文件没有可用税率时为 null（表单保持原值） */
  taxRate: number | null;
  customer: { name: string; phone: string; email: string; address: string };
  rows: MappedRow[];
  hints: ImportHint[];
  /** 负数附加项目的绝对值合计（进特别让利） */
  addonPromotion: number;
  /** 运费差（进特别让利） */
  deliveryPromotion: number;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `$${cents(n).toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** 小数英寸 → 整数 + 1/16"；不在格上的四舍五入到最近一格 */
export function toSixteenths(inches: number): { whole: string; frac: string; rounded: boolean; value: number } {
  const ticks = Math.round(inches * 16);
  return {
    whole: String(Math.floor(ticks / 16)),
    frac: String(ticks % 16),
    rounded: Math.abs(inches * 16 - ticks) > 1e-7,
    value: ticks / 16,
  };
}

function inch16Label(v: { whole: string; frac: string }): string {
  return v.frac === "0" ? `${v.whole}"` : `${v.whole} ${v.frac}/16"`;
}

/** 文件褶皱率 → 两档之一；不是 1.8 / 2.3 → null（由销售选） */
export function fullnessTierOf(fullness: number): FullnessChoice | null {
  if (Math.abs(fullness - 1.8) < 1e-9) return "180";
  if (Math.abs(fullness - 2.3) < 1e-9) return "230";
  return null;
}

function usesFullnessRow(item: FileItem): boolean {
  return (item.product === "Drapery" || item.product === "Sheer") && item.fabric !== "Door Screen Sheer";
}

/** 该行在文件里的褶皱率：行上的值，否则文件的默认值，否则工具默认 2 */
export function fileFullnessOf(item: FileItem, file: Pick<ParsedQuoteFile, "pricing">): number {
  if (item.fullness !== null) return item.fullness;
  const d = item.product === "Drapery" ? file.pricing?.fullness.Drapery : file.pricing?.fullness.Sheer;
  return typeof d === "number" && Number.isFinite(d) ? d : 2;
}

function orgDefaultDiscount(item: FileItem, ctx: MapContext): number {
  if (item.cordless && (item.product === "Zebra" || item.product === "Roller")) return ctx.cordlessDiscount;
  const d = ctx.orgDiscounts?.[item.product];
  return typeof d === "number" && Number.isFinite(d) ? d : DEFAULT_DISCOUNTS[item.product] ?? 0;
}

function rowNames(room: string, qty: number): string[] {
  return Array.from({ length: qty }, (_, i) => (i === 0 ? room : `${room} (${i + 1})`.trim()));
}

/** 尺寸是否超出青砚价表；返回中文说明或 null。布帘 / 纱帘按给定褶皱率折算查表宽 */
function rangeProblem(item: FileItem, w: number, h: number, fullness: number | null): string | null {
  if (item.product === "Sheer" && item.fabric === "Door Screen Sheer") {
    const maxW = DOOR_SCREEN_SHEER_RULES.tiers[DOOR_SCREEN_SHEER_RULES.tiers.length - 1].maxWidth;
    return w > maxW || h > DOOR_SCREEN_SHEER_RULES.maxHeight
      ? `Door Screen Sheer 只做到宽 ${maxW}"、高 ${DOOR_SCREEN_SHEER_RULES.maxHeight}"`
      : null;
  }
  const b = BRACKETS[item.product];
  const maxW = Math.max(...b.widths);
  const maxH = Math.max(...b.heights);
  const lookupW = fullness !== null ? (w * fullness) / 2 : w;
  if (lookupW <= maxW && h <= maxH) return null;
  const windowMaxW = fullness !== null ? Math.round(((maxW * 2) / fullness) * 100) / 100 : maxW;
  return `超出青砚 ${item.product} 价表范围（${fullness !== null ? `褶皱率 ${fullness} 倍下` : ""}最大宽 ${windowMaxW}"、最大高 ${maxH}"）`;
}

function findCatalogAddon(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const hit = ADDON_CATALOG.find(
    (a) => a.displayName.trim().toLowerCase() === wanted || a.printLabel.trim().toLowerCase() === wanted,
  );
  return hit ? hit.key : null;
}

/**
 * 把选定的一套方案映射成表单数据。
 * 待选褶皱率的行先按 180 生成表单行（占位），由 applyFullnessChoices 换成销售选的档；全部选完之前不能填入表单。
 */
export function mapQuoteToForm(file: ParsedQuoteFile, plan: FilePlan, ctx: MapContext): MappedQuote {
  const hints: ImportHint[] = [];
  const block = (code: string, messageZh: string, rowIndex?: number) => hints.push({ level: "block", code, messageZh, ...(rowIndex ? { rowIndex } : {}) });
  const warn = (code: string, messageZh: string, rowIndex?: number) => hints.push({ level: "warn", code, messageZh, ...(rowIndex ? { rowIndex } : {}) });

  const shadeOrders: ShadeOrderLine[] = [];
  const shutterOrders: ShutterOrderLine[] = [];
  const drapeOrders: DrapeOrderLine[] = [];
  const rows: MappedRow[] = [];

  // ── 拆行后的总行数 ──
  const expanded = plan.items.reduce((n, it) => n + (it.qty !== null && Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= 999 ? it.qty : 1), 0);
  const tooManyRows = expanded > MAX_FORM_ROWS;
  if (tooManyRows) block("too_many_rows", `拆行后共 ${expanded} 行，超过 ${MAX_FORM_ROWS} 行，无法导入；请把文件拆成几份`);

  // ── Shutters 材质：一张报价只有一种 ──
  const shutterFabrics = new Set(plan.items.filter((it) => it.product === "Shutters").map((it) => it.fabric));
  const shutterMixed = shutterFabrics.has("Vinyl") && shutterFabrics.has("Wood");
  if (shutterMixed) {
    block("shutter_mixed", "同一套方案里既有 Vinyl 又有 Wood 的百叶窗；青砚一张报价只能有一种材质，请把文件拆成两份分别导入");
  }
  const shutterMaterial: MappedQuote["shutterMaterial"] = shutterMixed
    ? null
    : shutterFabrics.has("Wood") ? "Wooden" : shutterFabrics.has("Vinyl") ? "Vinyl" : null;

  plan.items.forEach((item, i) => {
    const rowIndex = i + 1;
    const row: MappedRow = { rowIndex, table: null, lineIds: [], blocked: false, needsFullnessChoice: false, keptDiscountPct: null, fullnessTier: null };
    rows.push(row);
    const blockRow = (code: string, messageZh: string) => { row.blocked = true; block(code, `第 ${rowIndex} 行：${messageZh}`, rowIndex); };

    row.table = item.product === "Shutters" ? "shutter" : item.product === "Drapery" || item.product === "Sheer" ? "drape" : "shade";

    // ── 不信任文件：数量、尺寸、折扣、成交价 ──
    if (item.invalid.length > 0) {
      const names: Record<string, string> = { w: "宽", h: "高", qty: "数量", offer: "成交价", discountOverridePct: "折扣", fullness: "褶皱率" };
      blockRow("bad_value", `${item.invalid.map((k) => names[k] ?? k).join("、")}不是有效的数字`);
      return;
    }
    if (item.qty === null || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 999) {
      blockRow("bad_qty", `数量须为 1–999 的整数（文件里是 ${item.qty ?? "空"}）`);
      return;
    }
    if (item.w === null || item.h === null || item.w <= 0 || item.h <= 0) {
      blockRow("bad_size", `宽和高必须大于 0（文件里是 ${item.w ?? "空"} × ${item.h ?? "空"}）`);
      return;
    }
    if (item.discountOverridePct !== null && (item.discountOverridePct < 0 || item.discountOverridePct > 1)) {
      blockRow("bad_discount", `折扣须在 0% 到 100% 之间（文件里是 ${pct(item.discountOverridePct)}）`);
      return;
    }
    if (item.offer !== null && item.offer < 0) {
      blockRow("bad_offer", "成交价不能是负数");
      return;
    }
    if (!getAvailableFabrics(item.product).includes(item.fabric)) {
      blockRow("unknown_fabric", `${item.product} 的配置「${item.fabric || "（空）"}」青砚的价表里没有`);
      return;
    }
    if (shutterMixed && item.product === "Shutters") { row.blocked = true; return; }
    if (tooManyRows) { row.blocked = true; return; }

    // ── 尺寸取整到 1/16" ──
    const w16 = toSixteenths(item.w);
    const h16 = toSixteenths(item.h);
    if (w16.rounded || h16.rounded) {
      const parts: string[] = [];
      if (w16.rounded) parts.push(`宽 ${item.w}" 取整为 ${inch16Label(w16)}`);
      if (h16.rounded) parts.push(`高 ${item.h}" 取整为 ${inch16Label(h16)}`);
      warn("size_rounded", `第 ${rowIndex} 行：${parts.join("，")}（青砚按 1/16" 录入）`, rowIndex);
    }
    if (w16.value <= 0 || h16.value <= 0) {
      blockRow("bad_size", `尺寸取整到 1/16" 后为 0（文件里是 ${item.w} × ${item.h}）`);
      return;
    }

    // ── 褶皱率落档 ──
    let fullnessValue: number | null = null;
    if (usesFullnessRow(item)) {
      const f = fileFullnessOf(item, file);
      if (!(f >= 1 && f <= 4)) {
        blockRow("bad_fullness", `褶皱率须在 1 到 4 倍之间（文件里是 ${f}）`);
        return;
      }
      row.fullnessTier = fullnessTierOf(f);
      row.needsFullnessChoice = row.fullnessTier === null;
      fullnessValue = row.fullnessTier === "180" ? 1.8 : row.fullnessTier === "230" ? 2.3 : null;
    }

    // ── 尺寸是否超出价表（待选褶皱率的行：两档都超才在这里阻断，只超一档的在核对窗里那一档不可选）──
    const range = usesFullnessRow(item)
      ? (fullnessValue !== null
          ? rangeProblem(item, w16.value, h16.value, fullnessValue)
          : rangeProblem(item, w16.value, h16.value, 1.8) && rangeProblem(item, w16.value, h16.value, 2.3)
            ? rangeProblem(item, w16.value, h16.value, 1.8)
            : null)
      : rangeProblem(item, w16.value, h16.value, null);
    if (range) {
      blockRow("out_of_range", `${item.product} ${item.w}" × ${item.h}" ${range}`);
      return;
    }

    // ── 行级折扣：低于企业默认（价格更高）才保留到行上 ──
    const orgDefault = orgDefaultDiscount(item, ctx);
    const keep = item.discountOverridePct !== null && item.discountOverridePct < orgDefault - 1e-9;
    if (keep && row.table === "shutter") {
      warn("shutter_discount_not_kept", `第 ${rowIndex} 行：文件里的行折扣 ${pct(item.discountOverridePct!)} 低于企业默认 ${pct(orgDefault)}，百叶窗行不能带行级折扣，青砚按企业默认计价`, rowIndex);
    } else if (keep) {
      row.keptDiscountPct = item.discountOverridePct;
    }

    const names = rowNames(item.room, item.qty);

    if (row.table === "shade") {
      const isRoller = item.product === "Roller";
      const cordless = item.cordless && (item.product === "Zebra" || item.product === "Roller");
      if (item.cordless && !cordless) {
        warn("cordless_ignored", `第 ${rowIndex} 行：文件里标了无绳，青砚只有 Zebra 与 Roller 有无绳价，${item.product} 按普通款计价`, rowIndex);
      }
      if (!item.sku) {
        warn("sku_missing", `第 ${rowIndex} 行：文件没有填 SKU，已用配置名称「${item.fabric}」代填，请在表单里补上真实 SKU`, rowIndex);
      } else if (ctx.isSkuInCatalog && !ctx.isSkuInCatalog(item.product, item.sku)) {
        warn("sku_not_in_catalog", `第 ${rowIndex} 行：SKU「${item.sku}」不在青砚的 SKU 目录里（下拉里显示为「目录外」），金额按文件的配置「${item.fabric}」计算`, rowIndex);
      }
      // Allusion：成交价填该行既有的手填成交单价
      const manualPrice = item.product === "Allusion" && item.offer !== null && item.offer > 0 ? String(item.offer) : undefined;
      for (const location of names) {
        const id = ctx.newId();
        row.lineIds.push(id);
        shadeOrders.push({
          id,
          location,
          widthWhole: w16.whole, widthFrac: w16.frac, heightWhole: h16.whole, heightFrac: h16.frac,
          product: item.product,
          sku: item.sku || item.fabric,
          mount: "", lift: "", bracket: "",
          // Roller：面料档拆成基础面料 + 罩型；(Open Roll) 明确填 None，不受表底部 Valance Type 影响
          valance: isRoller ? parseRollerFabric(item.fabric).valance || VALANCE_NONE : "",
          note: item.note,
          cordless,
          pricingFabric: item.fabric,
          ...(manualPrice ? { manualPrice } : {}),
          ...(row.keptDiscountPct !== null ? { lineDiscountPct: row.keptDiscountPct } : {}),
        });
      }
      return;
    }

    if (row.table === "shutter") {
      for (const location of names) {
        const id = ctx.newId();
        row.lineIds.push(id);
        shutterOrders.push({
          id,
          location,
          widthWhole: w16.whole, widthFrac: w16.frac, heightWhole: h16.whole, heightFrac: h16.frac,
          frame: "", openDirection: "", mountType: "", midRail: "", panelCount: 1, draft: "",
        });
      }
      return;
    }

    // ── Drapes：Drapery 填布帘一侧，Sheer（含 Door Screen Sheer）填纱帘一侧，每个文件行一条 ──
    const tier: FullnessChoice = row.fullnessTier ?? "180";
    for (const location of names) {
      const id = ctx.newId();
      row.lineIds.push(id);
      const isDrape = item.product === "Drapery";
      drapeOrders.push({
        id,
        location,
        drapeWidthWhole: isDrape ? w16.whole : "", drapeWidthFrac: isDrape ? w16.frac : "0",
        drapeHeightWhole: isDrape ? h16.whole : "", drapeHeightFrac: isDrape ? h16.frac : "0",
        // 布帘一侧不用时保持表单默认档（与手工只填纱帘的行同形）
        drapeFabricSku: isDrape ? item.fabric : "Without liner",
        drapeFullness: isDrape ? tier : "180",
        drapePanels: "S", drapePleatStyle: "",
        drapeLiner: isDrape ? /with\s*liner/i.test(item.fabric) : false,
        drapeBracket: "",
        sheerWidthWhole: isDrape ? "" : w16.whole, sheerWidthFrac: isDrape ? "0" : w16.frac,
        sheerHeightWhole: isDrape ? "" : h16.whole, sheerHeightFrac: isDrape ? "0" : h16.frac,
        sheerFabricSku: isDrape ? "" : item.fabric,
        sheerFullness: isDrape ? "180" : tier,
        sheerPanels: "S", sheerPleatStyle: "", sheerBracket: "",
        accessoriesSku: "",
        note: item.note,
        ...(row.keptDiscountPct !== null ? (isDrape ? { drapeLineDiscountPct: row.keptDiscountPct } : { sheerLineDiscountPct: row.keptDiscountPct }) : {}),
      });
    }
  });

  // ── 附加项目 ──
  const partBAddons: PartBAddon[] = [];
  let addonPromotion = 0;
  const pushAddon = (skuItem: string, customName: string | undefined, qty: number, price: number) => {
    partBAddons.push({ id: ctx.newId(), skuItem, ...(customName !== undefined ? { customName } : {}), qty, price, total: cents(qty * price) });
  };
  plan.addons.forEach((a, i) => {
    const n = i + 1;
    if (!a.name || a.qty === null || a.price === null || a.qty <= 0 || a.qty > 99999 || Math.abs(a.price) > 1e8) {
      block("bad_addon", `附加项目第 ${n} 项（${a.name || "未命名"}）的名称、数量或单价无效`);
      return;
    }
    const amount = cents(a.qty * a.price);
    if (a.price < 0) {
      addonPromotion += -amount;
      warn("addon_negative", `附加项目「${a.name}」金额 ${money(amount)} 是减项，已计入特别让利 ${money(-amount)}，不进 Part B`);
      return;
    }
    if (!Number.isInteger(a.qty)) {
      pushAddon(PART_B_CUSTOM_SKU, `${a.name} × ${a.qty}`, 1, amount);
      warn("addon_fraction_qty", `附加项目「${a.name}」的数量 ${a.qty} 不是整数，已按合计 ${money(amount)} 填成一项自定义行`);
      return;
    }
    const key = findCatalogAddon(a.name);
    if (key) pushAddon(key, undefined, a.qty, a.price);
    else {
      pushAddon(PART_B_CUSTOM_SKU, a.name, a.qty, a.price);
      warn("addon_custom", `附加项目「${a.name}」在青砚的目录里没有同名项，已填成自定义行（单价照文件 ${money(a.price)}）`);
    }
  });

  // ── Downtown 服务费 ──
  if (plan.downtown && plan.items.length > 0) {
    if (plan.downtownAmount === null || plan.downtownAmount < 0) block("bad_fee", "Downtown 服务费的金额无效");
    else if (plan.downtownAmount > 0) pushAddon(DOWNTOWN_ADDON_KEY, undefined, 1, plan.downtownAmount);
  }

  // ── 安装 / 送货 ──
  const installMode: InstallMode = plan.install ? "default" : "pickup";
  let deliveryPromotion = 0;
  const deliveryBad = plan.delivery && (plan.deliveryAmount === null || plan.deliveryAmount < 0);
  if (deliveryBad) block("bad_fee", "送货费的金额无效");
  if (!deliveryBad && plan.items.length > 0) {
    const fileDelivery = plan.delivery ? plan.deliveryAmount ?? 0 : 0;
    if (plan.install) {
      const diff = cents(ctx.deliveryFee - fileDelivery);
      if (diff > 0) {
        deliveryPromotion = diff;
        warn(
          "delivery_promotion",
          plan.delivery
            ? `文件送货费 ${money(fileDelivery)} 低于企业运费 ${money(ctx.deliveryFee)}，差额 ${money(diff)} 已计入特别让利`
            : `文件不含送货，青砚含安装的报价固定收企业运费 ${money(ctx.deliveryFee)}，这笔已全额计入特别让利`,
        );
      } else if (diff < 0) {
        pushAddon(PART_B_CUSTOM_SKU, "Delivery surcharge", 1, -diff);
        warn("delivery_surcharge", `文件送货费 ${money(fileDelivery)} 高于企业运费 ${money(ctx.deliveryFee)}，差额 ${money(-diff)} 已填成自定义行「Delivery surcharge」`);
      }
    } else {
      warn("pickup", "文件不含安装：安装方式已设为自提（不收安装费与企业运费）");
      if (fileDelivery > 0) {
        pushAddon(PART_B_CUSTOM_SKU, "Delivery", 1, fileDelivery);
        warn("delivery_custom", `文件不含安装但含送货 ${money(fileDelivery)}，已填成自定义行「Delivery」`);
      }
    }
  }

  // ── 税率 ──
  const tax = file.pricing?.tax;
  const taxRate = typeof tax === "number" && tax >= 0 && tax <= 1 ? tax : null;
  if (taxRate === null) warn("tax_missing", "文件里没有可用的税率，表单沿用当前税率，请核对");

  // ── 整单提醒 ──
  if (file.photoCount > 0) warn("photos_skipped", `有 ${file.photoCount} 张窗户照片未导入`);
  if (rows.some((r) => !r.blocked)) {
    warn("craft_params", "Mount、Lift、Bracket、褶型、Panels 等工艺参数文件里没有，导入后留空，需要在表单里补（签字后由工艺单的待核对清单把关）");
  }
  if (rows.some((r) => r.needsFullnessChoice && !r.blocked)) {
    warn("fullness_choice", "有布帘 / 纱帘行的褶皱率不是 1.8 或 2.3：详细订单只有 180 / 230 两档，需要逐行选一档后才能填入表单");
  }

  return {
    shadeOrders, shutterOrders, drapeOrders, shutterMaterial,
    partBAddons, partBNotes: plan.note, installMode, taxRate,
    customer: { ...file.customer },
    rows, hints,
    addonPromotion: cents(addonPromotion),
    deliveryPromotion,
  };
}

/** 还有哪些行没选褶皱率（文件行号） */
export function pendingFullnessRows(mapped: MappedQuote, choices: Record<number, FullnessChoice | undefined>): number[] {
  return mapped.rows.filter((r) => r.needsFullnessChoice && !r.blocked && !choices[r.rowIndex]).map((r) => r.rowIndex);
}

/** 把销售选的褶皱率档写进对应的 Drapes 行（返回新对象，不改入参） */
export function applyFullnessChoices(mapped: MappedQuote, choices: Record<number, FullnessChoice | undefined>): MappedQuote {
  const tierByLine = new Map<string, FullnessChoice>();
  for (const r of mapped.rows) {
    const c = choices[r.rowIndex];
    if (r.needsFullnessChoice && c) for (const id of r.lineIds) tierByLine.set(id, c);
  }
  if (tierByLine.size === 0) return mapped;
  return {
    ...mapped,
    drapeOrders: mapped.drapeOrders.map((l) => {
      const c = tierByLine.get(l.id);
      if (!c) return l;
      return l.sheerFabricSku && l.sheerWidthWhole ? { ...l, sheerFullness: c } : { ...l, drapeFullness: c };
    }),
  };
}

export interface CustomerCandidate {
  id: string;
  phone?: string | null;
  email?: string | null;
}

function phoneDigits(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D+/g, "");
  // 北美号码：去掉前导 1
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * 在页面已加载的客户里按电话（只比数字）或邮箱找：恰好一位命中才返回其 id，零位或多位命中返回 null。
 * 电话少于 7 位数字不参与匹配（避免分机号、残缺号码误配）。
 */
export function matchCustomer(
  fileCustomer: { phone: string; email: string },
  customers: readonly CustomerCandidate[],
): string | null {
  const phone = phoneDigits(fileCustomer.phone);
  const email = fileCustomer.email.replace(/\s+/g, "").toLowerCase();
  const usePhone = phone.length >= 7;
  const useEmail = email.includes("@");
  if (!usePhone && !useEmail) return null;
  const hits = new Set<string>();
  for (const c of customers) {
    const byPhone = usePhone && phoneDigits(c.phone) === phone;
    const byEmail = useEmail && String(c.email ?? "").replace(/\s+/g, "").toLowerCase() === email;
    if (byPhone || byEmail) hits.add(c.id);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** 导入留痕：只读，随表单数据保存；文件合计是重算值，算不出时为 null */
export function buildImportSource(
  file: ParsedQuoteFile,
  plan: FilePlan,
  input: { importedAt: string; fileGrandTotal: number | null; pricelistMatch: boolean },
): QuoteImportSource {
  return {
    tool: QUOTE_FILE_FORMAT,
    fileVersion: file.fileVersion,
    quoteId: file.quoteId,
    quoteNumber: file.quoteNumber,
    plan: plan.planId,
    exportedAt: file.exportedAt,
    pricelistVersion: file.pricing?.version ?? "",
    fileGrandTotal: input.fileGrandTotal,
    importedAt: input.importedAt,
    pricelistMatch: input.pricelistMatch,
    rowCount: plan.items.length,
  };
}

/** 表单里由导入覆盖的那部分（其余字段保持页面当前值） */
export interface ImportFormFill {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  drapeOrders: DrapeOrderLine[];
  shutterMaterial?: "Wooden" | "Vinyl";
  partBAddons: PartBAddon[];
  partBNotes: string;
  installMode: InstallMode;
  taxRate?: number;
  specialPromotion: string;
  importSource: QuoteImportSource;
}

/**
 * 产出交给页面 applyFormState 的那部分数据。specialPromotion 取到分；为 0 时填空串（与没填让利的表单同形）。
 * 调用前须确认没有阻断、褶皱率都已选（见 compare.ts 的 canFill）。
 */
export function buildFormFill(
  mapped: MappedQuote,
  input: { customerId: string | null; specialPromotion: number; importSource: QuoteImportSource },
): ImportFormFill {
  const promo = cents(Math.max(0, input.specialPromotion));
  return {
    customerId: input.customerId ?? "",
    customerName: mapped.customer.name,
    customerPhone: mapped.customer.phone,
    customerEmail: mapped.customer.email,
    customerAddress: mapped.customer.address,
    shadeOrders: mapped.shadeOrders,
    shutterOrders: mapped.shutterOrders,
    drapeOrders: mapped.drapeOrders,
    ...(mapped.shutterMaterial ? { shutterMaterial: mapped.shutterMaterial } : {}),
    partBAddons: mapped.partBAddons,
    partBNotes: mapped.partBNotes,
    installMode: mapped.installMode,
    ...(mapped.taxRate !== null ? { taxRate: mapped.taxRate } : {}),
    specialPromotion: promo > 0 ? promo.toFixed(2) : "",
    importSource: input.importSource,
  };
}
