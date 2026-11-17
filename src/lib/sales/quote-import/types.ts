/**
 * 报价工具导出文件（`.sunny-quote.json`）的最小类型（QUOTE-1b，openspec change quote-import-studio-file，design D1 / D2）
 *
 * 这里只描述青砚会读的那部分。文件里其余内容（窗户照片、试装图、面料资料、展示开关等）不进这些类型——
 * 校验时只把认识的键拷进新对象，其余读到即丢（design D11）。
 * 字段结构的依据见 design D2「核对结果」。
 */
import type { ProductName } from "@/lib/blinds/pricing-types";

export const QUOTE_FILE_FORMAT = "sunny-quote-studio";
export const QUOTE_FILE_VERSION = 1;
/** 与工具自身的导入上限相同 */
export const MAX_FILE_BYTES = 35 * 1024 * 1024;
export const MAX_FILE_ITEMS = 500;
export const MAX_FILE_ADDONS = 200;
/** `plans[]` 最多读几套（工具目前最多两三套；多出来的不读） */
export const MAX_FILE_PLANS = 10;
/** 数量拆行后表单行的上限 */
export const MAX_FORM_ROWS = 500;

/** 工具与青砚共有的 11 个品类（青砚另有手填价的 Roman，工具没有） */
export const FILE_PRODUCTS = [
  "Roman Shade",
  "Zebra",
  "SHANGRILA",
  "Cordless Cellular",
  "SkylightHoneycomb",
  "Roller",
  "Drapery",
  "Sheer",
  "Shutters",
  "Fauxwood",
  "Allusion",
] as const satisfies readonly ProductName[];
export type FileProduct = (typeof FILE_PRODUCTS)[number];

export function isFileProduct(v: unknown): v is FileProduct {
  return typeof v === "string" && (FILE_PRODUCTS as readonly string[]).includes(v);
}

/** 文件里的一行。数字字段不是有限数时为 null；「填了但不是数」的字段名记在 invalid 里，映射时阻断，不静默丢 */
export interface FileItem {
  product: FileProduct;
  fabric: string;
  w: number | null;
  h: number | null;
  qty: number | null;
  room: string;
  sku: string;
  cordless: boolean;
  /** 成交单价；未填为 null */
  offer: number | null;
  /** 行级折扣 0–1；未填为 null */
  discountOverridePct: number | null;
  /** 褶皱率；未填为 null（按文件默认 / 工具默认 2） */
  fullness: number | null;
  note: string;
  invalid: string[];
}

export interface FileAddon {
  name: string;
  qty: number | null;
  price: number | null;
  unit: string;
  note: string;
}

/** 一套方案：自己的行、附加项目、备注与费用开关 */
export interface FilePlan {
  /** 方案编号（A / B …）；单方案文件没有，为空串 */
  planId: string;
  planName: string;
  /** 是不是导出时的当前方案（文件顶层那一套） */
  isActive: boolean;
  items: FileItem[];
  addons: FileAddon[];
  note: string;
  install: boolean;
  delivery: boolean;
  downtown: boolean;
  deliveryAmount: number | null;
  downtownAmount: number | null;
}

export interface FileProductPricing {
  widths: number[];
  heights: number[];
  /** 面料档 → MSRP 矩阵（[高档][宽档]）；Roller 经 msrpRef 指向 rollerTables */
  fabrics: Record<string, { msrp: number[][] | null; msrpRef: string | null; cassette: boolean; special: string | null }>;
  rollerTables: Record<string, number[][]>;
}

/** 文件自带的价表与计价参数（净化后的副本；任何一项形状不对就整体为 null，按「价表不一致」处理） */
export interface FilePricing {
  version: string;
  tax: number | null;
  discounts: Partial<Record<FileProduct, number>>;
  floors: Partial<Record<FileProduct, number>>;
  cordlessDiscount: number | null;
  cordlessMultiplier: number | null;
  cordlessFloors: { Zebra: number | null; Roller: number | null };
  /** 行上没填褶皱率时的默认值 */
  fullness: { Drapery: number | null; Sheer: number | null };
  /** 安装费标准（regular / wide_threshold_in / wide / drapery_regular / drapery_wide / shutter_panel_width_in / shutter_panel_price / minimum_total） */
  install: Record<string, number>;
  products: Partial<Record<FileProduct, FileProductPricing>>;
}

export interface ParsedQuoteFile {
  fileVersion: number;
  exportedAt: string;
  quoteId: string;
  quoteNumber: string;
  customer: { name: string; phone: string; email: string; address: string };
  pricing: FilePricing | null;
  /** 按方案编号排序；单方案文件只有一项 */
  plans: FilePlan[];
  /** 文件里的窗户照片张数（按窗位去重）；照片本身不读入 */
  photoCount: number;
}

export type ParseQuoteFileResult =
  | { ok: true; file: ParsedQuoteFile }
  | { ok: false; code: string; reasonZh: string };

/** 核对窗的提示：阻断（不能填入表单）/ 提醒（可继续） */
export interface ImportHint {
  level: "block" | "warn";
  code: string;
  /** 文件里的第几行（从 1 起）；整单级提示没有 */
  rowIndex?: number;
  messageZh: string;
}
