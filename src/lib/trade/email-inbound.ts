/**
 * 邮件转发入站（PRD F1.2 / F6.3b）— Resend「email.received」事件 → 询盘链路
 *
 * 路由（/api/trade/webhook/email）先验签（email-inbound-rules.verifyResendWebhookSignature，先于任何 DB 访问），
 * 签名通过后才进入这里：
 *
 *   收件地址 inq-xxxxxxxxxx@<INBOUND_EMAIL_DOMAIN> → 按别名解析组织（服务端判定，不信任载荷里的任何 org 字段）
 *   → 同一 Message-ID 已有收据：隔离 / 重复直接返回原结论；已入链的按收据重放（补缺失步骤）
 *   → 取正文（载荷 text/html；没有就经可注入的 fetcher 调 Resend receiving API）
 *   → 解析（email-forward-parse.ts）→ 隔离判定：发件人不在转发白名单 / DKIM·DMARC 未通过或缺失 / 没有买家邮箱或电话
 *       → 收据 status=quarantined + 通知企业管理员；不建任何业务对象
 *   → 双重入站判定：转发的是官网自己的内部询盘通知且该询盘已由官网 webhook 入站（按官网询盘编号，或 48 小时内内容孪生）
 *       → 收据 status=duplicate，指向官网收据；不建商机
 *   → 其余：ingestWebsiteInquiry(origin=email_forward, fdeMode=deferred) —— 收据 source="email"、
 *       eventId="email:<Message-ID>"；请求内只做收据 → Trade → Revenue Spine，FDE 交给 after()，请求不等 LLM。
 *
 * HTTP 语义（给 Resend 重试用）：可重试的失败（正文取不到、主干建链失败、未预期异常）返回 5xx 让 Resend 重发，
 * 重发按 Message-ID 幂等；永久性的结论（未知收件人、非 email.received 事件、隔离、重复）返回 200。
 *
 * 公开仓库：测试与注释只用虚构企业。
 */

import type { Prisma, WebsiteInquiryReceipt } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { bareAddress, parseForwardedEmail, type ParsedForwardedEmail } from "./email-forward-parse";
import {
  EMAIL_WEBSITE_TWIN_WINDOW_MS,
  QUARANTINE_REASON_LABELS,
  aliasFromRecipient,
  buildEmailInquiry,
  emailEventId,
  isWebsiteContentTwin,
  normalizeInboundDomain,
  parseAuthVerdict,
  quarantineReasons,
  type AuthVerdict,
  type QuarantineReason,
} from "./email-inbound-rules";
import { findTradeChannelOrgByInboundAlias } from "./inbound-org";
import { ingestWebsiteInquiry, type FdeScheduler, type IngestOrigin, type NormalizedInquiry } from "./website-inquiry";
import {
  EMAIL_FORWARD_SOURCE,
  WEBSITE_INQUIRY_SOURCE,
  computePayloadHash,
  findReceiptByEventId,
  fromReceiptPayload,
  toReceiptPayload,
} from "./website-inquiry-receipts";

// ── 正文获取（可注入；测试从不访问网络） ────────────────────────────────────

export interface InboundEmailContent {
  text: string | null;
  html: string | null;
  headers: unknown;
}

export type InboundEmailFetcher = (resendEmailId: string) => Promise<InboundEmailContent>;

export class InboundEmailFetchError extends Error {}

/** 默认 fetcher：Resend receiving API（GET /emails/receiving/{id}），需 RESEND_API_KEY */
export const fetchInboundEmailFromResend: InboundEmailFetcher = async (resendEmailId) => {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new InboundEmailFetchError("RESEND_API_KEY 未配置，无法读取入站邮件正文");
  const { Resend } = await import("resend");
  const res = await new Resend(key).emails.receiving.get(resendEmailId);
  if (res.error || !res.data) throw new InboundEmailFetchError(`读取入站邮件失败：${res.error?.message ?? "empty response"}`);
  return { text: res.data.text ?? null, html: res.data.html ?? null, headers: res.data.headers ?? null };
};

let fetcherOverrideForTest: InboundEmailFetcher | null = null;
/** 仅测试：替换默认 fetcher（路由文件只能导出 HTTP 方法与段配置，钩子放在这里） */
export function __setInboundEmailFetcherForTest(fn: InboundEmailFetcher | null): void {
  fetcherOverrideForTest = fn;
}

// ── 事件形状 ────────────────────────────────────────────────────────────────

