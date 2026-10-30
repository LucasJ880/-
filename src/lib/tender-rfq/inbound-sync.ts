/**
 * Tender RFQ（P1-4）— 询价回信入站编排（cron 每 10 分钟，游标轮询；不用 Pub/Sub、不新增队列/lease）
 *
 * 流程（每个有在途询价的组织）：
 *   读游标 → history.list → 只留 threadId 命中 InquiryItem 的信 → 幂等检查（AuditLog）→ 取信
 *   → parseInboundQuote → planInquiryItemUpdate → recordQuote / markItemReplied（含 Muse hooks）
 *   → AuditLog → 写游标（Organization.settingsJson.tenderRfq.inbound，零 schema）
 *   → P1-7：同一次 tick 末尾跑催单扫描（先收信，再判断谁该催；只起草审批卡，不发信）
 *
 * 纪律：
 *   - 只认 threadId；命不中的信不写库、不通知；不按发件人或主题猜。
 *   - 单封失败记 rfq_inbound:failed + 站内通知"请手工录入"，游标照常前进，下次不重试。
 *   - 本文件不发送任何邮件（催单只起草审批卡，批准后才发）；AuditLog 只存结构化字段与 ≤200 字证据，不存邮件原文。
 *
 * 所有 I/O 经 deps 注入（默认实现懒加载 DB/服务），纯逻辑测试不连库。
 */

import { appendQuoteNotes, planInquiryItemUpdate, type ExistingInquiryItem, type InquiryItemUpdatePlan } from "./inbound-apply";
import { parseRfqThreadId, rfqContextFromBody } from "./inbound-contract";
import type { InboundAttachmentInput, ParseInboundQuoteInput, ParsedQuote } from "./inbound-parse";
import type { MuseQuoteSnapshot } from "@/lib/muse-bridge/hooks";

/* ---------------------------------- 类型 ---------------------------------- */

export const INBOUND_AUDIT_TARGET = "rfq_inbound_message" as const;
export const INBOUND_NOTIFICATION_CATEGORY = "muse_bridge" as const;
const REMINDER_WINDOW_MS = 24 * 3600 * 1000;
/** 只扫最近 90 天发出的询价（更早的线程不再期待回信） */
const OPEN_ITEM_WINDOW_DAYS = 90;

export type InboundCursor = { historyId: string; lastSyncAt: string };

export type InboundItemRow = ExistingInquiryItem & {
  id: string;
  inquiryId: string;
  projectId: string;
  ownerId: string;
  threadId: string;
};

export type InboundOrgContext = {
  orgId: string;
  settingsJson: unknown;
  items: InboundItemRow[];
};

export type InboundMessage = {
  messageId: string;
  threadId: string;
  labelIds: string[];
  date: Date;
  from: string;
  bodyText: string;
  attachments: InboundAttachmentInput[];
};

export type InboundSyncDeps = {
  now: () => Date;
  findMailbox: (mailboxEmail: string) => Promise<{ userId: string; grantedScopes: string | null } | null>;
  hasReadScope: (grantedScopes: string | null) => boolean;
  /** 24h 内已提醒过 → true */
  recentReadScopeReminder: (orgId: string, userId: string, since: Date) => Promise<boolean>;
  remindReadScope: (orgId: string, userId: string, now: Date) => Promise<void>;
  listReplies: (userId: string, opts: { sinceHistoryId: string | null }) => Promise<{ messages: Array<{ messageId: string; threadId: string }>; historyId: string | null; expired: boolean }>;
  listThreadMessages: (userId: string, threadId: string) => Promise<Array<{ messageId: string; threadId: string }>>;
  getMessage: (userId: string, messageId: string) => Promise<InboundMessage>;
  alreadyProcessed: (messageId: string) => Promise<boolean>;
  loadRfqBody: (inquiryId: string, itemId: string) => Promise<string | null>;
  /** 每封信处理前重读，避免同一 item 多封信时用旧值判断"只填空" */
  reloadItem: (item: InboundItemRow) => Promise<InboundItemRow | null>;
  parse: (input: ParseInboundQuoteInput) => Promise<ParsedQuote & { attachmentNotes?: string[] }>;
  applyPlan: (item: InboundItemRow, plan: InquiryItemUpdatePlan, now: Date) => Promise<void>;
  /**
   * 已标未响应（催满两次 / 截止已过）后才到的回信：先把 item 从 no_response 改回 sent（状态机允许），
   * 再按 sent 的规则入表。不传 = 不认领这类信（测试 deps 可省）。
   */
  reviveNoResponse?: (item: InboundItemRow) => Promise<void>;
  writeAudit: (entry: { orgId: string; projectId: string; userId: string; messageId: string; action: "rfq_inbound:applied" | "rfq_inbound:failed"; data: Record<string, unknown> }) => Promise<void>;
  notifyFailed: (entry: { orgId: string; projectId: string; userId: string; messageId: string; error: string }) => Promise<void>;
  saveCursor: (orgId: string, cursor: InboundCursor) => Promise<void>;
  /** P1-7：收信成功后的催单扫描（不传 = 不扫；入站被跳过时不扫——没读到回信就不知道谁真没回） */
  runChaseScan?: (orgId: string, now: Date) => Promise<{ drafted: unknown[]; noResponse: unknown[]; failed: unknown[] }>;
};

