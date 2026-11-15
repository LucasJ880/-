/**
 * MAIL-2 客户来信提醒（OpenSpec change mail-watch；spec mail/inbound-watch）的类型。
 *
 * 配置与游标存 Organization.settingsJson.mailWatch；账本是 AuditLog：
 *   mail.watch.observed（命中的来信，逐封）、mail.watch.run（每轮每个邮箱一条汇总）、
 *   mail.watch.failed（单封失败）、mail.watch.cursor_reset（游标过期重建）、mail.watch.settings（组织开关）。
 * 只有元数据，没有邮件正文。
 */

/** 一位成员的勾选与游标（成员本人勾选时建，取消勾选时整项删除） */
export interface MailWatchMailbox {
  /** 勾选时间（ISO） */
  optedInAt: string;
  /** Gmail 历史位置；null = 还没建立起点（首轮只记起点、不回溯） */
  historyId: string | null;
  /** 上一次成功读取的时间（ISO） */
  lastSyncAt: string | null;
}

export interface MailWatchConfig {
  /** 组织开关（企业管理员开） */
  enabled: boolean;
  /** userId → 该成员的勾选与游标 */
  mailboxes: Record<string, MailWatchMailbox>;
}

/** 归类用的邮件元数据（与 google-email 的 InboxMessageMeta 同形） */
export interface WatchedMessage {
  messageId: string;
  threadId: string;
  labelIds: string[];
  date: string | null;
  from: string;
  subject: string;
  rfcMessageId: string | null;
  replyTo: string;
}

export type MailWatchRule = "customer_mail" | "customer_reply";

export type SkipReason = "not_inbox" | "sent_or_draft" | "spam_or_trash" | "category" | "self" | "inquiry_thread";

/** 客户邮箱索引里的一行（每个组织每轮查一次） */
export interface CustomerRef {
  id: string;
  name: string;
  createdById: string;
  createdAt: Date;
}

export type Classification =
  | { kind: MailWatchRule; customer: CustomerRef }
  | { kind: "unmatched" };

/** 通知收件人的算法：判断点 8 未定前恒为 owner_only；改 B 时只换这个值 */
export type RecipientMode = "owner_only" | "owner_and_customer_owner";

/** mail.watch.observed 的 afterData */
export interface LedgerEntry {
  messageId: string;
  threadId: string;
  /** 发件地址（小写，不含显示名） */
  sender: string;
  /** 单行、至多 120 字 */
  subject: string;
  customerId: string;
  rule: MailWatchRule;
  mailboxUserId: string;
  observedAt: string;
}

/** mail.watch.run 的 afterData：只有计数 */
export interface RunCounts {
  /** 本轮读到的新邮件数 */
  scanned: number;
  customerMail: number;
  customerReply: number;
  unmatched: number;
  skipped: number;
  failed: number;
  /** 账本里已有、重放时跳过的 */
  duplicate: number;
}
