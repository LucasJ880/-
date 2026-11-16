/**
 * MAIL-2 客户来信提醒 —— 编排（sales-actions 定时任务的 mail-watch 步骤；spec mail/inbound-watch）
 *
 * 每个已勾选的邮箱：读游标 → 收件箱增量（只取元数据）→ 跳过 / 查表归类 → 命中的：
 *   查账本 → 通知 → 微信 → 客户时间线互动 → 写账本；每个邮箱一条汇总；锁内确认仍勾选后回写游标。
 *
 * 边界：
 *   - 只用被观察成员本人绑定的 Gmail 授权；不读组织授权邮箱。
 *   - 不取、不存、不推邮件正文；未匹配与被跳过的信不逐封留痕，只在汇总里计数。
 *   - 不调模型；不发 Muse 事件；不建 PendingAction（发给本组织成员本人，不算出站）。
 *   - 不是队列：没有认领、没有重试；游标只前进到已处理完的位置。
 *
 * 外部依赖（Gmail 读取、时钟、微信推送、截止时刻）可注入，隔离库测试不连 Google。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { MAX_WECHAT_PUSHES_PER_RUN } from "@/lib/calendar-watch/push-pure";
import { NonProdSideEffectDisabledError, isMailWatchAllowed } from "@/lib/env/runtime-isolation";
import {
  INBOX_ADDITIONS_MAX,
  MailboxReadError,
  getEmailProvider,
  getInboxMessageMeta,
  listInboxAdditions,
  listThreadMessages,
  type InboxAdditions,
  type InboxMessageMeta,
  type ThreadReplyRef,
} from "@/lib/google-email";
import { classifyGmailError } from "@/lib/mail-read/pure";
import { createNotification } from "@/lib/notifications/create";
import { mutateOrgSettings } from "@/lib/organizations/settings-write";
import { canSeeResource } from "@/lib/rbac/data-scope";
import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { parseRfqThreadId } from "@/lib/tender-rfq/inbound-contract";
import {
  CURSOR_RESET_ACTION,
  DEFAULT_RECIPIENT_MODE,
  FAILED_ACTION,
  LEDGER_ACTION,
  LEDGER_TARGET_TYPE,
  MAILBOX_TARGET_TYPE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_ENTITY_TYPE,
  NOTIFICATION_TYPE,
  RUN_ACTION,
  SCOPE_REMINDER_WINDOW_MS,
  buildCustomerEmailIndex,
  classify,
  emptyCounts,
  failureKind,
  inboundRecipients,
  interactionData,
  ledgerEntry,
  mailboxParticipates,
  needsThreadLookup,
  notificationDraft,
  notificationSourceKey,
  pushText,
  readMailWatch,
  scopeReminderPrefix,
  senderAddress,
  skipReason,
  withCursor,
  withMailWatch,
} from "./pure";
import { MAIL_WATCH_SOURCE_KIND } from "./ui-pure";
import type { CustomerRef, MailWatchConfig, RecipientMode, RunCounts } from "./types";

/** 在途询价的时间窗：与询价回信入站一致（已发出 90 天内） */
const OPEN_INQUIRY_WINDOW_DAYS = 90;
const OPEN_INQUIRY_STATUSES = ["sent", "replied", "quoted", "no_response"];
const DEFAULT_BUDGET_MS = 200_000;
/**
 * 定时任务里本步骤的截止时刻：从请求开始算 265 秒。
 * 排在日历观察（240 秒）之后、未读升级邮件（285 秒）之前；整个请求 maxDuration = 300 秒。
 */
export const MAIL_WATCH_DEADLINE_MS = 265_000;

/** 销售域微信推送（缺省 pushSalesReminder） */
export type PushWechat = (userId: string, title: string, content: string) => Promise<{ sent: number; failed: number }>;

/** 测试用：模拟「运行在某一步被打断」（进程退出）。不会被单封失败的收错吃掉，游标也不会回写 */
export class MailWatchInterrupted extends Error {
  constructor(message = "interrupted") {
    super(message);
    this.name = "MailWatchInterrupted";
  }
}

