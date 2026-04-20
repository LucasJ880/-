import type { ProductName, InstallMode } from "@/lib/blinds/pricing-types";

export type { ProductName, InstallMode };

/**
 * 把整数英寸 + 分数（0-15，单位 1/16）合并为小数英寸
 * 例：fractionToInches("36", "8") → 36.5
 */
export function fractionToInches(whole: string, frac: string): number {
  const w = parseFloat(whole);
  const f = parseFloat(frac);
  const wv = Number.isFinite(w) ? w : 0;
  const fv = Number.isFinite(f) ? f : 0;
  return wv + fv / 16;
}

// ── Part A: Product line with full detail fields ──

export interface PartALine {
  id: string;
  roomName: string;
  product: ProductName | "";
  fabric: string;
  widthIn: number | null;
  heightIn: number | null;
  cordless: boolean;
  panelCount: number;
  // Pricing
  discountOverride: number | null; // user-set override (0-1), null = use default
  msrp: number | null;
  discountPct: number | null;      // actual discount applied (display only)
  discountValue: number | null;
  price: number | null;
  installFee: number | null;
  error: string | null;
  // Product-specific fields
  mount: "I" | "O" | "";           // Shades: Inside/Outside
  lift: "L" | "R" | "M" | "";      // Shades: Left/Right/Motorized
  bracket: "C" | "W" | "";         // Bracket: Ceiling/Wall
  valance: string;                  // Shades: Cassette/Fascia
  // Shutters specific
  frame: string;
  openDirection: string;
  midRail: boolean;
  louverSize: string;
  shutterMaterial: "Wooden" | "Vinyl" | "";
  // Drapes specific
  fullness: "180" | "230";
  panels: "S" | "D";
  pleatStyle: "G" | "P" | "R" | "";
  liner: boolean;
  note: string;
}

// Product category helpers
export type ProductCategory = "shade" | "shutter" | "drape";

export function getProductCategory(product: ProductName | ""): ProductCategory | null {
  switch (product) {
    case "Zebra":
    case "Roller":
    case "SHANGRILA":
    case "Cordless Cellular":
    case "SkylightHoneycomb":
    case "Allusion":
      return "shade";
    case "Shutters":
      return "shutter";
    case "Drapery":
    case "Sheer":
      return "drape";
    default:
      return null;
  }
}

export const PRODUCT_CODE_MAP: Record<string, string> = {
  Zebra: "Z",
  Roller: "R",
  SHANGRILA: "T",
  "Cordless Cellular": "C",
  SkylightHoneycomb: "H",
  Allusion: "A",
  Drapery: "D",
  Sheer: "S",
  Shutters: "V",
};

// Shades 产品代号枚举顺序（Z→R→T→C→H→A）用于 order# 字符串拼接
const SHADE_CODE_ORDER: readonly string[] = ["Z", "R", "T", "C", "H", "A"];

export interface PartBAddon {
  id: string;
  /** 预设品类 key；选 "__custom" 时表示使用 customName 字段 */
  skuItem: string;
  /** 自定义项名称（仅当 skuItem === "__custom" 时有意义） */
  customName?: string;
  qty: number;
  price: number;
  total: number;
}

export type PaymentMethod = "direct" | "finance";

export interface PartCService {
  type: string;
  priceLabel: string;
  unitPrice: number;
  qty: number;
  total: number;
}

