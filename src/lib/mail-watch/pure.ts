/**
 * MAIL-2 客户来信提醒 —— 纯函数（spec mail/inbound-watch；change mail-watch）
 *
 * 不访问数据库、不访问 Gmail、不调用模型。这里放：配置的读写形状、三道开关、跳过规则、
 * 发件地址的取法、归类、主题处理、通知与推送文案、收件人、互动与账本的数据形状。
 */

import { maskEmails } from "@/lib/calendar-watch/push-pure";
import { clipText, customerEmailAddresses } from "@/lib/mail-read/pure";
import { MAIL_WATCH_SOURCE_KIND } from "./ui-pure";
import type {
  Classification,
  CustomerRef,
  LedgerEntry,
  MailWatchConfig,
  MailWatchMailbox,
  MailWatchRule,
  RecipientMode,
  RunCounts,
  SkipReason,
  WatchedMessage,
} from "./types";

// ── 常量 ────────────────────────────────────────────────────

export const LEDGER_ACTION = "mail.watch.observed";
export const RUN_ACTION = "mail.watch.run";
export const FAILED_ACTION = "mail.watch.failed";
export const CURSOR_RESET_ACTION = "mail.watch.cursor_reset";
export const SETTINGS_AUDIT_ACTION = "mail.watch.settings";
/** 逐封账本与失败记录的对象类型；targetId = Gmail 邮件 id */
export const LEDGER_TARGET_TYPE = "mail_watch_message";
/** 汇总与游标重建的对象类型；targetId = 邮箱主人的 userId */
export const MAILBOX_TARGET_TYPE = "mail_watch_mailbox";
export const SETTINGS_TARGET_TYPE = "organization_mail_watch";

export const NOTIFICATION_TYPE = "mail_inbound";
export const NOTIFICATION_CATEGORY = "update";
/** 通知点开到客户详情：href.ts 已有 sales_customer 的规则 */
export const NOTIFICATION_ENTITY_TYPE = "sales_customer";
export const SUBJECT_MAX = 120;
/** 时间线标题：固定文字。主题是发信人写的，不放进会被助手工具与 Muse 销售意图取走的标题里 */
export const INTERACTION_SUMMARY = "客户来信（邮件）";
export const EMPTY_SUBJECT = "（无主题）";
/** 销售知识库回填只选 analysisStatus 为空或 pending 的互动；标成这个值它就选不中 */
export const INTERACTION_ANALYSIS_STATUS = "skipped";
/** 缺读信权限的提醒：同一成员这么久之内至多一条 */
export const SCOPE_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 判断点 8 未定前只提醒邮箱主人；改 B 时只换这一个值 */
export const DEFAULT_RECIPIENT_MODE: RecipientMode = "owner_only";

// ── 配置的读写形状 ──────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** 从组织设置里读出来信提醒配置；任何不合形状的地方都按「关 / 没有」处理 */
export function readMailWatch(settingsJson: unknown): MailWatchConfig {
  const root = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson) ? (settingsJson as Record<string, unknown>) : {};
  const raw = root.mailWatch && typeof root.mailWatch === "object" && !Array.isArray(root.mailWatch) ? (root.mailWatch as Record<string, unknown>) : {};
  const boxes = raw.mailboxes && typeof raw.mailboxes === "object" && !Array.isArray(raw.mailboxes) ? (raw.mailboxes as Record<string, unknown>) : {};
  const mailboxes: Record<string, MailWatchMailbox> = {};
  for (const [userId, value] of Object.entries(boxes)) {
    if (!userId || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const optedInAt = str(v.optedInAt);
    if (!optedInAt) continue;
    mailboxes[userId] = { optedInAt, historyId: str(v.historyId), lastSyncAt: str(v.lastSyncAt) };
  }
  return { enabled: raw.enabled === true, mailboxes };
}

/** 把来信提醒配置放回组织设置（其它键原样保留） */
export function withMailWatch(settingsJson: unknown, config: MailWatchConfig): Record<string, unknown> {
  const root = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson) ? (settingsJson as Record<string, unknown>) : {};
  return { ...root, mailWatch: config };
}

/** 组织开关：只改 enabled，不动任何成员的勾选与游标 */
export function setOrgEnabled(config: MailWatchConfig, enabled: boolean): MailWatchConfig {
  return { ...config, enabled };
}

/** 成员勾选：已勾选的保持原样（不重置游标）；新勾选的从「没有起点」开始 */
export function optIn(config: MailWatchConfig, userId: string, now: Date): MailWatchConfig {
  if (config.mailboxes[userId]) return config;
  return { ...config, mailboxes: { ...config.mailboxes, [userId]: { optedInAt: now.toISOString(), historyId: null, lastSyncAt: null } } };
}

/** 取消勾选：整项删除（游标一并删掉） */
export function optOut(config: MailWatchConfig, userId: string): MailWatchConfig {
  if (!config.mailboxes[userId]) return config;
  const rest = { ...config.mailboxes };
  delete rest[userId];
  return { ...config, mailboxes: rest };
}

