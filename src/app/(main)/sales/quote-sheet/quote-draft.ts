/**
 * 报价单本地草稿工具（localStorage）
 *
 * 目的：防止页面崩溃、刷新或意外关闭时一张已填半小时的单子全部丢失。
 *
 * 策略：
 *   - 自动保存：页面任何关键字段改动后，debounce 1 秒写入 localStorage
 *   - 自动加载：页面挂载时读草稿，如未过期就提示用户"恢复 / 丢弃"
 *   - 自动清理：成功保存到后端或成功生成报价单后清除草稿
 *   - TTL：24 小时，过期自动丢弃
 *   - 版本号：v1，未来字段变动时旧草稿自动作废
 *
 * 不保存：
 *   - 签名图像（canvas 笔画无法稳定反序列化，客户需要重签）
 *   - 从 API 动态加载的下拉列表（customers、opportunities）
 *   - UI 态（activeTab、saving、generating 等）
 */

import type {
  PartALine,
  PartBAddon,
  PaymentMethod,
  PartCService,
  PartCAddOn,
  ShadeOrderLine,
  ShutterOrderLine,
  DrapeOrderLine,
  InstallMode,
} from "./types";

export const DRAFT_KEY = "qingyan:quote-sheet-draft:v1";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface QuoteDraftV1 {
  v: 1;
  savedAt: number;

  // Customer & Opportunity
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  heardUsOn: string;
  opportunityId: string;

  // Order info
  date: string;
  salesRep: string;
  measureSequence: number;

  // Part A (保留数据结构即可，已从 UI 隐藏)
  partALines: PartALine[];

  // Part B
  partBAddons: PartBAddon[];
  partBNotes: string;
  paymentMethod: PaymentMethod;
  depositAmount: string;
  balanceAmount: string;
  financeEligible: string;
  financeApproved: string;
  financeDifference: string;

  // Part C
  partCServices: PartCService[];
  partCAddOns: PartCAddOn[];

  // Order forms
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  drapeOrders: DrapeOrderLine[];

  // Global options
  shutterMaterial: "Wooden" | "Vinyl";
  shutterLouverSize: string;
  shadeValanceType: string;
  shadeBracketType: string;
  installMode: InstallMode;
}

export function loadDraft(): QuoteDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as QuoteDraftV1;
    if (!d || d.v !== 1 || typeof d.savedAt !== "number") {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    if (Date.now() - d.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Omit<QuoteDraftV1, "v" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const full: QuoteDraftV1 = { v: 1, savedAt: Date.now(), ...draft };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(full));
  } catch {
    // localStorage 满 / 被禁用时静默失败，不影响主流程
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** 判断草稿是否"有实质内容"——避免把刚打开的全空页面也当成草稿提示 */
export function isDraftMeaningful(d: QuoteDraftV1): boolean {
  if (d.customerId || d.customerName.trim() || d.opportunityId) return true;
  if (d.partBAddons.length > 0) return true;
  if (d.shadeOrders.some((l) => l.location || l.sku || l.widthWhole)) return true;
  if (d.shutterOrders.some((l) => l.location || l.widthWhole)) return true;
  if (d.drapeOrders.some((l) => l.location || l.drapeFabricSku || l.sheerFabricSku)) return true;
  return false;
}

/** 友好展示 savedAt，"刚刚 / n 分钟前 / n 小时前" */
export function formatDraftAge(savedAt: number): string {
  const diffMs = Date.now() - savedAt;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return new Date(savedAt).toLocaleString("zh-CN");
}
