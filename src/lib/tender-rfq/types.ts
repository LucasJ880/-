/**
 * Tender RFQ（P1-2 / P1-3）— 类型
 */

export const TENDER_SEND_RFQ_TYPE = "tender.send_rfq" as const;

/** 一封待发的询价邮件（审批卡预览 = 这个数组） */
export type TenderRfqEmailItem = {
  inquiryItemId: string;
  supplierId: string;
  supplierName: string;
  to: string;
  subject: string;
  body: string;
};

/** PendingAction.payload（type=tender.send_rfq） */
export type TenderSendRfqPayload = {
  projectId: string;
  inquiryId: string;
  roundNumber: number;
  /** 发件抬头与邮箱在准备阶段就固定进 payload，审批时看到的就是执行时用的 */
  fromName: string;
  fromEmail: string;
  items: TenderRfqEmailItem[];
  /** RFQ 文档内容 hash（sha256 前 16 位），用于审计/防篡改 */
  rfqDocHash: string;
};

/**
 * 组织级 RFQ 设置（零 schema：Organization.settingsJson.tenderRfq）
 * 缺省回退到环境变量 TENDER_RFQ_FROM_NAME / TENDER_RFQ_FROM_EMAIL。
 */
export type TenderRfqOrgSettings = {
  fromName: string | null;
  fromEmail: string | null;
  /** 回复截止提前量（天） */
  replyLeadDays: number | null;
  /** 同一项目两轮询价之间的最短间隔（天）；期间再发 → 轮次锁 */
  roundLockDays: number | null;
};

/** 读取后已回退到默认值的设置（无 null） */
export type ResolvedTenderRfqSettings = { fromName: string; fromEmail: string; replyLeadDays: number; roundLockDays: number };

export const TENDER_RFQ_DEFAULTS = {
  fromName: "Qyan-Sunny Purchasing",
  fromEmail: "project@sunnyshutter.ca",
  replyLeadDays: 7,
  roundLockDays: 3,
} as const;