/** 回写游标：只在该成员仍处于勾选状态时写；已取消勾选 → null（调用方不写） */
export function withCursor(config: MailWatchConfig, userId: string, historyId: string | null, now: Date): MailWatchConfig | null {
  const box = config.mailboxes[userId];
  if (!box) return null;
  return { ...config, mailboxes: { ...config.mailboxes, [userId]: { ...box, historyId, lastSyncAt: now.toISOString() } } };
}

/** 接口对外的视图：不带任何成员的游标与用户 id */
export function publicOrgView(config: MailWatchConfig): { enabled: boolean; optedInCount: number } {
  return { enabled: config.enabled, optedInCount: Object.keys(config.mailboxes).length };
}

// ── 三道开关 ────────────────────────────────────────────────

/** 平台开关 ∧ 组织开关 ∧ 本人勾选，且是该组织的在职成员，才读这个邮箱 */
export function mailboxParticipates(input: { platformEnabled: boolean; orgEnabled: boolean; optedIn: boolean; activeMember: boolean }): boolean {
  return input.platformEnabled === true && input.orgEnabled === true && input.optedIn === true && input.activeMember === true;
}

// ── 跳过规则 ────────────────────────────────────────────────

const CATEGORY_LABELS: ReadonlySet<string> = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]);

/**
 * 不属于客户来信的邮件：不在收件箱、已发送 / 草稿、垃圾 / 已删除、促销 / 社交 / 论坛分类、
 * 发件人就是邮箱主人本人、线程属于在途询价。返回 null = 进入归类。
 */
export function skipReason(input: {
  message: Pick<WatchedMessage, "labelIds" | "threadId" | "from" | "replyTo">;
  ownerEmails: ReadonlyArray<string>;
  inquiryThreadIds: ReadonlySet<string>;
}): SkipReason | null {
  const labels = new Set(input.message.labelIds);
  if (labels.has("SPAM") || labels.has("TRASH")) return "spam_or_trash";
  if (labels.has("SENT") || labels.has("DRAFT")) return "sent_or_draft";
  if (!labels.has("INBOX")) return "not_inbox";
  for (const l of labels) if (CATEGORY_LABELS.has(l)) return "category";
  const sender = senderAddress(input.message);
  if (sender && input.ownerEmails.some((e) => e.trim().toLowerCase() === sender)) return "self";
  if (input.inquiryThreadIds.has(input.message.threadId)) return "inquiry_thread";
  return null;
}

// ── 发件地址 ────────────────────────────────────────────────

const ADDRESS_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/**
 * 发件地址（小写）。本期只取 From 头里的地址，显示名不参与任何匹配。
 * 待确认 E：拿到一封真实的公共地址来信的原始头之后，若发现发件人被转发规则改写，
 * 在这一个函数里按样本补取 Reply-To 或转发头，并补规格场景；别处不用动。
 */
export function senderAddress(message: Pick<WatchedMessage, "from" | "replyTo">): string | null {
  const from = message.from ?? "";
  // 优先取尖括号里的地址（`显示名 <a@b.c>`），显示名里出现的地址不算
  const angled = from.match(/<\s*([^<>\s]+)\s*>\s*$/);
  const candidate = angled ? angled[1] : from;
  const m = candidate.match(ADDRESS_RE);
  return m ? m[0].toLowerCase() : null;
}

// ── 归类 ────────────────────────────────────────────────────

/** 地址 → 客户（一个客户的邮箱字段里可能写了多个地址；多个客户可能共用一个地址） */
export function buildCustomerEmailIndex(rows: ReadonlyArray<CustomerRef & { email: string | null }>): Map<string, CustomerRef[]> {
  const index = new Map<string, CustomerRef[]>();
  for (const row of rows) {
    for (const addr of customerEmailAddresses(row.email)) {
      const list = index.get(addr) ?? [];
      list.push({ id: row.id, name: row.name, createdById: row.createdById, createdAt: row.createdAt });
      index.set(addr, list);
    }
  }
  return index;
}

/** 只在对邮箱主人可见的客户里选：先选主人自己建档的，没有则选最早建档的 */
export function pickCustomer(candidates: ReadonlyArray<CustomerRef>, ownerId: string, isVisible: (c: CustomerRef) => boolean): CustomerRef | null {
  const visible = candidates.filter(isVisible);
  if (visible.length === 0) return null;
  const sorted = [...visible].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return sorted.find((c) => c.createdById === ownerId) ?? sorted[0];
}

/**
 * 查表归类，先中先得：（1）发件地址命中客户档案 → 客户来信；（2）线程里有青砚发出过的邮件 → 客户回信；
 * （3）其余 → 未匹配。不看收件地址，不看显示名，不调模型。客户对邮箱主人不可见视同未命中。
 */