interface ReceivedEmailData {
  email_id?: unknown;
  created_at?: unknown;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  message_id?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  headers?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

export interface HandleInboundEmailDeps {
  /** INBOUND_EMAIL_DOMAIN；未配置 → 503（平台未开通，Resend 稍后重试） */
  domain?: string | null;
  /** 只认该 authserv-id 写的 Authentication-Results（INBOUND_EMAIL_AUTHSERV_ID，可选） */
  trustedAuthServId?: string | null;
  fetchEmail?: InboundEmailFetcher;
  scheduleFde?: FdeScheduler;
  now?: Date;
}

export type InboundEmailOutcome = "ignored" | "quarantined" | "duplicate" | "ingested" | "replay" | "busy";

export interface HandleInboundEmailResult {
  status: number;
  body: { ok: boolean; outcome?: InboundEmailOutcome; reason?: string; reasons?: QuarantineReason[]; eventId?: string; error?: string };
}

const ignored = (reason: string): HandleInboundEmailResult => ({ status: 200, body: { ok: true, outcome: "ignored", reason } });

// ── 收据（隔离 / 重复：终态，不建业务对象） ─────────────────────────────────

async function recordTerminalReceipt(
  orgId: string,
  v: NormalizedInquiry,
  status: "quarantined" | "duplicate",
  meta: Record<string, unknown>,
  now: Date,
  link?: Pick<WebsiteInquiryReceipt, "id" | "prospectId" | "customerId" | "opportunityId"> | null,
): Promise<{ receipt: WebsiteInquiryReceipt; created: boolean }> {
  try {
    const receipt = await db.websiteInquiryReceipt.create({
      data: {
        orgId,
        source: EMAIL_FORWARD_SOURCE,
        eventId: v.eventId,
        eventIdProvided: true,
        payload: { ...toReceiptPayload(v), meta } as unknown as Prisma.InputJsonValue,
        payloadHash: computePayloadHash(v),
        status,
        processingSince: null,
        firstSeenAt: now,
        completedAt: now,
        // 重复：指向官网收据，并带上它已建立的客户 / 商机（只作关联，不建新对象；不带 salesActionId，FDE 回填不会碰它）
        duplicateOfReceiptId: link?.id ?? null,
        prospectId: link?.prospectId ?? null,
        customerId: link?.customerId ?? null,
        opportunityId: link?.opportunityId ?? null,
      },
    });
    return { receipt, created: true };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      const existing = await findReceiptByEventId(orgId, v.eventId, EMAIL_FORWARD_SOURCE);
      if (existing) return { receipt: existing, created: false };
    }
    throw err;
  }
}