export interface MailWatchDeps {
  listAdditions?: (userId: string, opts: { sinceHistoryId: string | null; maxMessages: number }) => Promise<InboxAdditions>;
  getMeta?: (userId: string, messageId: string) => Promise<InboxMessageMeta>;
  listThread?: (userId: string, threadId: string) => Promise<ThreadReplyRef[]>;
  pushWechat?: PushWechat;
  /** 每轮微信推送上限（测试用）；缺省与日历变更推送相同（30） */
  maxWechatPushes?: number;
  now?: () => Date;
  /** 只处理这些组织（测试用）；缺省为全部开了组织开关的组织 */
  orgIds?: string[];
  /** 超过此时刻不再开始读新的邮箱（定时任务共 300 秒，与其它步骤共享） */
  deadline?: Date;
  /** 平台开关（测试用）；缺省读 MAIL_WATCH_ENABLED */
  platformEnabled?: boolean;
  /** 通知收件人的算法；缺省只提醒邮箱主人（判断点 8 取 A，2026-11-15 拍板） */
  recipientMode?: RecipientMode;
  /** 测试钩子：某封命中的信建好通知与互动之后、写账本之前 */
  beforeLedger?: (messageId: string) => void | Promise<void>;
  /** 测试钩子：一个邮箱处理完、回写游标之前 */
  beforeSaveCursor?: (userId: string) => void | Promise<void>;
}

export interface MailboxRunResult {
  userId: string;
  counts: RunCounts;
  notified: number;
  wechatSent: number;
  wechatFailed: number;
  /** 非生产环境禁用微信外发 */
  wechatSkipped: number;
  /** 超过每轮上限或过了截止时刻，没推 */
  wechatCapped: number;
  /** 首次勾选只记了起点 */
  bootstrapped: boolean;
  cursorReset: boolean;
  /** 达到每轮上限，其余留到下一轮 */
  hasMore: boolean;
  /** 没读这个邮箱的原因：缺授权（已按 24 小时一次提醒）或过了截止时刻 */
  skipped: "no_read_access" | "deadline" | null;
  reminded: boolean;
  error: string | null;
}

export interface MailWatchRunSummary {
  /** 整个步骤没有运行的原因 */
  skipped: "platform_disabled" | "no_mailboxes" | null;
  organizations: number;
  mailboxes: number;
  /** 因截止时刻没处理的邮箱数 */
  deadlineSkipped: number;
  failedCount: number;
  scanned: number;
  matched: number;
  unmatched: number;
  notified: number;
  wechatSent: number;
  wechatFailed: number;
  wechatSkipped: number;
  wechatCapped: number;
  results: Array<{ orgId: string; mailboxes: MailboxRunResult[]; error: string | null }>;
}

interface PushContext {
  push: PushWechat;
  remaining: number;
  deadline: Date;
}

interface OrgContext {
  orgId: string;
  config: MailWatchConfig;
  /** 小写地址 → 客户（未归档） */
  index: Map<string, CustomerRef[]>;
  customersById: Map<string, CustomerRef>;
  inquiryThreadIds: Set<string>;
}

interface Resolved {
  listAdditions: NonNullable<MailWatchDeps["listAdditions"]>;
  getMeta: NonNullable<MailWatchDeps["getMeta"]>;
  listThread: NonNullable<MailWatchDeps["listThread"]>;
  now: Date;
  deadline: Date;
  push: PushContext;
  recipientMode: RecipientMode;
  beforeLedger?: MailWatchDeps["beforeLedger"];
  beforeSaveCursor?: MailWatchDeps["beforeSaveCursor"];
}

const emptyMailboxResult = (userId: string): MailboxRunResult => ({
  userId,
  counts: emptyCounts(),
  notified: 0,
  wechatSent: 0,
  wechatFailed: 0,
  wechatSkipped: 0,
  wechatCapped: 0,
  bootstrapped: false,
  cursorReset: false,
  hasMore: false,
  skipped: null,
  reminded: false,
  error: null,
});

