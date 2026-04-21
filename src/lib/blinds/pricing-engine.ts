/**
 * Sunny Shutter Pricing Engine
 * Ported from SUNNY_QUOTE_MARCH_AI_voice_cordless.html → priceFor()
 *
 * Pure functions, no side effects. Safe for server & client.
 */

import type {
  ProductName,
  PriceResult,
  PriceError,
  QuoteItemInput,
  QuoteTotalInput,
  QuoteTotalResult,
  InstallMode,
} from './pricing-types';

import {
  BRACKETS,
  DEFAULT_DISCOUNTS,
  PRICE_FLOOR,
  INSTALL_RULES,
  DEFAULT_DELIVERY_FEE,
  DEFAULT_TAX_RATE,
  DEFAULT_CORDLESS_MULTIPLIER,
  CORDLESS_MAX_WIDTH,
  CORDLESS_MAX_HEIGHT,
  MSRP_ROLLER,
  ROLLER_FABRICS,
  DOOR_SCREEN_SHEER_RULES,
  getMsrpTable,
} from './pricing-data';

import { calcAddonSubtotal } from './pricing-addons';

// ─── Helpers ───────────────────────────────────────────────

function ceilIndex(val: number, arr: readonly number[]): number {
  for (let i = 0; i < arr.length; i++) {
    if (val <= arr[i]) return i;
  }
  return -1;
}

function isCordlessEligible(product: ProductName): boolean {
  return product === 'Zebra' || product === 'Roller';
}

/**
 * 后端兜底：如果前端误把具体 SKU（如 RL-AQUAWIDE3-BEIGE-LF）当作 fabric
 * 发过来，这里按后缀 -LF / -SC / -BO / -DO 粗略映射到类别 key，避免整张报价
 * 因为对不上 fabric 就丢失大头金额。
 *
 * 只做保守兜底：
 *   - Roller：返回 ROLLER_FABRICS 里匹配的类别 key
 *   - 标准产品：返回 getMsrpTable 能识别的 fabric key
 *
 * 前端理想路径是先走 skuToPricingFabric 再发请求，这里是双保险。
 */
function fallbackFabricKey(product: ProductName, rawSku: string): string | null {
  const upper = String(rawSku || '').toUpperCase();
  const wantBlackout = /-(BO|DO)$/.test(upper);
  const wantLight = /-(LF|SC)$/.test(upper);
  if (!wantBlackout && !wantLight) return null;

  if (product === 'Roller') {
    const keys = Object.keys(ROLLER_FABRICS);
    if (wantBlackout) {
      const hit = keys.find((k) => /blackout/i.test(k) && !/cassette/i.test(k));
      if (hit) return hit;
    }
    if (wantLight) {
      const hit = keys.find((k) => /light\s*filtering/i.test(k) && !/cassette/i.test(k));
      if (hit) return hit;
    }
    return null;
  }

  return null;
}

// ─── Core: priceFor ────────────────────────────────────────

