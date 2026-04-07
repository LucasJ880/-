export type ProductName =
  | 'Zebra'
  | 'SHANGRILA'
  | 'Cordless Cellular'
  | 'SkylightHoneycomb'
  | 'Roller'
  | 'Drapery'
  | 'Sheer'
  | 'Shutters';

export type InstallMode = 'default' | 'pickup';

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
  discountOverridePct?: number | null;
  location?: string;
  sku?: string;
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