export interface PartCAddOn {
  type: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface ShadeOrderLine {
  id: string;
  location: string;
  widthWhole: string;
  widthFrac: string;
  heightWhole: string;
  heightFrac: string;
  product: ProductName;
  sku: string;
  mount: "I" | "O" | "";
  lift: "L" | "R" | "M" | "";
  bracket: "C" | "W" | "";
  valance: string;
  note: string;
  /**
   * 销售手填单价（字符串，便于 input 绑定；CAD，税前）。
   * 仅对 Allusion 等"非价格表"产品有效。
   */
  manualPrice?: string;
}

export interface ShutterOrderLine {
  id: string;
  location: string;
  widthWhole: string;
  widthFrac: string;
  heightWhole: string;
  heightFrac: string;
  frame: string;
  openDirection: string;
  mountType: string;
  /**
   * Mid Rail —— 自由输入（高度/数量/备注等），空串表示无
   * 变更前为 boolean 勾选，现改为字符串以支持描述具体位置/数量
   */
  midRail: string;
  panelCount: number | null;
  draft: string;
}

export interface DrapeOrderLine {
  id: string;
  location: string;
  drapeWidthWhole: string;
  drapeWidthFrac: string;
  drapeHeightWhole: string;
  drapeHeightFrac: string;
  drapeFabricSku: string;
  drapeFullness: "180" | "230";
  drapePanels: "S" | "D";
  drapePleatStyle: "G" | "P" | "R" | "";
  drapeLiner: boolean;
  drapeBracket: "C" | "W" | "";
  sheerWidthWhole: string;
  sheerWidthFrac: string;
  sheerHeightWhole: string;
  sheerHeightFrac: string;
  sheerFabricSku: string;
  sheerFullness: "180" | "230";
  sheerPanels: "S" | "D";
  sheerPleatStyle: "G" | "P" | "R" | "";
  sheerBracket: "C" | "W" | "";
  accessoriesSku: string;
  note: string;
}

export interface QuoteFormState {
  orderNumber: string;
  date: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  heardUsOn: string;
  salesRep: string;
  measureSequence: number;
  partALines: PartALine[];
  partBAddons: PartBAddon[];
  partBNotes: string;
  paymentMethod: PaymentMethod;
  depositAmount: string;
  balanceAmount: string;
  financeEligible: string;
  financeApproved: string;
  financeDifference: string;
  partCServices: PartCService[];
  partCAddOns: PartCAddOn[];
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  drapeOrders: DrapeOrderLine[];
  shutterMaterial: "Wooden" | "Vinyl";
  shutterLouverSize: string;
  shadeValanceType: string;
  shadeBracketType: string;
  installMode: InstallMode;
}

// ── Order number generation ──

const YEAR_CODES: Record<number, string> = {
  2026: "G",
  2027: "H",
  2028: "I",
  2029: "J",
  2030: "K",
};

/**
 * Order# 生成 — 新规则（2026-04 版）
 *
 * 结构：
 *   [YearCode][MMDD]-[CustomerSeq]-[Shades][Shutters][Drapes][PartB][SalesInitial][ShadeSQF]-[ShutterSQF]-[DrapeSQF](P)?
 *
 * 示例：G0418-01-Z3R2V4D2S1M1RM1L67-89-90(P)
 *
 * 段说明：
 * - YearCode：2026=G / 2027=H / ...
 * - MMDD：报价日期 0418
 * - CustomerSeq：当前销售当日接触的「独立客户」序号（同客户同日复用），0 表示未知
 * - Shades：Z/R/T/C/H + 对应窗户行数（**仅计入同时填了宽和高的行**）
 * - Shutters：W/V（由全局 shutterMaterial 决定）+ 所有 panel 总数（**仅计入同时填了宽和高的行**）
 * - Drapes：D + drape 行 panel 数之和（S=1/D=2），S + sheer 行 panel 数之和；**仅计入同时填了宽高的行**
 * - PartB：关键词匹配 addon.skuItem：motor/电机→M；hub→HUB；remote/遥控→RM，后接数量
 * - SalesInitial：销售首字母（大写，最多 2 位）
 * - SQF 三段：Shade-Shutter-Drape；W×H/144 每行 Math.ceil；Drape 加乘 fullness%；
 *            **哪一段为 0 就省略哪一段**（例：shutters 没填 → `L67-90`；全空 → 整段省略）
 * - installMode === "pickup" 末尾加 (P)
 */
export function generateOrderNumber(opts: {
  date: Date;
  customerSeq: number;
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  drapeOrders: DrapeOrderLine[];
  partBAddons: PartBAddon[];
  shutterMaterial: "Wooden" | "Vinyl";
  salesRepInitials: string;
  installMode: InstallMode;
}): string {
  const {
    date,
    customerSeq,
    shadeOrders,
    shutterOrders,
    drapeOrders,
    partBAddons,
    shutterMaterial,
    salesRepInitials,
    installMode,
  } = opts;

  const yearCode = YEAR_CODES[date.getFullYear()] ?? "X";
  const mmdd = `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const seq = customerSeq > 0 ? String(customerSeq).padStart(2, "0") : "??";

  // ── 行是否有有效尺寸（宽 > 0 且 高 > 0 才计入）
  const hasValidDims = (
    wWhole: string,
    wFrac: string,
    hWhole: string,
    hFrac: string,
  ) => fractionToInches(wWhole, wFrac) > 0 && fractionToInches(hWhole, hFrac) > 0;

  // ── Shades：按窗户行数（仅计入同时填了宽高的行）
  const shadeCounts: Record<string, number> = {};
  for (const l of shadeOrders) {
    if (!l.product) continue;
    if (!hasValidDims(l.widthWhole, l.widthFrac, l.heightWhole, l.heightFrac)) continue;
    const code = PRODUCT_CODE_MAP[l.product];
    if (!code || !SHADE_CODE_ORDER.includes(code)) continue;
    shadeCounts[code] = (shadeCounts[code] ?? 0) + 1;
  }
  const shadeStr = SHADE_CODE_ORDER
    .filter((c) => shadeCounts[c])
    .map((c) => `${c}${shadeCounts[c]}`)
    .join("");

  // ── Shutters：panelCount 累加（仅计入同时填了宽高的行）
  const shutterMatCode = shutterMaterial === "Wooden" ? "W" : "V";
  let shutterPanels = 0;
  for (const l of shutterOrders) {
    if (!hasValidDims(l.widthWhole, l.widthFrac, l.heightWhole, l.heightFrac)) continue;
    shutterPanels += Number(l.panelCount) || 0;
  }
  const shutterStr = shutterPanels > 0 ? `${shutterMatCode}${shutterPanels}` : "";

  // ── Drapes：drape 行贡献 D（S=1,D=2），sheer 行贡献 S（S=1,D=2）
  //   仅计入同时填了对应宽高且 SKU 非空的行
  const panelVal = (p: "S" | "D") => (p === "D" ? 2 : 1);
  let drapePanels = 0;
  let sheerPanels = 0;
  for (const l of drapeOrders) {
    if (
      l.drapeFabricSku?.trim() &&
      hasValidDims(l.drapeWidthWhole, l.drapeWidthFrac, l.drapeHeightWhole, l.drapeHeightFrac)
    ) {
      drapePanels += panelVal(l.drapePanels);
    }
    if (
      l.sheerFabricSku?.trim() &&
      hasValidDims(l.sheerWidthWhole, l.sheerWidthFrac, l.sheerHeightWhole, l.sheerHeightFrac)
    ) {
      sheerPanels += panelVal(l.sheerPanels);
    }
  }
  const drapeStr =
    (drapePanels > 0 ? `D${drapePanels}` : "") +
    (sheerPanels > 0 ? `S${sheerPanels}` : "");

  // ── Part B：关键词匹配
  let motorQty = 0;
  let hubQty = 0;
  let remoteQty = 0;
  for (const a of partBAddons) {
    const name = (a.skuItem === "__custom" ? (a.customName || "") : (a.skuItem || "")).toLowerCase();
    const qty = Number(a.qty) || 0;
    if (!name || qty <= 0) continue;
    if (name.includes("motor") || name.includes("电机") || name.includes("管状")) {
      motorQty += qty;
    } else if (name.includes("hub")) {
      hubQty += qty;
    } else if (name.includes("remote") || name.includes("遥控")) {
      remoteQty += qty;
    }
  }
  const partBStr =
    (motorQty > 0 ? `M${motorQty}` : "") +
    (hubQty > 0 ? `HUB${hubQty}` : "") +
    (remoteQty > 0 ? `RM${remoteQty}` : "");

  // ── Sales Initial
  const rep = (salesRepInitials || "").toUpperCase().slice(0, 2);

  // ── SQF（每行 ceil 后累加）
  const ceilArea = (w: number, h: number, mult = 1) =>
    w > 0 && h > 0 ? Math.ceil((w * h * mult) / 144) : 0;

  let sqfShade = 0;
  for (const l of shadeOrders) {
    if (!l.product) continue;
    const w = fractionToInches(l.widthWhole, l.widthFrac);
    const h = fractionToInches(l.heightWhole, l.heightFrac);
    sqfShade += ceilArea(w, h);
  }

  let sqfShutter = 0;
  for (const l of shutterOrders) {
    const w = fractionToInches(l.widthWhole, l.widthFrac);
    const h = fractionToInches(l.heightWhole, l.heightFrac);
    sqfShutter += ceilArea(w, h);
  }

  let sqfDrape = 0;
  for (const l of drapeOrders) {
    if (l.drapeFabricSku?.trim()) {
      const w = fractionToInches(l.drapeWidthWhole, l.drapeWidthFrac);
      const h = fractionToInches(l.drapeHeightWhole, l.drapeHeightFrac);
      const mult = (parseInt(l.drapeFullness, 10) || 180) / 100;
      sqfDrape += ceilArea(w, h, mult);
    }
    if (l.sheerFabricSku?.trim()) {
      const w = fractionToInches(l.sheerWidthWhole, l.sheerWidthFrac);
      const h = fractionToInches(l.sheerHeightWhole, l.sheerHeightFrac);
      const mult = (parseInt(l.sheerFullness, 10) || 180) / 100;
      sqfDrape += ceilArea(w, h, mult);
    }
  }

  // 只显示非 0 的 SQF 段，用 `-` 拼接
  // 例：shade=67, shutter=0, drape=90 → "67-90"
  //     shade=67, shutter=0, drape=0  → "67"
  //     全 0                         → ""
  const sqfSegments = [sqfShade, sqfShutter, sqfDrape].filter((v) => v > 0);
  const sqfStr = sqfSegments.length > 0 ? sqfSegments.join("-") : "";

  const pickup = installMode === "pickup" ? "(P)" : "";

  return `${yearCode}${mmdd}-${seq}-${shadeStr}${shutterStr}${drapeStr}${partBStr}${rep}${sqfStr}${pickup}`;
}

export const INSTALL_PRICES = {
  horizontalSmall: { label: "Install Horizontal Blinds 0-70\"", price: 18 },
  horizontalLarge: { label: "Install Horizontal Blinds 70-180\"", price: 26 },
  verticalSmall: { label: "Install Vertical Blinds 0-70\"", price: 55 },
  verticalLarge: { label: "Install Vertical Blinds 70-180\"", price: 90 },
  shutterPanel: { label: "Install Shutters 0-35\"", price: 18 },
} as const;

export const SERVICE_ADDONS = {
  condoFee: { label: "Condo/Apartments/Commercial", price: 75 },
  removeExisting: { label: "Remove Existing Blinds", price: 15, unit: "/window" },
  bayWindow: { label: "Bay/High Window Installation", price: 75, unit: "/window" },
  oadDelivery: { label: "OAD (Out of Area Delivery/GTA)", price: 1.5, unit: "/km" },
} as const;

export const MIN_INSTALL_CHARGE = 200;
export const DELIVERY_FEE = 50;
export const HST_RATE = 0.13;

export const FRACTION_OPTIONS = [
  { label: "0", value: "0" },
  { label: "1/16", value: "1" },
  { label: "1/8", value: "2" },
  { label: "3/16", value: "3" },
  { label: "1/4", value: "4" },
  { label: "5/16", value: "5" },
  { label: "3/8", value: "6" },
  { label: "7/16", value: "7" },
  { label: "1/2", value: "8" },
  { label: "9/16", value: "9" },
  { label: "5/8", value: "10" },
  { label: "11/16", value: "11" },
  { label: "3/4", value: "12" },
  { label: "13/16", value: "13" },
  { label: "7/8", value: "14" },
  { label: "15/16", value: "15" },
];