export type OrgSyncResult = {
  orgId: string;
  skipped?: "no_mailbox" | "no_read_scope";
  reminded?: boolean;
  bootstrapped?: boolean;
  scanned: number;
  ignored: number;
  duplicates: number;
  ownMessages: number;
  quoted: number;
  replied: number;
  unchanged: number;
  failed: number;
  historyId: string | null;
  /** P1-7 催单扫描：起草的卡数 / 标 no_response 数 / 失败数 */
  chase?: { drafted: number; noResponse: number; failed: number; error?: string };
};

/* ---------------------------------- 游标（零 schema） ---------------------------------- */

export function readInboundCursor(settingsJson: unknown): InboundCursor | null {
  const tr = (settingsJson as { tenderRfq?: { inbound?: unknown } } | null)?.tenderRfq?.inbound as Partial<InboundCursor> | undefined;
  return tr && typeof tr.historyId === "string" && tr.historyId ? { historyId: tr.historyId, lastSyncAt: String(tr.lastSyncAt ?? "") } : null;
}

/** 只改 tenderRfq.inbound，保留 settingsJson 其它键与 tenderRfq 的其它设置 */
export function withInboundCursor(settingsJson: unknown, cursor: InboundCursor): Record<string, unknown> {
  const base = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson) ? (settingsJson as Record<string, unknown>) : {};
  const tr = base.tenderRfq && typeof base.tenderRfq === "object" ? (base.tenderRfq as Record<string, unknown>) : {};
  return { ...base, tenderRfq: { ...tr, inbound: { historyId: cursor.historyId, lastSyncAt: cursor.lastSyncAt } } };
}

/* ---------------------------------- 编排 ---------------------------------- */

function emptyResult(orgId: string): OrgSyncResult {
  return { orgId, scanned: 0, ignored: 0, duplicates: 0, ownMessages: 0, quoted: 0, replied: 0, unchanged: 0, failed: 0, historyId: null };
}

/** 线程里我们自己发出的信：SENT 标签，或发件人是显示地址（project@）/ 授权账号（lucas@）之一 */
export function isOwnMessage(msg: Pick<InboundMessage, "labelIds" | "from">, ownEmails: readonly string[]): boolean {
  if (msg.labelIds.includes("SENT")) return true;
  const from = msg.from.toLowerCase();
  return ownEmails.some((e) => !!e && from.includes(e.toLowerCase()));
}

/** AuditLog 摘要：结构化字段 + 证据片段，不含邮件原文 */
function auditSummary(parsed: ParsedQuote, plan: InquiryItemUpdatePlan): Record<string, unknown> {
  return {
    itemTransition: plan.transition,
    written: plan.data,
    missingFields: plan.missingFields,
    events: plan.events,
    isQuote: parsed.isQuote,
    declined: parsed.declined,
    prices: parsed.prices,
    deliveryEvidence: parsed.deliveryEvidence,
    validUntilEvidence: parsed.validUntilEvidence,
    validUntilInferred: parsed.validUntilInferred,
    attachmentsSeen: parsed.attachmentsSeen,
    rejected: parsed.rejected,
  };
}

