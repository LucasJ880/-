import type { ProductName } from "@/lib/blinds/pricing-types";

export type { ProductName };

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
  // Pricing (auto-calculated)
  msrp: number | null;
  discountPct: number | null;
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
  SHANGRILA: "Z",
  "Cordless Cellular": "Z",
  SkylightHoneycomb: "Z",
  Drapery: "D",
  Sheer: "S",
  Shutters: "V",
};

export interface PartBAddon {
  id: string;
  skuItem: string;
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
  sku: string;
  mount: "I" | "O" | "";
  lift: "L" | "R" | "M" | "";
  bracket: "C" | "W" | "";
  valance: string;
  note: string;
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
  midRail: boolean;
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
}

// ── Order number generation ──

const YEAR_CODES: Record<number, string> = {
  2026: "G",
  2027: "H",
  2028: "I",
  2029: "J",
  2030: "K",
};

export function generateOrderNumber(opts: {
  date: Date;
  measureSequence: number;
  lines: PartALine[];
  salesRepInitials: string;
}): string {
  const { date, measureSequence, lines, salesRepInitials } = opts;
  const yearCode = YEAR_CODES[date.getFullYear()] ?? "X";
  const mmdd = `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const seq = String(measureSequence).padStart(2, "0");

  const filled = lines.filter((l) => l.product && l.price);

  // Count by product code
  const codeCounts: Record<string, number> = {};
  for (const l of filled) {
    const code = PRODUCT_CODE_MAP[l.product] ?? "X";
    codeCounts[code] = (codeCounts[code] ?? 0) + l.panelCount;
  }

  // Build product string: Z3R4 etc
  const productStr = Object.entries(codeCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `${code}${count}`)
    .join("");

  // SQF calculation — group products
  const sqfShade = filled
    .filter((l) => ["Zebra", "Roller", "SHANGRILA", "Cordless Cellular", "SkylightHoneycomb"].includes(l.product))
    .reduce((sum, l) => sum + ((l.widthIn ?? 0) * (l.heightIn ?? 0) * l.panelCount) / 144, 0);
  const sqfDrape = filled
    .filter((l) => ["Drapery", "Sheer"].includes(l.product))
    .reduce((sum, l) => sum + ((l.widthIn ?? 0) * (l.heightIn ?? 0) * l.panelCount) / 144, 0);
  const sqfShutter = filled
    .filter((l) => l.product === "Shutters")
    .reduce((sum, l) => sum + ((l.widthIn ?? 0) * (l.heightIn ?? 0) * l.panelCount) / 144, 0);
  const totalSqf = Math.round(sqfShade + sqfDrape + sqfShutter);

  const rep = salesRepInitials.toUpperCase().slice(0, 2);
  return `${yearCode}${mmdd}-${seq}-${productStr}${rep}${totalSqf || ""}`;
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