/** 一次准备组织级上下文：客户邮箱索引（未归档）与在途询价的线程集合 */
async function prepareOrg(orgId: string, config: MailWatchConfig, now: Date): Promise<OrgContext> {
  const [customers, inquiryItems] = await Promise.all([
    db.salesCustomer.findMany({
      where: { orgId, archivedAt: null, email: { not: null } },
      select: { id: true, name: true, email: true, createdById: true, createdAt: true },
    }),
    db.inquiryItem.findMany({
      where: {
        status: { in: OPEN_INQUIRY_STATUSES },
        contactNotes: { contains: "threadId=" },
        sentAt: { gte: new Date(now.getTime() - OPEN_INQUIRY_WINDOW_DAYS * 86_400_000) },
        inquiry: { project: { orgId } },
      },
      select: { contactNotes: true },
    }),
  ]);
  const inquiryThreadIds = new Set<string>();
  for (const item of inquiryItems) {
    const threadId = parseRfqThreadId(item.contactNotes);
    if (threadId) inquiryThreadIds.add(threadId);
  }
  const customersById = new Map<string, CustomerRef>();
  for (const c of customers) customersById.set(c.id, { id: c.id, name: c.name, createdById: c.createdById, createdAt: c.createdAt });
  return { orgId, config, index: buildCustomerEmailIndex(customers), customersById, inquiryThreadIds };
}

/** 规则 2 的候选：同一线程里青砚发出过的邮件（客户互动里记着它的 Gmail 邮件 id）所属的客户 */
async function threadCustomers(org: OrgContext, threadMessageIds: string[], selfId: string): Promise<CustomerRef[]> {
  const others = threadMessageIds.filter((id) => id !== selfId);
  if (others.length === 0) return [];
  const rows = await db.customerInteraction.findMany({
    where: { orgId: org.orgId, direction: "outbound", emailMessageId: { in: others } },
    select: { customerId: true },
  });
  const out: CustomerRef[] = [];
  for (const id of new Set(rows.map((r) => r.customerId))) {
    const c = org.customersById.get(id);
    if (c) out.push(c);
  }
  return out;
}

async function pushWechatSafe(ctx: PushContext, userId: string, text: { title: string; body: string }, result: MailboxRunResult): Promise<void> {
  if (ctx.remaining <= 0 || Date.now() > ctx.deadline.getTime()) {
    result.wechatCapped += 1;
    return;
  }
  ctx.remaining -= 1;
  try {
    const r = await ctx.push(userId, text.title, text.body);
    result.wechatSent += r.sent;
    result.wechatFailed += r.failed;
  } catch (err) {
    if (err instanceof NonProdSideEffectDisabledError) {
      result.wechatSkipped += 1;
      return;
    }
    result.wechatFailed += 1;
    // 只记错误类别：不把主题、客户名打进日志
    console.error("[mail-watch] wechat push failed:", err instanceof Error ? err.name : "error");
  }
}

/** 同一封信、同一客户的互动是否已经有了：先按 Message-ID（另一个邮箱先记的），再按本邮箱的 Gmail 邮件 id */
async function interactionExists(orgId: string, customerId: string, mailboxUserId: string, meta: InboxMessageMeta): Promise<boolean> {
  if (meta.rfcMessageId) {
    const byRfc = await db.customerInteraction.findFirst({
      where: {
        orgId,
        customerId,
        direction: "inbound",
        analysisResult: { path: ["sourceRef", "rfcMessageId"], equals: meta.rfcMessageId },
      },
      select: { id: true },
    });
    if (byRfc) return true;
  }
  const byGmailId = await db.customerInteraction.findFirst({
    where: {
      orgId,
      customerId,
      direction: "inbound",
      emailMessageId: meta.messageId,
      createdById: mailboxUserId,
      analysisResult: { path: ["sourceRef", "kind"], equals: MAIL_WATCH_SOURCE_KIND },
    },
    select: { id: true },
  });
  return Boolean(byGmailId);
}