export async function syncOrgInbound(org: InboundOrgContext, deps: InboundSyncDeps): Promise<OrgSyncResult> {
  const result = emptyResult(org.orgId);
  const now = deps.now();
  const { readTenderRfqSettings } = await import("./round-pure");
  const { fromEmail, mailboxEmail } = readTenderRfqSettings(org.settingsJson);

  const mailbox = await deps.findMailbox(mailboxEmail);
  if (!mailbox) return { ...result, skipped: "no_mailbox" };
  if (!deps.hasReadScope(mailbox.grantedScopes)) {
    const already = await deps.recentReadScopeReminder(org.orgId, mailbox.userId, new Date(now.getTime() - REMINDER_WINDOW_MS));
    if (!already) await deps.remindReadScope(org.orgId, mailbox.userId, now);
    return { ...result, skipped: "no_read_scope", reminded: !already };
  }

  const byThread = new Map<string, InboundItemRow>();
  for (const it of org.items) byThread.set(it.threadId, it);

  // ── 拉取：有游标走 history；无游标/过期 → 先取当前 historyId，再按已知线程补扫（不漏首次同步前的回信） ──
  const cursor = readInboundCursor(org.settingsJson);
  let refs: Array<{ messageId: string; threadId: string }> = [];
  let historyId: string | null = null;
  const listed = cursor ? await deps.listReplies(mailbox.userId, { sinceHistoryId: cursor.historyId }) : null;
  if (listed && !listed.expired) {
    refs = listed.messages;
    historyId = listed.historyId;
  } else {
    const head = await deps.listReplies(mailbox.userId, { sinceHistoryId: null });
    historyId = head.historyId;
    for (const threadId of byThread.keys()) refs.push(...(await deps.listThreadMessages(mailbox.userId, threadId)));
    result.bootstrapped = true;
  }

  const rfqCtxCache = new Map<string, { firstTierQty: number | null; mandatoryCodes: string[] }>();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.messageId)) continue;
    seen.add(ref.messageId);
    result.scanned += 1;

    const owner = byThread.get(ref.threadId);
    if (!owner) {
      result.ignored += 1; // 命不中任何询价线程：不写库、不通知
      continue;
    }
    if (await deps.alreadyProcessed(ref.messageId)) {
      result.duplicates += 1;
      continue;
    }

    try {
      const msg = await deps.getMessage(mailbox.userId, ref.messageId);
      if (isOwnMessage(msg, [fromEmail, mailboxEmail])) {
        result.ownMessages += 1; // 线程里我们自己发出的询价/跟进，不是回信
        continue;
      }
      const current = (await deps.reloadItem(owner)) ?? owner;
      // 未响应后才回信：按 sent 规划（一定会变成 replied / quoted），落库前先改回 sent
      const revived = current.status === "no_response";
      if (revived && !deps.reviveNoResponse) {
        result.ignored += 1;
        continue;
      }
      const item = revived ? { ...current, status: "sent" } : current;

      let rfqCtx = rfqCtxCache.get(item.id);
      if (!rfqCtx) {
        rfqCtx = rfqContextFromBody(await deps.loadRfqBody(item.inquiryId, item.id));
        rfqCtxCache.set(item.id, rfqCtx);
      }

      const parsed = await deps.parse({
        bodyText: msg.bodyText,
        attachments: msg.attachments,
        emailDate: msg.date,
        mandatoryCodes: rfqCtx.mandatoryCodes,
        firstTierQty: rfqCtx.firstTierQty,
        orgId: org.orgId,
        userId: mailbox.userId,
      });
      const plan = planInquiryItemUpdate(item, parsed, rfqCtx.firstTierQty, msg.date, {
        messageId: msg.messageId,
        now,
        attachmentNotes: parsed.attachmentNotes,
      });
      if (revived) await deps.reviveNoResponse!(current);
      await deps.applyPlan(item, plan, now);
      await deps.writeAudit({
        orgId: org.orgId,
        projectId: item.projectId,
        userId: mailbox.userId,
        messageId: ref.messageId,
        action: "rfq_inbound:applied",
        data: { itemId: item.id, ...auditSummary(parsed, plan), ...(revived ? { revivedFromNoResponse: true } : {}) },
      });
      if (plan.transition === "quoted") result.quoted += 1;
      else if (plan.transition === "replied") result.replied += 1;
      else result.unchanged += 1;
    } catch (err) {
      result.failed += 1;
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      // 失败也落 AuditLog（= 幂等键），下次 cron 不再重试，避免死循环；改由人工录入
      await deps.writeAudit({
        orgId: org.orgId,
        projectId: owner.projectId,
        userId: mailbox.userId,
        messageId: ref.messageId,
        action: "rfq_inbound:failed",
        data: { itemId: owner.id, error },
      }).catch((e) => console.error("[tender-rfq-inbound] audit failed:", e));
      await deps.notifyFailed({ orgId: org.orgId, projectId: owner.projectId, userId: owner.ownerId, messageId: ref.messageId, error })
        .catch((e) => console.error("[tender-rfq-inbound] notify failed:", e));
    }
  }

  if (historyId) {
    await deps.saveCursor(org.orgId, { historyId, lastSyncAt: now.toISOString() });
    result.historyId = historyId;
  }
  return result;
}

