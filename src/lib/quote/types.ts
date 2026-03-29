/**
 * 报价系统 — 类型定义与常量
 */

// ── 报价单状态 ─────────────────────────────────────────────

export const QUOTE_STATUS = {
  DRAFT: "draft",
  CONFIRMED: "confirmed",
  SENT: "sent",
} as const;

export type QuoteStatus = (typeof QUOTE_STATUS)[keyof typeof QUOTE_STATUS];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "草稿",
  confirmed: "已确认",
  sent: "已发送",
};

// ── 模板类型 ───────────────────────────────────────────────

export const TEMPLATE_TYPES = {
  EXPORT_STANDARD: "export_standard",
  GOV_PROCUREMENT: "gov_procurement",
  PROJECT_INSTALL: "project_install",
  SERVICE_LABOR: "service_labor",
} as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[keyof typeof TEMPLATE_TYPES];

export const TEMPLATE_LABELS: Record<TemplateType, string> = {
  export_standard: "外贸标准报价",
  gov_procurement: "政府采购投标",
  project_install: "项目制安装报价",
  service_labor: "服务/人工单价报价",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  export_standard: "适用于海外客户，含贸易方式、MOQ、原产地等",
  gov_procurement: "适用于政府项目/招标，需编号+单位+数量+单价+总价",
  project_install: "适用于含安装/施工项目，拆分材料费、人工费",
  service_labor: "适用于纯服务/人力项目，按工时计价",
};

// ── 行项目类别 ─────────────────────────────────────────────

export const LINE_CATEGORIES = {
  PRODUCT: "product",
  SHIPPING: "shipping",
  CUSTOMS: "customs",
  PACKAGING: "packaging",
  LABOR: "labor",
  OVERHEAD: "overhead",
  TAX: "tax",
  OTHER: "other",
} as const;

export type LineCategory = (typeof LINE_CATEGORIES)[keyof typeof LINE_CATEGORIES];

export const LINE_CATEGORY_LABELS: Record<LineCategory, string> = {
  product: "产品",
  shipping: "运费",
  customs: "关税",
  packaging: "包装",
  labor: "人工",
  overhead: "管理费",
  tax: "税费",
  other: "其他",
};

// ── 贸易方式 ───────────────────────────────────────────────

export const TRADE_TERMS_OPTIONS = [
  "EXW",
  "FOB",
  "CFR",
  "CIF",
  "DDP",
  "DAP",
] as const;

// ── 币种 ───────────────────────────────────────────────────

export const CURRENCY_OPTIONS = ["CAD", "USD", "CNY", "EUR", "GBP"] as const;

// ── 前端用的报价数据结构 ──────────────────────────────────

export interface QuoteLineItemData {
  id?: string;
  sortOrder: number;
  category: LineCategory;
  itemName: string;
  specification: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  remarks: string;
  costPrice: number | null;
  isInternal: boolean;
}

export interface QuoteHeaderData {
  title: string;
  templateType: TemplateType;
  currency: string;
  tradeTerms: string;
  paymentTerms: string;
  deliveryDays: number | null;
  validUntil: string;
  moq: number | null;
  originCountry: string;
  internalNotes: string;
}

export interface QuoteData extends QuoteHeaderData {
  id?: string;
  projectId: string;
  status: QuoteStatus;
  version: number;
  lineItems: QuoteLineItemData[];
  subtotal: number | null;
  totalAmount: number | null;
  internalCost: number | null;
  profitMargin: number | null;
  aiGenerated: boolean;
}

// ── 输入校验 ───────────────────────────────────────────────

export interface SaveQuoteInput {
  header: QuoteHeaderData;
  lineItems: QuoteLineItemData[];
}