export function priceFor(
  product: ProductName,
  fabric: string,
  w: number,
  h: number,
  discountOverridePct: number | null = null,
  cordlessRequested = false,
  cordlessMultiplier = DEFAULT_CORDLESS_MULTIPLIER,
): PriceResult | PriceError {
  const cordless = cordlessRequested && isCordlessEligible(product);

  if (cordless && (w > CORDLESS_MAX_WIDTH || h > CORDLESS_MAX_HEIGHT)) {
    return { error: `Cordless is only available for width and height up to ${CORDLESS_MAX_WIDTH}".` };
  }

  const brackets = BRACKETS[product];
  if (!brackets) return { error: `Unknown product: ${product}` };

  const wIdx = ceilIndex(w, brackets.widths);
  const hIdx = ceilIndex(h, brackets.heights);
  if (wIdx < 0 || hIdx < 0) {
    const maxW = Math.max(...brackets.widths);
    const maxH = Math.max(...brackets.heights);
    return { error: `Out of range (Max W ${maxW}", Max H ${maxH}")` };
  }

  const bracketWidth = brackets.widths[wIdx];
  const bracketHeight = brackets.heights[hIdx];

  // ── Door Screen Sheer (special flat pricing) ──
  if (product === 'Sheer' && fabric === 'Door Screen Sheer') {
    if (h > DOOR_SCREEN_SHEER_RULES.maxHeight) {
      return { error: `Door Screen Sheer height over ${DOOR_SCREEN_SHEER_RULES.maxHeight}" is not configured yet.` };
    }
    const tier = DOOR_SCREEN_SHEER_RULES.tiers.find((t) => w <= t.maxWidth);
    if (!tier) {
      return { error: 'Door Screen Sheer width over 40" is not configured yet.' };
    }
    let msrpVal = tier.msrp;
    const disc =
      typeof discountOverridePct === 'number' && Number.isFinite(discountOverridePct)
        ? discountOverridePct
        : 0;
    let priceVal = msrpVal * (1 - disc);
    const floor = PRICE_FLOOR[product] || 0;
    if (priceVal < floor) priceVal = floor;

    if (cordless) {
      msrpVal *= cordlessMultiplier;
      priceVal *= cordlessMultiplier;
    }
    return {
      msrp: msrpVal,
      discountPct: disc,
      discountValue: Math.max(0, msrpVal - priceVal),
      price: priceVal,
      install: INSTALL_RULES.draperySheerNarrow,
      cordless,
      bracketWidth,
      bracketHeight,
    };
  }

  // ── Roller (separate MSRP tables + cassette surcharge) ──
  if (product === 'Roller') {
    let fCfg = ROLLER_FABRICS[fabric];
    if (!fCfg) {
      const mapped = fallbackFabricKey('Roller', fabric);
      if (mapped) fCfg = ROLLER_FABRICS[mapped];
    }
    if (!fCfg) return { error: 'Pricing for this Roller fabric is not set yet.' };

    const msrpTable = MSRP_ROLLER[fCfg.msrpRef];
    if (!msrpTable) return { error: 'MSRP table not found for Roller.' };

    const baseMsrp = msrpTable[hIdx][wIdx];
    const disc =
      typeof discountOverridePct === 'number' && Number.isFinite(discountOverridePct)
        ? discountOverridePct
        : DEFAULT_DISCOUNTS.Roller;

    const cassetteBump = fCfg.cassette ? (w >= 50 ? 50 : 25) : 0;
    const basePrice = baseMsrp * (1 - disc);
    let price = basePrice + cassetteBump;
    let msrp = baseMsrp + cassetteBump;

    const floor = PRICE_FLOOR.Roller || 0;
    if (price < floor) price = floor;

    if (cordless) {
      msrp *= cordlessMultiplier;
      price *= cordlessMultiplier;
    }

    const install = w > INSTALL_RULES.wideThresholdIn ? INSTALL_RULES.wide : INSTALL_RULES.regular;

    return {
      msrp,
      discountPct: disc,
      discountValue: Math.max(0, msrp - price),
      price,
      install,
      cordless,
      bracketWidth,
      bracketHeight,
    };
  }

  // ── Standard products (Zebra, SHANGRILA, Cellular, Honeycomb, Drapery, Sheer, Shutters) ──
  const msrpTable = getMsrpTable(product, fabric);
  if (!msrpTable) return { error: `Pricing for fabric "${fabric}" under "${product}" is not set yet.` };

  const disc =
    typeof discountOverridePct === 'number' && Number.isFinite(discountOverridePct)
      ? discountOverridePct
      : DEFAULT_DISCOUNTS[product] ?? 0;

  let msrp = msrpTable[hIdx][wIdx];
  let price = msrp * (1 - disc);

  const floor = PRICE_FLOOR[product] || 0;
  if (price < floor) price = floor;

  // Installation
  let install: number;
  if (product === 'Drapery' || product === 'Sheer') {
    install = w > INSTALL_RULES.wideThresholdIn
      ? INSTALL_RULES.draperySheerWide
      : INSTALL_RULES.draperySheerNarrow;
  } else if (product === 'Shutters') {
    const panels = Math.ceil(w / INSTALL_RULES.shuttersPanelWidthIn);
    install = panels * INSTALL_RULES.shutterPerPanel;
  } else {
    install = w > INSTALL_RULES.wideThresholdIn ? INSTALL_RULES.wide : INSTALL_RULES.regular;
  }

  if (cordless) {
    msrp *= cordlessMultiplier;
    price *= cordlessMultiplier;
  }

  return {
    msrp,
    discountPct: disc,
    discountValue: Math.max(0, msrp - price),
    price,
    install,
    cordless,
    bracketWidth,
    bracketHeight,
  };
}