/**
 * 入站写入后推 Muse 事件的参数（quoted 与 replied 两条路径共用）。
 * 缺字段以 plan.missingFields 为准（missingFieldsOverride），不让 hook 按字段值重新推断。
 */
export function inboundQuoteHookArgs(
  item: ExistingInquiryItem,
  plan: InquiryItemUpdatePlan,
  updated?: { unitPrice?: unknown; totalPrice?: unknown; currency?: string | null; deliveryDays?: number | null; validUntil?: Date | string | null } | null,
): [MuseQuoteSnapshot, readonly string[]] {
  const after = updated ?? {
    unitPrice: plan.data.unitPrice ?? item.unitPrice,
    totalPrice: plan.data.totalPrice ?? item.totalPrice,
    currency: plan.data.currency ?? item.currency,
    deliveryDays: plan.data.deliveryDays ?? item.deliveryDays,
    validUntil: plan.data.validUntil ?? item.validUntil,
  };
  return [
    {
      unitPrice: after.unitPrice ?? null,
      totalPrice: after.totalPrice ?? null,
      currency: plan.missingFields.includes("currency") ? null : after.currency ?? null,
      deliveryDays: after.deliveryDays ?? null,
      validUntil: after.validUntil ?? null,
    },
    plan.missingFields,
  ];
}

/* ---------------------------------- 默认依赖（DB / Gmail / 服务） ---------------------------------- */

