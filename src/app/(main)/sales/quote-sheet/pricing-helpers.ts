import type { ShadeOrderLine, ShutterOrderLine, DrapeOrderLine, InstallMode } from "./types";
import { fractionToInches } from "./types";
import { priceFor } from "@/lib/blinds/pricing-engine";
import { INSTALL_RULES } from "@/lib/blinds/pricing-data";
import { skuToPricingFabric } from "@/lib/blinds/sku-catalog";
import type { ProductName } from "@/lib/blinds/pricing-types";
import { isManualPriceShadeProduct } from "@/lib/blinds/pricing-types";

/**
 * 所有 compute*LinePrice 第 n+1 个参数都接受可选 discounts 覆盖表
 * - 传入：使用传入值作为各产品折扣率（来自 /api/sales/quote-settings/discounts）
 * - 不传：fallback 到 pricing-data.ts 内置 DEFAULT_DISCOUNTS
 *
 * 这样 Order Form 的折扣率 = AI 工具的折扣率 = 驾驶舱里设置的折扣率。
 */
export type DiscountsOverride = Partial<Record<ProductName, number>>;

function pick(discounts: DiscountsOverride | undefined, p: ProductName): number | null {
  if (!discounts) return null;
  const v = discounts[p];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 把全部产品折扣强制设为 0，用于求 MSRP 之和（成交折扣率的分母）
 * 不含 Part B/C（抉择 C1）；不含安装费（installMode="pickup" 归零）
 */
const ZERO_DISCOUNTS: DiscountsOverride = {
  Zebra: 0,
  SHANGRILA: 0,
  "Cordless Cellular": 0,
  Roller: 0,
  Drapery: 0,
  Sheer: 0,
  Shutters: 0,
  SkylightHoneycomb: 0,
  Allusion: 0,
  Roman: 0,
};

export function sumAllMsrp(
  shadeOrders: ShadeOrderLine[],
  shutterOrders: ShutterOrderLine[],
  shutterMaterial: "Wooden" | "Vinyl",
  drapeOrders: DrapeOrderLine[],
): number {
  const shades = sumShadeTotals(shadeOrders, "pickup", ZERO_DISCOUNTS).merch;
  const shutters = sumShutterTotals(shutterOrders, shutterMaterial, "pickup", ZERO_DISCOUNTS).merch;
  const drapes = sumDrapeTotals(drapeOrders, "pickup", ZERO_DISCOUNTS).merch;
  return shades + shutters + drapes;
}

/**
 * 共享：三类订单表的逐行价格 + 小计
 *
 * 目的：page.tsx 和各个 order-xxx.tsx 都能复用，避免小计拼凑漂移。
 */

export interface LinePrice {
  merch: number;
  install: number;
  total: number;
  error: string | null;
}

export interface SectionTotals {
  merch: number;
  install: number;
  total: number;
}

export function emptyTotals(): SectionTotals {
  return { merch: 0, install: 0, total: 0 };
}

// ── Shades ──
export function computeShadeLinePrice(
  line: ShadeOrderLine,
  installMode: InstallMode,
  discounts?: DiscountsOverride,
): LinePrice | null {
  // Allusion / Roman：销售手填单价，跳过 MSRP 表
  if (isManualPriceShadeProduct(line.product)) {
    if (!line.widthWhole || !line.heightWhole) return null;
    const w = fractionToInches(line.widthWhole, line.widthFrac);
    const h = fractionToInches(line.heightWhole, line.heightFrac);
    if (!w || !h) return null;
    const manual = parseFloat(line.manualPrice ?? "");
    if (!Number.isFinite(manual) || manual <= 0) {
      return { merch: 0, install: 0, total: 0, error: `请手填 ${line.product} 单价` };
    }
    // install 规则：宽度超过阈值用 wide，否则 regular（与 Shade 其他产品一致）
    const install =
      installMode === "pickup"
        ? 0
        : (w > INSTALL_RULES.wideThresholdIn ? INSTALL_RULES.wide : INSTALL_RULES.regular);
    return { merch: manual, install, total: manual + install, error: null };
  }

  if (!line.sku || !line.widthWhole || !line.heightWhole) return null;
  const w = fractionToInches(line.widthWhole, line.widthFrac);
  const h = fractionToInches(line.heightWhole, line.heightFrac);
  if (!w || !h) return null;

  const fabric = skuToPricingFabric(line.sku, line.product);
  const result = priceFor(line.product, fabric, w, h, pick(discounts, line.product));
  if ("error" in result) {
    return { merch: 0, install: 0, total: 0, error: result.error };
  }
  const merch = result.price;
  const install = installMode === "pickup" ? 0 : result.install;
  return { merch, install, total: merch + install, error: null };
}

export function sumShadeTotals(
  lines: ShadeOrderLine[],
  installMode: InstallMode,
  discounts?: DiscountsOverride,
): SectionTotals {
  const totals = emptyTotals();
  for (const line of lines) {
    const p = computeShadeLinePrice(line, installMode, discounts);
    if (!p || p.error) continue;
    totals.merch += p.merch;
    totals.install += p.install;
    totals.total += p.total;
  }
  return totals;
}

// ── Shutters ──
// 约束：MSRP_SHUTTERS 目前只有 "Vinyl" 数据，"Wooden" 会 priceFor 报 error。
//        这属于定价库的约束（不在本次改动范围），UI 会显示"—"并在 tooltip 说明 error。
export function computeShutterLinePrice(
  line: ShutterOrderLine,
  material: "Wooden" | "Vinyl",
  installMode: InstallMode,
  discounts?: DiscountsOverride,
): LinePrice | null {
  if (!line.widthWhole || !line.heightWhole) return null;
  const w = fractionToInches(line.widthWhole, line.widthFrac);
  const h = fractionToInches(line.heightWhole, line.heightFrac);
  if (!w || !h) return null;

  const result = priceFor("Shutters", material, w, h, pick(discounts, "Shutters"));
  if ("error" in result) {
    return { merch: 0, install: 0, total: 0, error: result.error };
  }
  const panelQty = Math.max(1, line.panelCount ?? 1);
  const merch = result.price * panelQty;
  const install = installMode === "pickup" ? 0 : result.install * panelQty;
  return { merch, install, total: merch + install, error: null };
}

export function sumShutterTotals(
  lines: ShutterOrderLine[],
  material: "Wooden" | "Vinyl",
  installMode: InstallMode,
  discounts?: DiscountsOverride,
): SectionTotals {
  const totals = emptyTotals();
  for (const line of lines) {
    const p = computeShutterLinePrice(line, material, installMode, discounts);
    if (!p || p.error) continue;
    totals.merch += p.merch;
    totals.install += p.install;
    totals.total += p.total;
  }
  return totals;
}

// ── Drapes（含 Drape 和 Sheer 两块）──
export interface DrapeLinePrice {
  drapeMerch: number;
  drapeInstall: number;
  sheerMerch: number;
  sheerInstall: number;
  total: number;
  error: string | null;
}

export function computeDrapeLinePrice(
  line: DrapeOrderLine,
  installMode: InstallMode,
  discounts?: DiscountsOverride,
): DrapeLinePrice | null {
  const isPickup = installMode === "pickup";
  let drapeMerch = 0;
  let drapeInstall = 0;
  let sheerMerch = 0;
  let sheerInstall = 0;
  let error: string | null = null;
  let any = false;

  if (line.drapeFabricSku && line.drapeWidthWhole && line.drapeHeightWhole) {
    const w = fractionToInches(line.drapeWidthWhole, line.drapeWidthFrac);
    const h = fractionToInches(line.drapeHeightWhole, line.drapeHeightFrac);
    if (w && h) {
      const r = priceFor("Drapery", line.drapeFabricSku, w, h, pick(discounts, "Drapery"));
      if ("error" in r) {
        error = `Drape: ${r.error}`;
      } else {
        drapeMerch = r.price;
        drapeInstall = isPickup ? 0 : r.install;
        any = true;
      }
    }
  }

  if (line.sheerFabricSku && line.sheerWidthWhole && line.sheerHeightWhole) {
    const w = fractionToInches(line.sheerWidthWhole, line.sheerWidthFrac);
    const h = fractionToInches(line.sheerHeightWhole, line.sheerHeightFrac);
    if (w && h) {
      const r = priceFor("Sheer", line.sheerFabricSku, w, h, pick(discounts, "Sheer"));
      if ("error" in r) {
        error = error ? `${error}; Sheer: ${r.error}` : `Sheer: ${r.error}`;
      } else {
        sheerMerch = r.price;
        sheerInstall = isPickup ? 0 : r.install;
        any = true;
      }
    }
  }

  if (!any && !error) return null;
  return {
    drapeMerch,
    drapeInstall,
    sheerMerch,
    sheerInstall,
    total: drapeMerch + drapeInstall + sheerMerch + sheerInstall,
    error,
  };
}

export function sumDrapeTotals(
  lines: DrapeOrderLine[],
  installMode: InstallMode,
  discounts?: DiscountsOverride,
): SectionTotals {
  const totals = emptyTotals();
  for (const line of lines) {
    const p = computeDrapeLinePrice(line, installMode, discounts);
    if (!p || p.error) continue;
    totals.merch += p.drapeMerch + p.sheerMerch;
    totals.install += p.drapeInstall + p.sheerInstall;
    totals.total += p.total;
  }
  return totals;
}
