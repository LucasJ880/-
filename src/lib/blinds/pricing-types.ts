export type ProductName =
  | 'Roman Shade'
  | 'Zebra'
  | 'SHANGRILA'
  | 'Cordless Cellular'
  | 'SkylightHoneycomb'
  | 'Roller'
  | 'Drapery'
  | 'Sheer'
  | 'Shutters'
  | 'Allusion'
  | 'Roman'
  | 'Fauxwood';

/**
 * Shades 中不走 MSRP、销售手填单价的产品（与 Order Form 一致）。
 * 2026-10-28 价表起 Allusion 有完整矩阵改为查表（手填价降为可选覆盖），只剩 Roman。
 */
export function isManualPriceShadeProduct(product: ProductName): boolean {
  return product === 'Roman';
}

export type InstallMode = 'default' | 'pickup';

/**
 * 无绳定价策略（2026-10-28 价表；企业可覆盖，见 discount-settings readJsonCordless）。
 * 无绳行：折扣 = 行级覆盖 ?? discount；MSRP 与折后价同乘 multiplier；之后低于 floors[产品] 取最低价。
 */
export interface CordlessPolicy {
  discount: number;
  floors: { Zebra: number; Roller: number };
  multiplier: number;
}

export interface PriceResult {
  msrp: number;
  discountPct: number;
  discountValue: number;
  price: number;
  install: number;
  cordless: boolean;
  bracketWidth: number;
  bracketHeight: number;
}

export interface PriceError {
  error: string;
}

export interface QuoteItemInput {
  product: ProductName;
  fabric: string;
  widthIn: number;
  heightIn: number;
  cordless?: boolean;
  /** Shade Lift=M；服务端按企业 Sunny Motor 设置加价，不信任客户端传入金额。 */
  motorized?: boolean;
  discountOverridePct?: number | null;
  location?: string;
  sku?: string;
  /**
   * 销售手填单价（CAD，税前）。
   * - Roman（非价格表产品）：必填，跳过 priceFor 的 MSRP 查表，直接按 manualPrice 成交。
   * - Allusion（2026-10-28 起查表）：可选的手动成交单价覆盖，有值时成交价取它、MSRP 仍取价表。
   */
  manualPrice?: number;
  /**
   * 褶皱率（1–4；仅 Drapery / Sheer 且非 Door Screen Sheer 生效）：查表宽 = 实际窗宽 × 褶皱率 ÷ 2。
   * 未提供按 2（矩阵本身按 2 倍折算）；非法值整行报错。Order Form / Part A 的 Fullness 180 / 230 → 1.8 / 2.3。
   */
  fullness?: number;
}

export interface QuoteAddonInput {
  addonKey: string;
  qty: number;
}

export interface QuoteTotalInput {
  items: QuoteItemInput[];
  addons?: QuoteAddonInput[];
  installMode?: InstallMode;
  deliveryFee?: number;
  taxRate?: number;
  /** 企业 Sunny Motor 税前单价（CAD）；缺省 150。 */
  sunnyMotorPrice?: number;
  /** 企业最低安装费（CAD）；缺省 INSTALL_RULES.minimumTotal。 */
  minInstallTotal?: number;
  /** 企业无绳策略；缺省 DEFAULT_CORDLESS_POLICY（0.30 / 159 / 129 / ×1.15）。 */
  cordlessPolicy?: CordlessPolicy;
}

export interface QuoteTotalResult {
  itemResults: (PriceResult & { input: QuoteItemInput })[];
  errors: { index: number; input: QuoteItemInput; error: string }[];
  merchSubtotal: number;
  addonsSubtotal: number;
  installSubtotal: number;
  installApplied: number;
  deliveryFee: number;
  preTaxTotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
}

export interface AddonDef {
  key: string;
  displayName: string;
  printLabel: string;
  unitPrice: number;
  eligibleProducts: ProductName[];
}

export interface ProductBrackets {
  widths: number[];
  heights: number[];
}

export interface StandardFabric {
  msrp: number[][];
  discount: number;
}

export interface RollerFabric {
  kind: 'LF' | 'BO';
  cassette: boolean;
  msrpRef: 'LF' | 'BO';
}

export interface DoorScreenSheerFabric {
  special: 'door_screen_sheer';
  discount: number;
}