function receiptMeta(receipt: Pick<WebsiteInquiryReceipt, "payload">): Record<string, unknown> {
  const meta = ((receipt.payload ?? {}) as { meta?: unknown }).meta;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function storedReasons(receipt: Pick<WebsiteInquiryReceipt, "payload">): QuarantineReason[] {
  const q = receiptMeta(receipt).quarantine as { reasons?: unknown } | undefined;
  return Array.isArray(q?.reasons) ? (q!.reasons as unknown[]).filter((r): r is QuarantineReason => typeof r === "string" && r in QUARANTINE_REASON_LABELS) : [];
}

/** 隔离通知：企业 owner / 管理员（站内，幂等键按收据）；没有管理员成员时通知组织 owner */
async function notifyQuarantine(orgId: string, receiptId: string, info: { sender: string; subject: string; reasons: QuarantineReason[] }): Promise<number> {
  const admins = await db.organizationMember.findMany({
    where: { orgId, status: "active", role: { in: ["org_owner", "org_admin"] }, user: { status: "active" } },
    select: { userId: true },
  });
  let userIds = admins.map((m) => m.userId);
  if (!userIds.length) {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
    userIds = org?.ownerId ? [org.ownerId] : [];
  }
  if (!userIds.length) return 0;
  const why = info.reasons.map((r) => QUARANTINE_REASON_LABELS[r]).join("；");
  return createNotificationsForUsers(userIds, {
    type: "system",
    title: `邮件转发询盘已隔离：${(info.subject || "（无主题）").slice(0, 60)}`,
    summary: `转发人 ${info.sender || "未知"}。原因：${why}。未建线索 / 商机；确认来源可信后请把发件人加入转发白名单，或请业务员直接录入询盘。`.slice(0, 300),
    orgId,
    entityType: "website_inquiry_receipt",
    entityId: receiptId,
    priority: "high",
    metadata: { receiptId, source: EMAIL_FORWARD_SOURCE, reasons: info.reasons },
    sourceKeyPrefix: `email-quarantine:${receiptId}`,
  });
}

// ── 双重入站（官网通知被转发） ──────────────────────────────────────────────

type WebsiteTwin = { receipt: Pick<WebsiteInquiryReceipt, "id" | "eventId" | "prospectId" | "customerId" | "opportunityId">; matchedBy: "website_inquiry_id" | "content_twin" };

async function findWebsiteTwin(orgId: string, parsed: ParsedForwardedEmail, v: NormalizedInquiry, now: Date): Promise<WebsiteTwin | null> {
  if (parsed.websiteInquiryId) {
    const byId = await findReceiptByEventId(orgId, parsed.websiteInquiryId, WEBSITE_INQUIRY_SOURCE);
    if (byId) return { receipt: byId, matchedBy: "website_inquiry_id" };
  }
  if (!v.email && !v.phone) return null;
  const candidates = await db.websiteInquiryReceipt.findMany({
    where: {
      orgId,
      source: WEBSITE_INQUIRY_SOURCE,
      firstSeenAt: { gte: new Date(now.getTime() - EMAIL_WEBSITE_TWIN_WINDOW_MS) },
      ...(v.email ? { payload: { path: ["email"], equals: v.email } } : {}),
    },
    orderBy: { firstSeenAt: "desc" },
    take: v.email ? 20 : 200,
    select: { id: true, eventId: true, payload: true, prospectId: true, customerId: true, opportunityId: true },
  });
  for (const c of candidates) {
    const web = fromReceiptPayload(c.payload);
    if (isWebsiteContentTwin(web, { buyerEmail: v.email, buyerPhone: v.phone, fullText: parsed.fullText })) {
      return { receipt: c, matchedBy: "content_twin" };
    }
  }
  return null;
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 处理一条已验签的 Resend 事件。orgId 只由收件别名在服务端解析得出。
 */
export async function handleResendInboundEvent(event: unknown, deps: HandleInboundEmailDeps = {}): Promise<HandleInboundEmailResult> {
  const now = deps.now ?? new Date();
  const ev = (event ?? {}) as { type?: unknown; data?: unknown };
  if (ev.type !== "email.received") return ignored("event_type");
  const data = (ev.data && typeof ev.data === "object" ? ev.data : {}) as ReceivedEmailData;

  const domain = normalizeInboundDomain(deps.domain);
  if (!domain) return { status: 503, body: { ok: false, error: "inbound email domain not configured" } };

  // 1. 组织：收件人里第一个能解析到 active email 通道的别名
  const recipients = [...strList(data.to), ...strList(data.cc), ...strList(data.bcc)];
  let channel: { orgId: string; channelId: string; allowlist: string[]; alias: string } | null = null;
  for (const r of recipients) {
    const alias = aliasFromRecipient(r, domain);
    if (!alias) continue;
    const row = await findTradeChannelOrgByInboundAlias(alias);
    if (row) {
      channel = { ...row, alias };
      break;
    }
  }
  if (!channel) {
    logger.warn("trade.inbound.email_unknown_recipient", { recipients: recipients.length });
    return ignored("unknown_recipient");
  }
  const { orgId } = channel;

  const resendEmailId = str(data.email_id).trim();
  const eventId = emailEventId(str(data.message_id), resendEmailId);
  if (!eventId) return ignored("missing_message_id");
  const sender = str(data.from);
  const subject = str(data.subject).slice(0, 300);
  const origin = (subj: string | null): IngestOrigin => ({ kind: "email_forward", subject: subj || null });

  // 2. 同一封邮件再次送达（Resend 重试）：隔离 / 重复返回原结论；已入链的按首次载荷重放
  const existing = await findReceiptByEventId(orgId, eventId, EMAIL_FORWARD_SOURCE);
  if (existing?.status === "quarantined") {
    return { status: 200, body: { ok: true, outcome: "quarantined", reasons: storedReasons(existing), eventId } };
  }
  if (existing?.status === "duplicate") return { status: 200, body: { ok: true, outcome: "duplicate", eventId } };
  if (existing) {
    const meta = receiptMeta(existing);
    const replay = await ingestWebsiteInquiry(orgId, fromReceiptPayload(existing.payload), {
      origin: origin(typeof meta.subject === "string" ? meta.subject : null),
      fdeMode: "deferred",
      scheduleFde: deps.scheduleFde,
      now,
    });
    return ingestResponse(replay, eventId);
  }

  // 3. 正文：载荷里有就用，没有就经 fetcher 取（失败 → 502，Resend 重试）
  let content: InboundEmailContent = { text: str(data.text) || null, html: str(data.html) || null, headers: data.headers ?? null };
  if (!content.text && !content.html) {
    if (!resendEmailId) return ignored("missing_email_id");
    try {
      const fetched = await (deps.fetchEmail ?? fetcherOverrideForTest ?? fetchInboundEmailFromResend)(resendEmailId);
      content = { text: fetched.text, html: fetched.html, headers: content.headers ?? fetched.headers };
    } catch (err) {
      logger.warn("trade.inbound.email_body_fetch_failed", { orgId, error: err instanceof Error ? err.message : String(err) });
      return { status: 502, body: { ok: false, error: "email body unavailable" } };
    }
  }

  // 4. 解析 + 隔离判定
  const forwarder = bareAddress(sender) || sender.trim().slice(0, 200);
  const parsed = parseForwardedEmail({
    from: sender,
    subject,
    text: content.text,
    html: content.html,
    excludeAddresses: [...channel.allowlist, ...recipients],
    excludeDomains: [domain],
  });
  const v = buildEmailInquiry(parsed, eventId);
  const auth: AuthVerdict = parseAuthVerdict(content.headers, sender, { trustedAuthServId: deps.trustedAuthServId });
  const reasons = quarantineReasons({ sender, allowlist: channel.allowlist, auth, buyerEmail: v.email, buyerPhone: v.phone });
  const meta: Record<string, unknown> = {
    kind: "email_forward",
    messageId: str(data.message_id).slice(0, 300),
    resendEmailId: resendEmailId || null,
    receivedAt: str(data.created_at) || null,
    forwarder,
    recipient: `${channel.alias}@${domain}`,
    subject: parsed.originalSubject || subject,
    parse: {
      format: parsed.format,
      forwardFormat: parsed.forwardFormat,
      platform: parsed.platform,
      platformInquiryId: parsed.platformInquiryId || null,
      websiteInquiryId: parsed.websiteInquiryId || null,
      quantity: parsed.quantity || null,
      originalDate: parsed.originalDate || null,
      confidence: parsed.confidence,
      signals: parsed.signals,
    },
    auth,
  };

  if (reasons.length) {
    const { receipt, created } = await recordTerminalReceipt(orgId, v, "quarantined", { ...meta, quarantine: { reasons, at: now.toISOString() } }, now);
    if (created) await notifyQuarantine(orgId, receipt.id, { sender: forwarder, subject: parsed.originalSubject || subject, reasons });
    return { status: 200, body: { ok: true, outcome: "quarantined", reasons: created ? reasons : storedReasons(receipt), eventId } };
  }

  // 5. 双重入站：官网已经推送过的同一询盘
  const twin = await findWebsiteTwin(orgId, parsed, v, now);
  if (twin) {
    await recordTerminalReceipt(
      orgId,
      v,
      "duplicate",
      { ...meta, duplicate: { websiteReceiptId: twin.receipt.id, websiteEventId: twin.receipt.eventId, matchedBy: twin.matchedBy } },
      now,
      twin.receipt,
    );
    return { status: 200, body: { ok: true, outcome: "duplicate", eventId } };
  }

  // 6. 入链（deferred：请求内不跑 FDE）
  const result = await ingestWebsiteInquiry(orgId, v, {
    origin: origin(parsed.originalSubject || subject),
    fdeMode: "deferred",
    scheduleFde: deps.scheduleFde,
    receiptMeta: meta,
    now,
  });
  return ingestResponse(result, eventId);
}

function ingestResponse(result: Awaited<ReturnType<typeof ingestWebsiteInquiry>>, eventId: string): HandleInboundEmailResult {
  if (result.busy) return { status: 200, body: { ok: true, outcome: "busy", eventId } };
  // 主干没建起来：返回 5xx 让 Resend 重发；重发按收据补齐（Trade 线索不会重复建）
  if (!result.spine.ok && result.spine.code === "SPINE_FAILED") {
    return { status: 500, body: { ok: false, error: "intake incomplete, retry", eventId } };
  }
  return { status: 200, body: { ok: true, outcome: result.replay ? "replay" : "ingested", eventId } };
}