/** 处理一封命中的来信：通知 → 微信 → 互动 → 账本。每一步都可重入 */
async function recordMatch(input: {
  org: OrgContext;
  ownerId: string;
  meta: InboxMessageMeta;
  sender: string;
  customer: CustomerRef;
  rule: "customer_mail" | "customer_reply";
  r: Resolved;
  result: MailboxRunResult;
}): Promise<void> {
  const { org, ownerId, meta, sender, customer, rule, r, result } = input;
  const draft = notificationDraft({ customerName: customer.name, subject: meta.subject });
  const text = pushText({ customerName: customer.name, subject: meta.subject });
  const recipients = inboundRecipients({ mailboxOwnerId: ownerId, customerCreatedById: customer.createdById, mode: r.recipientMode });

  for (const userId of recipients) {
    const sourceKey = notificationSourceKey(org.orgId, meta.messageId, userId);
    // 已有（重放、中断后重跑、另一轮抢先）：不重发、不推送
    const existing = await db.notification.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) continue;
    try {
      await createNotification({
        userId,
        orgId: org.orgId,
        type: NOTIFICATION_TYPE,
        category: NOTIFICATION_CATEGORY,
        title: draft.title,
        summary: draft.summary,
        entityType: NOTIFICATION_ENTITY_TYPE,
        entityId: customer.id,
        sourceKey,
        metadata: { rule, messageId: meta.messageId },
      });
    } catch (err) {
      // 两轮重叠时另一轮先建了：唯一键冲突，按已送达处理
      if ((err as { code?: string } | null)?.code === "P2002") continue;
      throw err;
    }
    result.notified += 1;
    await pushWechatSafe(r.push, userId, text, result);
  }

  if (!(await interactionExists(org.orgId, customer.id, ownerId, meta))) {
    const data = interactionData({ orgId: org.orgId, customerId: customer.id, mailboxUserId: ownerId, message: meta });
    await db.customerInteraction.create({ data: data as Prisma.CustomerInteractionUncheckedCreateInput });
  }

  if (r.beforeLedger) await r.beforeLedger(meta.messageId);

  await writeAuditLog(db, {
    userId: ownerId,
    orgId: org.orgId,
    action: LEDGER_ACTION,
    targetType: LEDGER_TARGET_TYPE,
    targetId: meta.messageId,
    afterData: ledgerEntry({ message: meta, sender, customerId: customer.id, rule, mailboxUserId: ownerId, observedAt: r.now }),
  });
}