export async function defaultInboundSyncDeps(): Promise<InboundSyncDeps> {
  const { db } = await import("@/lib/db");
  const google = await import("@/lib/google-email");
  const { recordQuote, markItemReplied } = await import("@/lib/inquiry/service");
  const { createNotification } = await import("@/lib/notifications/create");
  const { writeAuditLog } = await import("@/lib/audit/logger");
  const { parseInboundQuote } = await import("./inbound-parse");
  const { TENDER_SEND_RFQ_TYPE } = await import("./types");
  type RecordQuoteInput = import("@/lib/inquiry/types").RecordQuoteInput;
  const reminderPrefix = (orgId: string, userId: string) => `tender-rfq-inbound:no_read_scope:${orgId}:${userId}:`;

  return {
    now: () => new Date(),
    findMailbox: (mailboxEmail) =>
      db.emailProvider.findFirst({
        where: { type: "gmail", accountEmail: { equals: mailboxEmail, mode: "insensitive" } },
        select: { userId: true, grantedScopes: true },
      }),
    hasReadScope: google.hasGmailReadScope,
    recentReadScopeReminder: async (orgId, userId, since) =>
      !!(await db.notification.findFirst({
        where: { sourceKey: { startsWith: reminderPrefix(orgId, userId) }, createdAt: { gte: since } },
        select: { id: true },
      })),
    remindReadScope: async (orgId, userId, now) => {
      await createNotification({
        userId,
        orgId,
        type: "project_update",
        category: INBOUND_NOTIFICATION_CATEGORY,
        title: "询价回信无法自动入表：请重新授权 Gmail 读取权限",
        summary: "青砚需要 gmail.readonly 才能读取供应商回信。请到 设置 → 邮箱绑定 → 重新授权（勾选读取邮件）。",
        priority: "high",
        sourceKey: `${reminderPrefix(orgId, userId)}${now.toISOString()}`,
      });
    },
    listReplies: (userId, opts) => google.listThreadReplies(userId, opts),
    listThreadMessages: (userId, threadId) => google.listThreadMessages(userId, threadId),
    getMessage: async (userId, messageId) => {
      const m = await google.getMessageWithAttachments(userId, messageId);
      return { ...m, attachments: m.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, data: a.data })) };
    },
    alreadyProcessed: async (messageId) =>
      !!(await db.auditLog.findFirst({ where: { targetType: INBOUND_AUDIT_TARGET, targetId: messageId }, select: { id: true } })),
    loadRfqBody: async (inquiryId, itemId) => {
      const pa = await db.pendingAction.findFirst({
        where: { type: TENDER_SEND_RFQ_TYPE, payload: { path: ["inquiryId"], equals: inquiryId } },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      });
      const items = (pa?.payload as { items?: Array<{ inquiryItemId?: string; body?: string }> } | null)?.items ?? [];
      return items.find((i) => i.inquiryItemId === itemId)?.body ?? null;
    },
    reloadItem: async (item) => {
      const r = await db.inquiryItem.findUnique({
        where: { id: item.id },
        select: { status: true, unitPrice: true, totalPrice: true, currency: true, deliveryDays: true, validUntil: true, quoteNotes: true },
      });
      return r ? { ...item, ...r } : null;
    },
    parse: (input) => parseInboundQuote(input),
    reviveNoResponse: async (item) => {
      // 条件写：只在仍是 no_response 时改回 sent（状态机 no_response → sent）
      await db.inquiryItem.updateMany({ where: { id: item.id, status: "no_response" }, data: { status: "sent" } });
    },
    applyPlan: async (item, plan, now) => {
      const scope = { projectId: item.projectId, inquiryId: item.inquiryId, itemId: item.id };
      const quoteNotes = appendQuoteNotes(item.quoteNotes, plan.notesAppend);
      const nonPrice = {
        ...(plan.data.currency ? { currency: plan.data.currency } : {}),
        ...(plan.data.deliveryDays != null ? { deliveryDays: plan.data.deliveryDays } : {}),
        ...(plan.data.validUntil ? { validUntil: new Date(plan.data.validUntil) } : {}),
      };

      if (plan.transition === "quoted") {
        if (item.status === "sent") {
          // 状态机要求 sent → replied → quoted。这里不走 markItemReplied：它会先推一条
          // "报价还没录入"的 reply.received，紧接着 recordQuote 又推 quote.parsed，前后矛盾。
          await db.inquiryItem.updateMany({ where: { id: item.id, status: "sent" }, data: { status: "replied", repliedAt: now } });
        }
        const input: RecordQuoteInput = { quoteNotes };
        if (plan.data.unitPrice != null) input.unitPrice = String(plan.data.unitPrice);
        if (plan.data.totalPrice != null) input.totalPrice = String(plan.data.totalPrice);
        if (input.unitPrice == null && input.totalPrice == null) {
          // 价格是人工已录的：原值原样带上只为满足 recordQuote 校验，不改值
          if (item.unitPrice != null) input.unitPrice = String(item.unitPrice);
          if (item.totalPrice != null) input.totalPrice = String(item.totalPrice);
        }
        if (plan.data.currency) input.currency = plan.data.currency;
        if (plan.data.deliveryDays != null) input.deliveryDays = plan.data.deliveryDays;
        if (plan.data.validUntil) input.validUntil = plan.data.validUntil;
        // 跳过 recordQuote 自带的 hook：它只看字段值判缺，币种列默认 CAD 时判不出"供应商没写币种"；
        // 这里自己推，缺字段以解析结果（plan.missingFields）为准
        const updated = await recordQuote(scope, input, { skipMuseHook: true });
        const { museOnQuoteRecorded } = await import("@/lib/muse-bridge/hooks");
        await museOnQuoteRecorded(item.id, ...inboundQuoteHookArgs(item, plan, updated));
        return;
      }

      if (plan.transition === "replied") {
        await markItemReplied(scope); // hook：reply.received（不传 notes → contactNotes 里的 threadId 保留）
      }
      await db.inquiryItem.update({ where: { id: item.id }, data: { quoteNotes, ...nonPrice } });
      if (plan.transition === "replied" && plan.events.includes("missing_fields")) {
        const { museOnQuoteRecorded } = await import("@/lib/muse-bridge/hooks");
        await museOnQuoteRecorded(item.id, ...inboundQuoteHookArgs(item, plan));
      }
    },
    writeAudit: (e) =>
      writeAuditLog(db, {
        userId: e.userId,
        orgId: e.orgId,
        projectId: e.projectId,
        action: e.action,
        targetType: INBOUND_AUDIT_TARGET,
        targetId: e.messageId,
        afterData: e.data,
      }),
    notifyFailed: async (e) => {
      await createNotification({
        userId: e.userId,
        orgId: e.orgId,
        projectId: e.projectId,
        type: "project_update",
        category: INBOUND_NOTIFICATION_CATEGORY,
        title: "有一封供应商回信解析失败，请手工录入",
        summary: `回信（Gmail ${e.messageId}）未能自动入表：${e.error.slice(0, 120)}`,
        entityType: "project",
        entityId: e.projectId,
        priority: "medium",
        sourceKey: `tender-rfq-inbound:failed:${e.messageId}`,
      });
    },
    runChaseScan: async (orgId, now) => {
      const { runChaseScan } = await import("./chase-service");
      return runChaseScan(orgId, now);
    },
    saveCursor: async (orgId, cursor) => {
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
      await db.organization.update({
        where: { id: orgId },
        data: { settingsJson: withInboundCursor(org?.settingsJson ?? null, cursor) as import("@prisma/client").Prisma.InputJsonValue },
      });
    },
  };
}

