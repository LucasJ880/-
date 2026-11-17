/**
 * 详细订单（Order Form）三张表 → 报价行（QuoteItemInput[]）
 *
 * 保存时提交给服务端的行构造，从 page.tsx handleSave 原样搬出（QUOTE-1a）。
 * 纯函数：对照测试 src/lib/blinds/__tests__/order-form-pricing-parity.test.ts 直接跑它，
 * 不再是页面组件里测不到的一段。定价面料只经 @/lib/blinds/order-form-pricing 取，
 * 与页面预览（pricing-helpers.ts）、报价 PDF 同一个取值。
 */
import type { QuoteItemInput } from "@/lib/blinds/pricing-types";
import { isManualPriceShadeProduct } from "@/lib/blinds/pricing-types";
import { allowsManualSellingPrice, fullnessFromPercent } from "@/lib/blinds/pricing-engine";
import {
  effectiveShadeValance,
  lineDiscountOverride,
  shadeLinePricingFabric,
  shutterPricingFabric,
} from "@/lib/blinds/order-form-pricing";
import type { DrapeOrderLine, ShadeOrderLine, ShutterOrderLine } from "./types";
import { fractionToInches } from "./types";

export interface OrderFormItemsInput {
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  drapeOrders: DrapeOrderLine[];
  shutterMaterial: "Wooden" | "Vinyl";
  /** Shades 表底部的 Valance Type：行上 Valance 为空时生效（与工艺单同口径） */
  shadeValanceType: string;
}

export function buildOrderFormItems({
  shadeOrders,
  shutterOrders,
  drapeOrders,
  shutterMaterial,
  shadeValanceType,
}: OrderFormItemsInput): QuoteItemInput[] {
  const items: QuoteItemInput[] = [];

  // Shades
  for (const l of shadeOrders) {
    // Roman：手填价分支，不要求价格表 SKU，只要宽高 + manualPrice（Allusion 2026-10-28 起走查表 + 可选覆盖）
    if (isManualPriceShadeProduct(l.product)) {
      if (!l.widthWhole || !l.heightWhole) continue;
      const w = fractionToInches(l.widthWhole, l.widthFrac);
      const h = fractionToInches(l.heightWhole, l.heightFrac);
      if (!w || !h) continue;
      const manual = parseFloat(l.manualPrice ?? "");
      if (!Number.isFinite(manual) || manual <= 0) continue;
      items.push({
        product: l.product,
        fabric: l.sku || l.product,
        widthIn: w,
        heightIn: h,
        location: l.location,
        sku: l.sku || l.product,
        manualPrice: manual,
        motorized: l.lift === "M",
      });
      continue;
    }
    if (!l.sku || !l.widthWhole || !l.heightWhole) continue;
    const w = fractionToInches(l.widthWhole, l.widthFrac);
    const h = fractionToInches(l.heightWhole, l.heightFrac);
    if (!w || !h) continue;
    // 把具体 SKU（例如 RL-AQUAWIDE3-BEIGE-LF）映射为定价表认的 fabric key
    // （例如 "Light Filtering (Open Roll)"），否则后端 priceFor 会报
    // "Pricing for this Roller fabric is not set yet"，导致整行价格丢失。
    // Roller 再按生效罩型（行上 → 表底部 Valance Type）落到 "(Open Roll)" / "w Cassette" / "w Fascia"；
    // 与页面预览同一个取值（order-form-pricing.ts）。
    const pricingFabric = shadeLinePricingFabric(l, effectiveShadeValance(l.valance, shadeValanceType));
    const manualOverride = allowsManualSellingPrice(l.product) ? parseFloat(l.manualPrice ?? "") : NaN;
    // 行级折扣（QUOTE-1b，只来自导入）：随行提交，服务端不再套企业默认折扣
    const lineDiscount = lineDiscountOverride(l.lineDiscountPct);
    items.push({
      product: l.product,
      fabric: pricingFabric,
      widthIn: w,
      heightIn: h,
      // PRICE-2（Q4 = A）：无绳只来自 Cordless 开关；Lift L/R 只表示拉杆位置
      cordless: l.cordless === true,
      motorized: l.lift === "M",
      location: l.location,
      sku: l.sku,
      // Allusion：手动成交单价覆盖随行上传，服务端用同一纯函数套用
      ...(Number.isFinite(manualOverride) && manualOverride > 0 ? { manualPrice: manualOverride } : {}),
      ...(lineDiscount != null ? { discountOverridePct: lineDiscount } : {}),
    });
  }

  // Shutters
  for (const l of shutterOrders) {
    if (!l.widthWhole || !l.heightWhole) continue;
    const w = fractionToInches(l.widthWhole, l.widthFrac);
    const h = fractionToInches(l.heightWhole, l.heightFrac);
    if (!w || !h) continue;
    const qty = Math.max(1, l.panelCount ?? 1);
    const base: QuoteItemInput = {
      product: "Shutters",
      // 定价键 Wood / Vinyl；sku 保留表单材质（Wooden / Vinyl）
      fabric: shutterPricingFabric(shutterMaterial),
      widthIn: w,
      heightIn: h,
      location: l.location,
      sku: shutterMaterial,
    };
    for (let i = 0; i < qty; i++) items.push({ ...base });
  }

  // Drapes（每行可能包含 Drape 和/或 Sheer，分别作为 item）
  for (const l of drapeOrders) {
    if (l.drapeFabricSku && l.drapeWidthWhole && l.drapeHeightWhole) {
      const w = fractionToInches(l.drapeWidthWhole, l.drapeWidthFrac);
      const h = fractionToInches(l.drapeHeightWhole, l.drapeHeightFrac);
      if (w && h) {
        items.push({
          product: "Drapery",
          fabric: l.drapeFabricSku,
          widthIn: w,
          heightIn: h,
          location: l.location,
          sku: l.drapeFabricSku,
          ...(fullnessFromPercent(l.drapeFullness) != null ? { fullness: fullnessFromPercent(l.drapeFullness)! } : {}),
          ...(lineDiscountOverride(l.drapeLineDiscountPct) != null ? { discountOverridePct: lineDiscountOverride(l.drapeLineDiscountPct)! } : {}),
        });
      }
    }
    if (l.sheerFabricSku && l.sheerWidthWhole && l.sheerHeightWhole) {
      const w = fractionToInches(l.sheerWidthWhole, l.sheerWidthFrac);
      const h = fractionToInches(l.sheerHeightWhole, l.sheerHeightFrac);
      if (w && h) {
        items.push({
          product: "Sheer",
          fabric: l.sheerFabricSku,
          widthIn: w,
          heightIn: h,
          location: l.location,
          sku: l.sheerFabricSku,
          ...(fullnessFromPercent(l.sheerFullness) != null ? { fullness: fullnessFromPercent(l.sheerFullness)! } : {}),
          ...(lineDiscountOverride(l.sheerLineDiscountPct) != null ? { discountOverridePct: lineDiscountOverride(l.sheerLineDiscountPct)! } : {}),
        });
      }
    }
  }

  return items;
}