export function classify(input: {
  sender: string | null;
  index: ReadonlyMap<string, CustomerRef[]>;
  /** 同一线程里青砚发出的邮件所属的客户（规则 2 的候选） */
  threadCustomers: ReadonlyArray<CustomerRef>;
  ownerId: string;
  isVisible: (c: CustomerRef) => boolean;
}): Classification {
  if (input.sender) {
    const byEmail = pickCustomer(input.index.get(input.sender) ?? [], input.ownerId, input.isVisible);
    if (byEmail) return { kind: "customer_mail", customer: byEmail };
  }
  const byThread = pickCustomer(input.threadCustomers, input.ownerId, input.isVisible);
  if (byThread) return { kind: "customer_reply", customer: byThread };
  return { kind: "unmatched" };
}

/** 规则 1 没命中、且这封不是线程第一封（线程 id ≠ 邮件 id）时，才需要去取线程成员 */
export function needsThreadLookup(message: Pick<WatchedMessage, "messageId" | "threadId">, rule1Hit: boolean): boolean {
  return !rule1Hit && Boolean(message.threadId) && message.threadId !== message.messageId;
}

// ── 主题与文案 ──────────────────────────────────────────────

/** 主题：去控制字符与换行、压成单行、至多 120 字 */
export function cleanSubject(raw: string | null | undefined): string {
  const single = (raw ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return clipText(single, SUBJECT_MAX).trim();
}

const plainName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "客户";

/** 站内通知：标题只有客户名，摘要只有主题 */
export function notificationDraft(input: { customerName: string; subject: string }): { title: string; summary: string } {
  return { title: `客户来信：${plainName(input.customerName)}`, summary: cleanSubject(input.subject) || EMPTY_SUBJECT };
}

/** 微信推送：标题同通知，正文是打码邮箱之后的主题；不含发件地址与正文 */
export function pushText(input: { customerName: string; subject: string }): { title: string; body: string } {
  const draft = notificationDraft(input);
  return { title: maskEmails(draft.title), body: maskEmails(draft.summary) };
}

/** 通知收件人。owner_only：只有邮箱主人；owner_and_customer_owner：再加客户建档人（去重） */
export function inboundRecipients(input: { mailboxOwnerId: string; customerCreatedById: string | null; mode: RecipientMode }): string[] {
  const out = [input.mailboxOwnerId];
  if (input.mode === "owner_and_customer_owner" && input.customerCreatedById && input.customerCreatedById !== input.mailboxOwnerId) {
    out.push(input.customerCreatedById);
  }
  return out;
}

/** 通知键（唯一约束）：同一封邮件同一收件人至多一条 */
export const notificationSourceKey = (orgId: string, messageId: string, userId: string) => `mail-watch:${orgId}:${messageId}:${userId}`;

/** 重新授权提醒的键前缀：按它与时间窗查 24 小时内有没有提醒过 */
export const scopeReminderPrefix = (orgId: string, userId: string) => `mail-watch-scope:${orgId}:${userId}:`;

// ── 互动与账本的数据形状 ────────────────────────────────────

/** 客户时间线上的入站邮件互动（不挂商机、不进知识库分析、标题不含外部文字） */
export function interactionData(input: { orgId: string; customerId: string; mailboxUserId: string; message: Pick<WatchedMessage, "messageId" | "rfcMessageId" | "subject" | "date"> }) {
  return {
    orgId: input.orgId,
    customerId: input.customerId,
    type: "email",
    direction: "inbound",
    channel: "email",
    summary: INTERACTION_SUMMARY,
    content: `主题：${cleanSubject(input.message.subject) || EMPTY_SUBJECT}`,
    emailMessageId: input.message.messageId,
    analysisStatus: INTERACTION_ANALYSIS_STATUS,
    analysisResult: {
      sourceRef: {
        kind: MAIL_WATCH_SOURCE_KIND,
        rfcMessageId: input.message.rfcMessageId,
        mailboxUserId: input.mailboxUserId,
        // Gmail 记的收信时间（不是发信人写的 Date 头）；时间线的「让助手读这封信」用它写日期
        receivedAt: input.message.date,
      },
    },
    createdById: input.mailboxUserId,
  };
}

export function ledgerEntry(input: {
  message: Pick<WatchedMessage, "messageId" | "threadId" | "subject">;
  sender: string;
  customerId: string;
  rule: MailWatchRule;
  mailboxUserId: string;
  observedAt: Date;
}): LedgerEntry {
  return {
    messageId: input.message.messageId,
    threadId: input.message.threadId,
    sender: input.sender,
    subject: cleanSubject(input.message.subject),
    customerId: input.customerId,
    rule: input.rule,
    mailboxUserId: input.mailboxUserId,
    observedAt: input.observedAt.toISOString(),
  };
}

export const emptyCounts = (): RunCounts => ({ scanned: 0, customerMail: 0, customerReply: 0, unmatched: 0, skipped: 0, failed: 0, duplicate: 0 });

/** 单封失败的错误类别（不含主题与发件人；不把 Gmail 的原始报错文字落库） */
export function failureKind(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = Number(e.code ?? e.status ?? e.response?.status);
  if (Number.isFinite(status) && status >= 400 && status < 600) return `api_error_${status}`;
  return "error";
}
