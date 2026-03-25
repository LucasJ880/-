import type { Decimal } from "@prisma/client/runtime/library";

// ============================================================
// 供应商询价 — 类型定义与常量
// ============================================================

// --- ProjectInquiry 状态 ---

export const INQUIRY_STATUS = {
  DRAFT: "draft",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELED: "canceled",
} as const;

export type InquiryStatus = (typeof INQUIRY_STATUS)[keyof typeof INQUIRY_STATUS];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  draft: "草稿",
  in_progress: "进行中",
  completed: "已完成",
  canceled: "已取消",
};

// --- InquiryItem 状态 ---

export const ITEM_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  REPLIED: "replied",
  QUOTED: "quoted",
  DECLINED: "declined",
  NO_RESPONSE: "no_response",
} as const;

export type ItemStatus = (typeof ITEM_STATUS)[keyof typeof ITEM_STATUS];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: "待发送",
  sent: "已发送",
  replied: "已回复",
  quoted: "已报价",
  declined: "已拒绝",
  no_response: "未响应",
};

// --- Supplier 状态 ---

export const SUPPLIER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export type SupplierStatus =
  (typeof SUPPLIER_STATUS)[keyof typeof SUPPLIER_STATUS];

// --- 发送方式 ---

export const SENT_VIA = {
  EMAIL: "email",
  PHONE: "phone",
  WECHAT: "wechat",
  OTHER: "other",
} as const;

export type SentVia = (typeof SENT_VIA)[keyof typeof SENT_VIA];

const VALID_SENT_VIA = new Set<string>(Object.values(SENT_VIA));

export function isValidSentVia(v: unknown): v is SentVia {
  return typeof v === "string" && VALID_SENT_VIA.has(v);
}

// --- 输入类型 ---

export interface CreateSupplierInput {
  orgId: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  category?: string;
  region?: string;
  notes?: string;
  brochureUrl?: string;
  brochureParseStatus?: string;
  brochureParseResult?: unknown;
  brochureParseWarning?: string;
}

export interface UpdateSupplierInput {
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  category?: string | null;
  region?: string | null;
  notes?: string | null;
  status?: SupplierStatus;
}

export interface CreateInquiryInput {
  projectId: string;
  title?: string;
  scope?: string;
  dueDate?: string;
}

export interface UpdateInquiryInput {
  title?: string | null;
  scope?: string | null;
  status?: InquiryStatus;
  dueDate?: string | null;
}

export interface AddInquiryItemInput {
  supplierId: string;
  contactNotes?: string;
}

export interface MarkSentInput {
  sentVia: SentVia;
}

export interface RecordQuoteInput {
  unitPrice?: string;
  totalPrice?: string;
  currency?: string;
  deliveryDays?: number;
  validUntil?: string;
  quoteNotes?: string;
}

// --- 报价输入校验 ---

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

function parseNonNegativeDecimal(v: string): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  if (isNaN(n) || n < 0) return null;
  return n;
}

export function validateQuoteInput(input: RecordQuoteInput): string | null {
  const hasUnit = isPresent(input.unitPrice);
  const hasTotal = isPresent(input.totalPrice);
  if (!hasUnit && !hasTotal) {
    return "至少需要填写单价或总价";
  }

  if (hasUnit && parseNonNegativeDecimal(input.unitPrice!) === null) {
    return "单价必须为非负数字";
  }

  if (hasTotal && parseNonNegativeDecimal(input.totalPrice!) === null) {
    return "总价必须为非负数字";
  }

  if (input.deliveryDays !== undefined && input.deliveryDays !== null) {
    if (
      typeof input.deliveryDays !== "number" ||
      !Number.isInteger(input.deliveryDays) ||
      input.deliveryDays < 0
    ) {
      return "交期天数必须为非负整数";
    }
  }

  if (input.validUntil !== undefined && input.validUntil !== null) {
    if (typeof input.validUntil !== "string" || input.validUntil.trim() === "") {
      return "报价有效期日期格式无效";
    }
    const d = new Date(input.validUntil);
    if (isNaN(d.getTime())) return "报价有效期日期格式无效";
  }

  return null;
}

// --- 报价比较视图 ---

export interface QuoteCompareRow {
  itemId: string;
  supplierId: string;
  supplierName: string;
  status: ItemStatus;
  unitPrice: Decimal | null;
  totalPrice: Decimal | null;
  currency: string;
  deliveryDays: number | null;
  validUntil: Date | null;
  quoteNotes: string | null;
  isSelected: boolean;
}

// --- 资源作用域 ---

export interface InquiryScope {
  projectId: string;
  inquiryId: string;
}

export interface ItemScope extends InquiryScope {
  itemId: string;
}