// ─── Quote Total Calculation ───────────────────────────────

export function calculateQuoteTotal(input: QuoteTotalInput): QuoteTotalResult {
  const installMode: InstallMode = input.installMode ?? 'default';
  const deliveryFee = input.deliveryFee ?? DEFAULT_DELIVERY_FEE;
  const taxRate = input.taxRate ?? DEFAULT_TAX_RATE;

  const itemResults: QuoteTotalResult['itemResults'] = [];
  const errors: QuoteTotalResult['errors'] = [];

  let merchSubtotal = 0;
  let installSubtotal = 0;

  input.items.forEach((item, idx) => {
    // Allusion：暂不走 MSRP 表，销售现场手填单价
    if (item.product === 'Allusion') {
      const manual = item.manualPrice;
      if (typeof manual !== 'number' || !Number.isFinite(manual) || manual <= 0) {
        errors.push({
          index: idx,
          input: item,
          error: 'Allusion 需要销售在报价单上手填单价',
        });
        return;
      }
      const install =
        item.widthIn > INSTALL_RULES.wideThresholdIn
          ? INSTALL_RULES.wide
          : INSTALL_RULES.regular;
      const result: PriceResult = {
        msrp: manual,
        discountPct: 0,
        discountValue: 0,
        price: manual,
        install,
        cordless: false,
        bracketWidth: 0,
        bracketHeight: 0,
      };
      const effectiveInstall = installMode === 'pickup' ? 0 : install;
      merchSubtotal += manual;
      installSubtotal += effectiveInstall;
      itemResults.push({ ...result, input: item });
      return;
    }

    const result = priceFor(
      item.product,
      item.fabric,
      item.widthIn,
      item.heightIn,
      item.discountOverridePct ?? null,
      item.cordless ?? false,
    );

    if ('error' in result) {
      errors.push({ index: idx, input: item, error: result.error });
      return;
    }

    const effectiveInstall = installMode === 'pickup' ? 0 : result.install;
    merchSubtotal += result.price;
    installSubtotal += effectiveInstall;

    itemResults.push({ ...result, input: item });
  });

  const addonsSubtotal = input.addons ? calcAddonSubtotal(input.addons) : 0;

  const installApplied =
    installMode === 'pickup'
      ? 0
      : Math.max(installSubtotal, itemResults.length > 0 ? INSTALL_RULES.minimumTotal : 0);

  const preTaxTotal = merchSubtotal + addonsSubtotal + installApplied + deliveryFee;
  const taxAmount = preTaxTotal * taxRate;
  const grandTotal = preTaxTotal + taxAmount;

  return {
    itemResults,
    errors,
    merchSubtotal,
    addonsSubtotal,
    installSubtotal,
    installApplied,
    deliveryFee,
    preTaxTotal,
    taxRate,
    taxAmount,
    grandTotal,
  };
}

// ─── Convenience exports ───────────────────────────────────

export { isCordlessEligible };

export function formatCAD(n: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

export function formatInches(value: number): string {
  const s = Math.round(value * 16);
  const w = Math.floor(s / 16);
  const r = s % 16;
  return r === 0 ? `${w}"` : `${w} ${r}/16"`;
}
