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
  QuoteTotalInput,
  QuoteTotalResult,
  InstallMode,
  CordlessPolicy,
} from './pricing-types';
import { isManualPriceShadeProduct } from './pricing-types';

import {
  BRACKETS,
  DEFAULT_DISCOUNTS,
  PRICE_FLOOR,
  INSTALL_RULES,
  DEFAULT_DELIVERY_FEE,
  DEFAULT_TAX_RATE,
  DEFAULT_SUNNY_MOTOR_PRICE,
  DEFAULT_CORDLESS_POLICY,
  DEFAULT_FULLNESS,
  FULLNESS_MIN,
  FULLNESS_MAX,
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
  cordlessPolicy: CordlessPolicy = DEFAULT_CORDLESS_POLICY,
  fullnessInput: number | null = null,
): PriceResult | PriceError {
  // 2026-10-28 价表：无绳只对 Zebra / Roller；不再有独立尺寸上限（只受矩阵范围约束）
  const cordless = cordlessRequested && isCordlessEligible(product);

  const brackets = BRACKETS[product];
  if (!brackets) return { error: `Unknown product: ${product}` };

  // 2026-10-28 价表：布帘 / 纱帘（Door Screen Sheer 除外）查表宽 = 实际窗宽 × 褶皱率 ÷ 2
  const fullnessApplied = usesFullness(product, fabric);
  const fullness = fullnessApplied ? (fullnessInput ?? DEFAULT_FULLNESS) : 1;
  if (fullnessApplied && !isValidFullness(fullness)) {
    return { error: `Fullness must be between ${FULLNESS_MIN} and ${FULLNESS_MAX}.` };
  }
  const lookupW = fullnessApplied ? (w * fullness) / 2 : w;

  const wIdx = ceilIndex(lookupW, brackets.widths);
  const hIdx = ceilIndex(h, brackets.heights);
  if (wIdx < 0 || hIdx < 0) {
    const maxH = Math.max(...brackets.heights);
    const maxTableW = Math.max(...brackets.widths);
    if (fullnessApplied) {
      const maxW = Math.round(((maxTableW * 2) / fullness) * 100) / 100;
      return { error: `Out of range at fullness ${fullness}x (Max W ${maxW}", Max H ${maxH}")` };
    }
    return { error: `Out of range (Max W ${maxTableW}", Max H ${maxH}")` };
  }

  const bracketWidth = brackets.widths[wIdx];
  const bracketHeight = brackets.heights[hIdx];
  const override =
    typeof discountOverridePct === 'number' && Number.isFinite(discountOverridePct)
      ? discountOverridePct
      : null;

  // ── Door Screen Sheer (special flat pricing) ──
  if (product === 'Sheer' && fabric === 'Door Screen Sheer') {
    if (h > DOOR_SCREEN_SHEER_RULES.maxHeight) {
      return { error: `Door Screen Sheer height over ${DOOR_SCREEN_SHEER_RULES.maxHeight}" is not configured yet.` };
    }
    const tier = DOOR_SCREEN_SHEER_RULES.tiers.find((t) => w <= t.maxWidth);
    if (!tier) {
      return { error: 'Door Screen Sheer width over 40" is not configured yet.' };
    }
    const disc = override ?? 0;
    const settled = settlePrice(tier.msrp, tier.msrp * (1 - disc), product, cordless, cordlessPolicy);
    return {
      ...settled,
      discountPct: disc,
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
    const disc = override ?? (cordless ? cordlessPolicy.discount : DEFAULT_DISCOUNTS.Roller);

    // 罩盖加价在折扣之后、无绳倍率与最低价之前（与原工具 price() 一致）
    const cassetteBump = fCfg.cassette ? (w >= 50 ? 50 : 25) : 0;
    const settled = settlePrice(
      baseMsrp + cassetteBump,
      baseMsrp * (1 - disc) + cassetteBump,
      product,
      cordless,
      cordlessPolicy,
    );
    const install = w > INSTALL_RULES.wideThresholdIn ? INSTALL_RULES.wide : INSTALL_RULES.regular;

    return { ...settled, discountPct: disc, install, cordless, bracketWidth, bracketHeight };
  }

  // ── Standard products (Zebra, SHANGRILA, Cellular, Honeycomb, Drapery, Sheer, Shutters, Allusion, Fauxwood) ──
  const msrpTable = getMsrpTable(product, fabric);
  if (!msrpTable) return { error: `Pricing for fabric "${fabric}" under "${product}" is not set yet.` };

  const disc = override ?? (cordless ? cordlessPolicy.discount : DEFAULT_DISCOUNTS[product] ?? 0);
  const baseMsrp = msrpTable[hIdx][wIdx];
  const settled = settlePrice(baseMsrp, baseMsrp * (1 - disc), product, cordless, cordlessPolicy);

  // Installation（按实际窗宽，不按褶皱率查表宽）
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

  return { ...settled, discountPct: disc, install, cordless, bracketWidth, bracketHeight };
}

/**
 * 收尾（与原工具 price() 同序）：无绳时 MSRP 与折后价同乘倍率，然后与最低价比较——
 * 无绳用无绳最低价（Zebra 159 / Roller 129），否则用产品最低价。
 */
function settlePrice(
  msrpIn: number,
  priceIn: number,
  product: ProductName,
  cordless: boolean,
  policy: CordlessPolicy,
): { msrp: number; price: number; discountValue: number } {
  let msrp = msrpIn;
  let price = priceIn;
  if (cordless) {
    msrp *= policy.multiplier;
    price *= policy.multiplier;
  }
  const floor = cordless
    ? (product === 'Zebra' ? policy.floors.Zebra : product === 'Roller' ? policy.floors.Roller : 0)
    : PRICE_FLOOR[product] || 0;
  if (price < floor) price = floor;
  return { msrp, price, discountValue: Math.max(0, msrp - price) };
}

/** 褶皱率是否适用：Drapery / Sheer，Door Screen Sheer 除外 */
export function usesFullness(product: ProductName, fabric: string): boolean {
  return (product === 'Drapery' || product === 'Sheer') && fabric !== 'Door Screen Sheer';
}

export function isValidFullness(f: unknown): f is number {
  return typeof f === 'number' && Number.isFinite(f) && f >= FULLNESS_MIN && f <= FULLNESS_MAX;
}

/** Order Form / Part A 的 Fullness（"180" / "230" 百分比字符串）→ 褶皱率（1.8 / 2.3）；无法解析 → null（引擎按默认 2） */
export function fullnessFromPercent(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n) / 100;
}


