import {
  INQUIRY_STATUS,
  ITEM_STATUS,
  type InquiryStatus,
  type ItemStatus,
} from "./types";

// ============================================================
// 供应商询价 — 状态机与流转规则
// ============================================================

// --- ProjectInquiry 合法流转 ---

const INQUIRY_TRANSITIONS: Record<InquiryStatus, InquiryStatus[]> = {
  draft: ["in_progress", "canceled"],
  in_progress: ["completed", "canceled"],
  completed: [],
  canceled: [],
};

export function canTransitionInquiry(
  from: InquiryStatus,
  to: InquiryStatus
): boolean {
  return INQUIRY_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- InquiryItem 合法流转 ---

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending: ["sent"],
  sent: ["replied", "declined", "no_response"],
  replied: ["quoted", "declined"],
  quoted: [],
  declined: [],
  no_response: ["sent"],
};

export function canTransitionItem(from: ItemStatus, to: ItemStatus): boolean {
  return ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- 辅助：判断 item 状态是否为终态 ---

const ITEM_TERMINAL: Set<ItemStatus> = new Set([
  ITEM_STATUS.QUOTED,
  ITEM_STATUS.DECLINED,
  ITEM_STATUS.NO_RESPONSE,
]);

export function isItemTerminal(status: ItemStatus): boolean {
  return ITEM_TERMINAL.has(status);
}

// --- 辅助：是否具有有效报价 ---

export function isQuoted(status: ItemStatus): boolean {
  return status === ITEM_STATUS.QUOTED;
}

// --- 检查询价轮是否可以标记完成 ---

export function canCompleteInquiry(itemStatuses: ItemStatus[]): boolean {
  if (itemStatuses.length === 0) return false;
  return itemStatuses.every((s) => ITEM_TERMINAL.has(s));
}

// --- 校验状态值合法性 ---

const ALL_INQUIRY_STATUSES = new Set(Object.values(INQUIRY_STATUS));
const ALL_ITEM_STATUSES = new Set(Object.values(ITEM_STATUS));

export function isValidInquiryStatus(v: string): v is InquiryStatus {
  return ALL_INQUIRY_STATUSES.has(v as InquiryStatus);
}

export function isValidItemStatus(v: string): v is ItemStatus {
  return ALL_ITEM_STATUSES.has(v as ItemStatus);
}
