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
  /** 这轮询价写进 RFQ 的贸易条款（P1-8：批准发出后学习为操作者的默认值） */
  incoterm?: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null;
};

export const TENDER_SEND_CHASE_TYPE = "tender.send_chase" as const;

/**
 * PendingAction.payload（type=tender.send_chase，P1-7）：一个 item 一封——审批人可以只催其中一家。
 * 批准后作为原询价 Gmail 线程的回复发出（threadId + In-Reply-To / References）。
 */
export type TenderSendChasePayload = {
  projectId: string;
  inquiryId: string;
  inquiryItemId: string;
  supplierName: string;
  to: string;
  /** no_reply = 超期未回的催单；missing_fields = 报价缺字段的追问 */
  kind: "no_reply" | "missing_fields";
  /** 第几次（missing_fields 固定 1） */
  chaseIndex: 1 | 2;
  threadId: string;
  originalSubject: string;
  subject: string;
  body: string;
  fromName: string;
  fromEmail: string;
  /** 防篡改：执行时重算，与审批时不一致 → 拒绝（同 P1-3 rfqDocHash） */
  bodyHash: string;
};

/**
 * 组织级 RFQ 设置（零 schema：Organization.settingsJson.tenderRfq）
 * 缺省回退到环境变量 TENDER_RFQ_FROM_NAME / TENDER_RFQ_FROM_EMAIL。
 */
export type TenderRfqOrgSettings = {
  fromName: string | null;
  /** 显示的发件地址（From / Reply-To），如 project@ */
  fromEmail: string | null;
  /** 实际授权 Gmail 的账号（查 EmailProvider / 读回信用），如 lucas@；缺省 = fromEmail */
  mailboxEmail: string | null;
  /** 回复截止提前量（天） */
  replyLeadDays: number | null;
  /** 同一项目两轮询价之间的最短间隔（天）；期间再发 → 轮次锁 */
  roundLockDays: number | null;
  /** 超过几天没回就起草催单（P1-7；项目 owner 的个人偏好优先） */
  chaseAfterDays: number | null;
};

/** 读取后已回退到默认值的设置（无 null） */
export type ResolvedTenderRfqSettings = { fromName: string; fromEmail: string; mailboxEmail: string; replyLeadDays: number; roundLockDays: number };

export const TENDER_RFQ_DEFAULTS = {
  fromName: "Qyan-Sunny Purchasing",
  fromEmail: "project@sunnyshutter.ca",
  replyLeadDays: 7,
  roundLockDays: 3,
} as const;