/** 缺读信权限 / 未绑定 / 授权失效：24 小时内至多一条站内提醒，文字写明去邮箱绑定页重新授权（与询价回信入站的提醒同做法）。不推微信 */
async function remindReadAccess(orgId: string, userId: string, now: Date): Promise<boolean> {
  const prefix = scopeReminderPrefix(orgId, userId);
  const recent = await db.notification.findFirst({
    where: { sourceKey: { startsWith: prefix }, createdAt: { gte: new Date(now.getTime() - SCOPE_REMINDER_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) return false;
  await createNotification({
    userId,
    orgId,
    type: "system",
    category: "system",
    title: "客户来信提醒需要重新授权",
    summary: "你勾选了「客户来信提醒」，但当前的 Gmail 授权读不了邮件。请到 设置 → 邮箱绑定 重新授权（同意读取邮件）。",
    sourceKey: `${prefix}${now.toISOString()}`,
  });
  return true;
}

/** 回写游标：锁行后在最新的设置上确认该成员仍处于勾选状态，否则不写 */
async function saveCursor(orgId: string, userId: string, historyId: string | null, now: Date): Promise<void> {
  await mutateOrgSettings(orgId, (latest) => {
    const next = withCursor(readMailWatch(latest), userId, historyId, now);
    if (!next) return { result: null };
    return { next: withMailWatch(latest, next), result: null };
  });
}

async function runMailbox(org: OrgContext, owner: { id: string; role: string; email: string }, r: Resolved): Promise<MailboxRunResult> {
  const result = emptyMailboxResult(owner.id);
  const box = org.config.mailboxes[owner.id];

  let additions: InboxAdditions;
  try {
    additions = await r.listAdditions(owner.id, { sinceHistoryId: box.historyId, maxMessages: INBOX_ADDITIONS_MAX });
  } catch (err) {
    const code = err instanceof MailboxReadError ? err.code : classifyGmailError(err);
    if (code === "MAIL_NOT_CONNECTED" || code === "MAIL_READ_SCOPE_MISSING" || code === "MAIL_REAUTH_REQUIRED") {
      result.skipped = "no_read_access";
      result.reminded = await remindReadAccess(org.orgId, owner.id, r.now);
      return result;
    }
    throw err;
  }

  if (additions.expired) {
    // 游标过期：重建起点、不回溯
    const head = await r.listAdditions(owner.id, { sinceHistoryId: null, maxMessages: INBOX_ADDITIONS_MAX });
    await writeAuditLog(db, { userId: owner.id, orgId: org.orgId, action: CURSOR_RESET_ACTION, targetType: MAILBOX_TARGET_TYPE, targetId: owner.id, afterData: { previousHistoryId: box.historyId, historyId: head.historyId } });
    if (r.beforeSaveCursor) await r.beforeSaveCursor(owner.id);
    await saveCursor(org.orgId, owner.id, head.historyId, r.now);
    result.cursorReset = true;
    return result;
  }
  if (!box.historyId) {
    // 首次勾选：只记起点，不处理此前的邮件
    if (r.beforeSaveCursor) await r.beforeSaveCursor(owner.id);
    await saveCursor(org.orgId, owner.id, additions.historyId, r.now);
    result.bootstrapped = true;
    return result;
  }

  const [providerRow, role] = await Promise.all([
    getEmailProvider(owner.id).catch(() => null),
    resolveEffectivePlatformRole({ userId: owner.id, orgId: org.orgId, platformRole: owner.role }),
  ]);
  const ownerEmails = [owner.email, providerRow?.accountEmail ?? ""].filter(Boolean);
  const isVisible = (c: CustomerRef) => canSeeResource(role, owner.id, { orgId: org.orgId, createdById: c.createdById }, org.orgId);
  result.hasMore = additions.hasMore;

  for (const ref of additions.messages) {
    result.counts.scanned += 1;
    try {
      // Gmail 的邮件 id 只在一个邮箱内唯一：账本按「邮箱主人 + 邮件 id」认（账本的 userId 就是邮箱主人）
      const ledgered = await db.auditLog.findFirst({ where: { orgId: org.orgId, userId: owner.id, action: LEDGER_ACTION, targetType: LEDGER_TARGET_TYPE, targetId: ref.messageId }, select: { id: true } });
      if (ledgered) {
        result.counts.duplicate += 1;
        continue;
      }
      const meta = await r.getMeta(owner.id, ref.messageId);
      if (skipReason({ message: meta, ownerEmails, inquiryThreadIds: org.inquiryThreadIds })) {
        result.counts.skipped += 1;
        continue;
      }
      const sender = senderAddress(meta);
      let verdict = classify({ sender, index: org.index, threadCustomers: [], ownerId: owner.id, isVisible });
      if (verdict.kind === "unmatched" && needsThreadLookup(meta, false)) {
        const members = await r.listThread(owner.id, meta.threadId);
        const candidates = await threadCustomers(org, members.map((m) => m.messageId), meta.messageId);
        verdict = classify({ sender, index: org.index, threadCustomers: candidates, ownerId: owner.id, isVisible });
      }
      if (verdict.kind === "unmatched") {
        result.counts.unmatched += 1;
        continue;
      }
      await recordMatch({ org, ownerId: owner.id, meta, sender: sender ?? "", customer: verdict.customer, rule: verdict.kind, r, result });
      if (verdict.kind === "customer_mail") result.counts.customerMail += 1;
      else result.counts.customerReply += 1;
    } catch (err) {
      if (err instanceof MailWatchInterrupted) throw err;
      result.counts.failed += 1;
      // 不重试：记一条失败（只有邮件 id 与错误类别），游标照常前进
      await writeAuditLog(db, { userId: owner.id, orgId: org.orgId, action: FAILED_ACTION, targetType: LEDGER_TARGET_TYPE, targetId: ref.messageId, afterData: { messageId: ref.messageId, error: failureKind(err) } }).catch(() => {});
    }
  }

  await writeAuditLog(db, {
    userId: owner.id,
    orgId: org.orgId,
    action: RUN_ACTION,
    targetType: MAILBOX_TARGET_TYPE,
    targetId: owner.id,
    afterData: { ...result.counts, hasMore: additions.hasMore },
  });
  if (r.beforeSaveCursor) await r.beforeSaveCursor(owner.id);
  await saveCursor(org.orgId, owner.id, additions.historyId, r.now);
  return result;
}

/**
 * 跑一轮来信观察。平台开关关闭、或没有任何邮箱满足三道开关时记为跳过。
 * 一个邮箱出错不影响其它邮箱；一个组织出错不影响其它组织。
 */
export async function runMailWatch(deps: MailWatchDeps = {}): Promise<MailWatchRunSummary> {
  const summary: MailWatchRunSummary = {
    skipped: null,
    organizations: 0,
    mailboxes: 0,
    deadlineSkipped: 0,
    failedCount: 0,
    scanned: 0,
    matched: 0,
    unmatched: 0,
    notified: 0,
    wechatSent: 0,
    wechatFailed: 0,
    wechatSkipped: 0,
    wechatCapped: 0,
    results: [],
  };
  const platformEnabled = deps.platformEnabled ?? isMailWatchAllowed();
  if (!platformEnabled) return { ...summary, skipped: "platform_disabled" };

  const now = deps.now?.() ?? new Date();
  const deadline = deps.deadline ?? new Date(Date.now() + DEFAULT_BUDGET_MS);
  const r: Resolved = {
    listAdditions: deps.listAdditions ?? ((userId, opts) => listInboxAdditions(userId, opts)),
    getMeta: deps.getMeta ?? ((userId, messageId) => getInboxMessageMeta(userId, messageId)),
    listThread: deps.listThread ?? ((userId, threadId) => listThreadMessages(userId, threadId)),
    now,
    deadline,
    push: {
      push: deps.pushWechat ?? (async (userId, title, content) => (await import("@/lib/messaging/push-service")).pushSalesReminder(userId, title, content)),
      remaining: deps.maxWechatPushes ?? MAX_WECHAT_PUSHES_PER_RUN,
      deadline,
    },
    recipientMode: deps.recipientMode ?? DEFAULT_RECIPIENT_MODE,
    beforeLedger: deps.beforeLedger,
    beforeSaveCursor: deps.beforeSaveCursor,
  };

  const orgs = await db.organization.findMany({
    where: {
      ...(deps.orgIds ? { id: { in: deps.orgIds } } : {}),
      settingsJson: { path: ["mailWatch", "enabled"], equals: true },
    },
    select: { id: true, settingsJson: true },
    orderBy: { createdAt: "asc" },
  });

  for (const o of orgs) {
    const config = readMailWatch(o.settingsJson);
    const optedIn = Object.keys(config.mailboxes);
    if (!config.enabled || optedIn.length === 0) continue;
    // 只读在职成员的邮箱：成员停用 / 离开企业后，即使勾选还在也不再读
    const members = await db.organizationMember.findMany({
      where: { orgId: o.id, status: "active", userId: { in: optedIn }, user: { status: "active" } },
      select: { userId: true, user: { select: { id: true, role: true, email: true } } },
      orderBy: { userId: "asc" },
    });
    const owners = members
      .filter((m) => mailboxParticipates({ platformEnabled, orgEnabled: config.enabled, optedIn: Boolean(config.mailboxes[m.userId]), activeMember: true }))
      .map((m) => m.user);
    if (owners.length === 0) continue;

    const out: MailWatchRunSummary["results"][number] = { orgId: o.id, mailboxes: [], error: null };
    try {
      const org = await prepareOrg(o.id, config, now);
      for (const owner of owners) {
        if (Date.now() > deadline.getTime()) {
          out.mailboxes.push({ ...emptyMailboxResult(owner.id), skipped: "deadline" });
          continue;
        }
        try {
          out.mailboxes.push(await runMailbox(org, owner, r));
        } catch (err) {
          if (err instanceof MailWatchInterrupted) throw err;
          out.mailboxes.push({ ...emptyMailboxResult(owner.id), error: failureKind(err) });
        }
      }
    } catch (err) {
      if (err instanceof MailWatchInterrupted) throw err;
      out.error = failureKind(err);
    }
    summary.results.push(out);
  }

  const boxes = summary.results.flatMap((x) => x.mailboxes);
  summary.organizations = summary.results.length;
  summary.mailboxes = boxes.length;
  if (boxes.length === 0) return { ...summary, skipped: "no_mailboxes" };
  summary.deadlineSkipped = boxes.filter((b) => b.skipped === "deadline").length;
  summary.failedCount = summary.results.filter((x) => x.error || x.mailboxes.some((b) => b.error)).length;
  for (const b of boxes) {
    summary.scanned += b.counts.scanned;
    summary.matched += b.counts.customerMail + b.counts.customerReply;
    summary.unmatched += b.counts.unmatched;
    summary.notified += b.notified;
    summary.wechatSent += b.wechatSent;
    summary.wechatFailed += b.wechatFailed;
    summary.wechatSkipped += b.wechatSkipped;
    summary.wechatCapped += b.wechatCapped;
  }
  return summary;
}