/** 找出所有有在途询价线程（已发 + contactNotes 带 threadId）的组织 */
export async function loadInboundOrgContexts(now: Date = new Date()): Promise<InboundOrgContext[]> {
  const { db } = await import("@/lib/db");
  const rows = await db.inquiryItem.findMany({
    where: {
      // no_response 也盯：标了未响应之后才回的信照样认领入表（P1-7 后续）
      status: { in: ["sent", "replied", "quoted", "no_response"] },
      contactNotes: { contains: "threadId=" },
      sentAt: { gte: new Date(now.getTime() - OPEN_ITEM_WINDOW_DAYS * 86_400_000) },
    },
    select: {
      id: true,
      inquiryId: true,
      status: true,
      unitPrice: true,
      totalPrice: true,
      currency: true,
      deliveryDays: true,
      validUntil: true,
      quoteNotes: true,
      contactNotes: true,
      inquiry: { select: { projectId: true, project: { select: { orgId: true, ownerId: true } } } },
    },
  });
  const byOrg = new Map<string, InboundItemRow[]>();
  for (const r of rows) {
    const orgId = r.inquiry.project.orgId;
    const threadId = parseRfqThreadId(r.contactNotes);
    if (!orgId || !threadId) continue;
    const { contactNotes: _c, inquiry, ...rest } = r;
    void _c;
    const list = byOrg.get(orgId) ?? [];
    list.push({ ...rest, projectId: inquiry.projectId, ownerId: inquiry.project.ownerId, threadId });
    byOrg.set(orgId, list);
  }
  if (byOrg.size === 0) return [];
  const orgs = await db.organization.findMany({ where: { id: { in: [...byOrg.keys()] } }, select: { id: true, settingsJson: true } });
  return orgs.map((o) => ({ orgId: o.id, settingsJson: o.settingsJson, items: byOrg.get(o.id) ?? [] }));
}

export async function syncAllOrgsInbound(
  deps?: InboundSyncDeps,
  loadContexts: (now: Date) => Promise<InboundOrgContext[]> = loadInboundOrgContexts,
): Promise<{ orgs: OrgSyncResult[]; skipped?: "no_read_scope" }> {
  const d = deps ?? (await defaultInboundSyncDeps());
  const contexts = await loadContexts(d.now());
  const orgs: OrgSyncResult[] = [];
  for (const ctx of contexts) {
    try {
      const r = await syncOrgInbound(ctx, d);
      if (!r.skipped && d.runChaseScan) {
        try {
          const c = await d.runChaseScan(ctx.orgId, d.now());
          r.chase = { drafted: c.drafted.length, noResponse: c.noResponse.length, failed: c.failed.length };
        } catch (err) {
          // 催单扫描失败不影响收信结果（游标已写），下次 tick 再扫
          console.error(`[tender-rfq-inbound] chase scan ${ctx.orgId} failed:`, err);
          r.chase = { drafted: 0, noResponse: 0, failed: 1, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
        }
      }
      orgs.push(r);
    } catch (err) {
      // 组织级失败（如 Gmail 鉴权失效）不影响其它组织；游标未写 → 下次重试
      console.error(`[tender-rfq-inbound] org ${ctx.orgId} failed:`, err);
      orgs.push({ ...emptyResult(ctx.orgId), failed: 1 });
    }
  }
  const allNoScope = orgs.length > 0 && orgs.every((o) => o.skipped === "no_read_scope");
  return allNoScope ? { orgs, skipped: "no_read_scope" } : { orgs };
}