// ─── Manual selling price override (2026-10-28 价表：Allusion) ─────

/** 允许销售在查表价之上填"手动成交单价"的产品（design D2：本次只对 Allusion 开放） */
export function allowsManualSellingPrice(product: ProductName): boolean {
  return product === 'Allusion';
}

/**
 * 手动成交单价覆盖（纯函数，客户端预览与服务端落库共用）：
 * 有效（> 0 的有限数）时成交价取手填值，MSRP 仍是价表值，折扣额 = max(0, MSRP − 手填值)，
 * discountPct 保持查表折扣；无效或未填时原样返回查表结果。
 */
export function applyManualSellingPrice(result: PriceResult, manualPrice: unknown): PriceResult {
  if (typeof manualPrice !== 'number' || !Number.isFinite(manualPrice) || manualPrice <= 0) {
    return result;
  }
  return {
    ...result,
    price: manualPrice,
    discountValue: Math.max(0, result.msrp - manualPrice),
  };
}

// ─── Quote Total Calculation ───────────────────────────────

export function calculateQuoteTotal(input: QuoteTotalInput): QuoteTotalResult {
  const installMode: InstallMode = input.installMode ?? 'default';
  // 入参为运费费率（企业设置/请求覆盖）；是否收取由 installMode 与有效行数决定
  const deliveryRate = input.deliveryFee ?? DEFAULT_DELIVERY_FEE;
  const taxRate = input.taxRate ?? DEFAULT_TAX_RATE;
  const cordlessPolicy = input.cordlessPolicy ?? DEFAULT_CORDLESS_POLICY;
  const sunnyMotorPrice =
    typeof input.sunnyMotorPrice === 'number' &&
    Number.isFinite(input.sunnyMotorPrice) &&
    input.sunnyMotorPrice >= 0
      ? input.sunnyMotorPrice
      : DEFAULT_SUNNY_MOTOR_PRICE;

  const itemResults: QuoteTotalResult['itemResults'] = [];
  const errors: QuoteTotalResult['errors'] = [];

  let merchSubtotal = 0;
  let installSubtotal = 0;

  input.items.forEach((item, idx) => {
    // Roman：暂不走 MSRP 表，销售现场手填单价（Allusion 自 2026-10-28 价表起查表，见下方覆盖）
    if (isManualPriceShadeProduct(item.product)) {
      const manual = item.manualPrice;
      if (typeof manual !== 'number' || !Number.isFinite(manual) || manual <= 0) {
        errors.push({
          index: idx,
          input: item,
          error: `${item.product} 需要销售在报价单上手填单价`,
        });
        return;
      }
      const install =
        item.widthIn > INSTALL_RULES.wideThresholdIn
          ? INSTALL_RULES.wide
          : INSTALL_RULES.regular;
      const motorSurcharge = item.motorized ? sunnyMotorPrice : 0;
      const result: PriceResult = {
        msrp: manual + motorSurcharge,
        discountPct: 0,
        discountValue: 0,
        price: manual + motorSurcharge,
        install,
        cordless: false,
        bracketWidth: 0,
        bracketHeight: 0,
      };
      const effectiveInstall = installMode === 'pickup' ? 0 : install;
      merchSubtotal += result.price;
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
      cordlessPolicy,
      typeof item.fullness === 'number' ? item.fullness : null,
    );

    if ('error' in result) {
      errors.push({ index: idx, input: item, error: result.error });
      return;
    }

    // Allusion：可选手动成交单价覆盖（查表价之上）
    const tableResult = allowsManualSellingPrice(item.product)
      ? applyManualSellingPrice(result, item.manualPrice)
      : result;

    const motorSurcharge = item.motorized ? sunnyMotorPrice : 0;
    const pricedResult: PriceResult = motorSurcharge
      ? {
          ...tableResult,
          msrp: tableResult.msrp + motorSurcharge,
          price: tableResult.price + motorSurcharge,
        }
      : tableResult;
    const effectiveInstall = installMode === 'pickup' ? 0 : pricedResult.install;
    merchSubtotal += pricedResult.price;
    installSubtotal += effectiveInstall;

    itemResults.push({ ...pricedResult, input: item });
  });

  const addonsSubtotal = input.addons ? calcAddonSubtotal(input.addons) : 0;

  const minInstallTotal =
    typeof input.minInstallTotal === 'number' &&
    Number.isFinite(input.minInstallTotal) &&
    input.minInstallTotal >= 0
      ? input.minInstallTotal
      : INSTALL_RULES.minimumTotal;
  const installApplied =
    installMode === 'pickup'
      ? 0
      : Math.max(installSubtotal, itemResults.length > 0 ? minInstallTotal : 0);

  // pickup 自提或没有任何有效行时不收运费
  const deliveryFee =
    installMode === 'pickup' || itemResults.length === 0 ? 0 : deliveryRate;

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
