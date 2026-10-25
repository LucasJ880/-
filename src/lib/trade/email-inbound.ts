/**
 * 邮件转发入站（PRD F1.2 / F6.3b）— Resend「email.received」事件 → 询盘链路
 *
 * 路由（/api/trade/webhook/email）先验签（email-inbound-rules.verifyResendWebhookSignature，先于任何 DB 访问），
 * 签名通过后才进入这里：
 *
 *   收件地址 inq-xxxxxxxxxx@<INBOUND_EMAIL_DOMAIN> → 按别名解析组织（服务端判定，不信任载荷里的任何 org 字段）
 *   → 同一 Message-ID 已有收据：隔离 / 重复直接返回原结论（通知按幂等键补发）；已入链的按收据重放（补缺失步骤）
 *   → 发件人（严格解析）不在转发白名单 → 隔离，不取正文、不解析（白名单外的通知按日合并）
 *   → 取正文（载荷 text/html；没有就经可注入的 fetcher 调 Resend receiving API）与原始邮件头（配置了受信 authserv-id 时）
 *   → 解析（email-forward-parse.ts）→ 隔离判定：DKIM·DMARC 未通过或没有可信结果 / 没有买家邮箱或电话
 *       → 收据 status=quarantined + 通知企业管理员；不建任何业务对象
 *   → 双重入站判定（只对官网通知 / 本厂人员与系统地址发出的邮件）：该询盘已由官网 webhook 入站
 *       （官网询盘编号 + 同一买家联系人，或 48 小时内内容孪生）→ 收据 status=duplicate，指向官网收据；不建商机；通知管理员
 *   → 其余：ingestWebsiteInquiry(origin=email_forward, fdeMode=deferred) —— 收据 source="email"、
 *       eventId="email:<Message-ID>"；请求内只做收据 → Trade → Revenue Spine，FDE 交给 after()，请求不等 LLM。
 *
 * HTTP 语义（给 Resend 重试用）：可重试的情况（正文 / 原始头取不到 502、另一次投递正在处理 409、主干建链失败 500、
 * 未预期异常 500）返回非 2xx 让 Resend 重发，重发按 Message-ID 幂等；永久性的结论（未知收件人、非 email.received 事件、
 * 隔离、重复、已入链）返回 200。
 *
 * 公开仓库：测试与注释只用虚构企业。
 */

import type { Prisma, WebsiteInquiryReceipt } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { parseForwardedEmail, senderAddress, type ParsedForwardedEmail } from "./email-forward-parse";
import {
  EMAIL_WEBSITE_TWIN_WINDOW_MS,
  QUARANTINE_REASON_LABELS,
  aliasFromRecipient,
  blankEmailInquiry,
  buildEmailInquiry,
  emailEventId,
  isAllowlistedSender,
  isWebsiteContentTwin,
  mayBeWebsiteNotification,
  normalizeInboundDomain,
  parseAuthVerdict,
  quarantineReasons,
  sameBuyerContact,
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
  /** receiving API 的 headers（Record<string,string>，同名头怎么合并未知）：只记录排障信息，不参与 DKIM/DMARC 判定 */
  headers: unknown;
  /** 原始邮件（raw MIME）第一个空行之前的头块：DKIM/DMARC 判定只看这里（顺序可靠） */
  rawHeaders?: string | null;
}

export interface InboundEmailFetchOptions {
  /** 需要原始邮件头（配置了受信 authserv-id 时才取；否则判定必然是 missing，不必下载） */
  rawHeaders: boolean;
}

export type InboundEmailFetcher = (resendEmailId: string, opts: InboundEmailFetchOptions) => Promise<InboundEmailContent>;

export class InboundEmailFetchError extends Error {}

const RAW_HEADER_CHARS_MAX = 256 * 1024;
const RAW_FETCH_TIMEOUT_MS = 10_000;

/** 只读原始邮件的头块：读到第一个空行（或 256 KB）就停，不下载正文与附件 */
async function readRawHeaderBlock(url: string): Promise<string> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new InboundEmailFetchError("原始邮件下载地址无效");
  }
  if (target.protocol !== "https:") throw new InboundEmailFetchError("原始邮件下载地址不是 https");
  const res = await fetch(target, { signal: AbortSignal.timeout(RAW_FETCH_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new InboundEmailFetchError(`读取原始邮件失败：HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let acc = "";
  try {
    while (acc.length < RAW_HEADER_CHARS_MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      const from = Math.max(0, acc.length - 3);
      acc += decoder.decode(value, { stream: true });
      const end = /\r?\n\r?\n/.exec(acc.slice(from));
      if (end) return acc.slice(0, from + end.index);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return acc.slice(0, RAW_HEADER_CHARS_MAX);
}

/**
 * 默认 fetcher：Resend receiving API（GET /emails/receiving/{id}），需 RESEND_API_KEY；
 * 需要时再按 raw.download_url 读原始邮件头块。原始邮件下载失败抛错（502，Resend 稍后重试）；
 * 接口根本不给 raw 时 rawHeaders=null（DKIM/DMARC 判定为 missing → 隔离）。
 */
export const fetchInboundEmailFromResend: InboundEmailFetcher = async (resendEmailId, opts) => {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new InboundEmailFetchError("RESEND_API_KEY 未配置，无法读取入站邮件正文");
  const { Resend } = await import("resend");
  const res = await new Resend(key).emails.receiving.get(resendEmailId);
  if (res.error || !res.data) throw new InboundEmailFetchError(`读取入站邮件失败：${res.error?.message ?? "empty response"}`);
  const rawUrl = res.data.raw?.download_url ?? null;
  const rawHeaders = opts.rawHeaders && rawUrl ? await readRawHeaderBlock(rawUrl) : null;
  return { text: res.data.text ?? null, html: res.data.html ?? null, headers: res.data.headers ?? null, rawHeaders };
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
  /**
   * 受信的 authserv-id（INBOUND_EMAIL_AUTHSERV_ID）：只认原始邮件头最上面一条、由它写入的 Authentication-Results。
   * 未配置 → DKIM/DMARC 判定一律 missing，所有转发都按 auth_unverified 隔离（fail closed）。
   */
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

const metaStr = (meta: Record<string, unknown>, k: string): string => (typeof meta[k] === "string" ? (meta[k] as string) : "");

/** 企业 owner / 管理员；没有管理员成员时用组织 owner */
async function orgAdminIds(orgId: string): Promise<string[]> {
  const admins = await db.organizationMember.findMany({
    where: { orgId, status: "active", role: { in: ["org_owner", "org_admin"] }, user: { status: "active" } },
    select: { userId: true },
  });
  if (admins.length) return admins.map((m) => m.userId);
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
  return org?.ownerId ? [org.ownerId] : [];
}

/** 白名单以外发件人的隔离通知按「组织 + UTC 日」合并：泄露的地址被灌垃圾邮件时，管理员每天最多收到一条 */
export function senderQuarantineNotifyKey(orgId: string, now: Date): string {
  return `email-quarantine:sender:${orgId}:${now.toISOString().slice(0, 10)}`;
}

/**
 * 隔离通知（站内，type=system）。幂等：键记在收据 meta 里，Resend 重试（包括首次通知失败后的重试）按同一键补发、不重复。
 *   - 白名单以外的发件人（多为垃圾邮件）：按日合并，普通优先级；
 *   - 白名单发件人但验证未通过 / 识别不出买家（可能是真实询盘卡住了）：逐封、高优先级。
 */
async function notifyQuarantine(orgId: string, receipt: Pick<WebsiteInquiryReceipt, "id" | "payload">): Promise<number> {
  const userIds = await orgAdminIds(orgId);
  if (!userIds.length) return 0;
  const meta = receiptMeta(receipt);
  const q = (meta.quarantine ?? {}) as { notifyKey?: unknown };
  const aggregateKey = typeof q.notifyKey === "string" && q.notifyKey ? q.notifyKey : null;
  const reasons = storedReasons(receipt);
  const sender = metaStr(meta, "forwarder") || "未知";
  const subject = (metaStr(meta, "subject") || "（无主题）").slice(0, 60);
  const why = reasons.map((r) => QUARANTINE_REASON_LABELS[r]).join("；");
  return createNotificationsForUsers(userIds, {
    type: "system",
    title: aggregateKey ? "今天有邮件因发件人不在转发白名单被隔离" : `邮件转发询盘已隔离：${subject}`,
    summary: (aggregateKey
      ? `首封：发件人 ${sender}，主题「${subject}」。当天之后的同类邮件不再逐条通知。若是本企业业务员，请把其邮箱加入转发白名单后让其重新转发；陌生发件人可忽略。`
      : `转发人 ${sender}。原因：${why}。未建线索 / 商机；确认来源可信后请让业务员重新转发，或直接录入询盘。`
    ).slice(0, 300),
    orgId,
    entityType: "website_inquiry_receipt",
    entityId: receipt.id,
    priority: aggregateKey ? "medium" : "high",
    metadata: { receiptId: receipt.id, source: EMAIL_FORWARD_SOURCE, reasons },
    sourceKeyPrefix: aggregateKey ?? `email-quarantine:${receipt.id}`,
  });
}

/** 判为双重入站时告诉管理员（误判时可见、可补救）；幂等键按收据 */
async function notifyDuplicate(orgId: string, receipt: Pick<WebsiteInquiryReceipt, "id" | "payload">): Promise<number> {
  const userIds = await orgAdminIds(orgId);
  if (!userIds.length) return 0;
  const meta = receiptMeta(receipt);
  const dup = (meta.duplicate ?? {}) as { websiteEventId?: unknown; matchedBy?: unknown };
  const websiteEventId = typeof dup.websiteEventId === "string" ? dup.websiteEventId : "";
  return createNotificationsForUsers(userIds, {
    type: "system",
    title: `转发的询盘与官网询盘重复：${(metaStr(meta, "subject") || "（无主题）").slice(0, 60)}`,
    summary: `转发人 ${metaStr(meta, "forwarder") || "未知"}。与官网已入站的询盘${websiteEventId ? `（编号 ${websiteEventId.slice(0, 60)}）` : ""}是同一条，已关联到原商机，未新建线索 / 商机。如判断有误（其实是新询盘），请把买家原邮件直接转发或手工录入。`.slice(0, 300),
    orgId,
    entityType: "website_inquiry_receipt",
    entityId: receipt.id,
    priority: "medium",
    metadata: { receiptId: receipt.id, source: EMAIL_FORWARD_SOURCE, matchedBy: typeof dup.matchedBy === "string" ? dup.matchedBy : null },
    sourceKeyPrefix: `email-duplicate:${receipt.id}`,
  });
}

// ── 双重入站（官网通知被转发） ──────────────────────────────────────────────

type WebsiteTwin = { receipt: Pick<WebsiteInquiryReceipt, "id" | "eventId" | "prospectId" | "customerId" | "opportunityId">; matchedBy: "website_inquiry_id" | "content_twin" };

/**
 * 只在 mayBeWebsiteNotification(parsed) 时调用（官网通知格式，或本厂人员 / 系统地址发出的邮件）。
 *   - 按官网询盘编号：同组织 source=website 收据，且买家联系人（邮箱或电话）与该收据一致；
 *   - 内容孪生：48 小时内同联系人、且官网留言（≥ 20 字符）整段 / 80% 词出现在转发全文里。
 */
async function findWebsiteTwin(orgId: string, parsed: ParsedForwardedEmail, v: NormalizedInquiry, now: Date): Promise<WebsiteTwin | null> {
  if (!v.email && !v.phone) return null;
  if (parsed.websiteInquiryId && parsed.senderKind !== "buyer") {
    const byId = await findReceiptByEventId(orgId, parsed.websiteInquiryId, WEBSITE_INQUIRY_SOURCE);
    if (byId && sameBuyerContact(fromReceiptPayload(byId.payload), { email: v.email, phone: v.phone })) {
      return { receipt: byId, matchedBy: "website_inquiry_id" };
    }
  }
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

async function quarantine(
  orgId: string,
  v: NormalizedInquiry,
  reasons: QuarantineReason[],
  meta: Record<string, unknown>,
  now: Date,
  notifyKey: string | null,
): Promise<HandleInboundEmailResult> {
  const { receipt, created } = await recordTerminalReceipt(orgId, v, "quarantined", { ...meta, quarantine: { reasons, at: now.toISOString(), notifyKey } }, now);
  await notifyQuarantine(orgId, receipt);
  return { status: 200, body: { ok: true, outcome: "quarantined", reasons: created ? reasons : storedReasons(receipt), eventId: v.eventId } };
}

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
  const trustedAuthServId = (deps.trustedAuthServId ?? "").trim() || null;
  const forwarder = senderAddress(sender) || sender.trim().slice(0, 200);
  const baseMeta: Record<string, unknown> = {
    kind: "email_forward",
    messageId: str(data.message_id).slice(0, 300),
    resendEmailId: resendEmailId || null,
    receivedAt: str(data.created_at) || null,
    forwarder,
    recipient: `${channel.alias}@${domain}`,
    subject,
  };

  // 2. 同一封邮件再次送达（Resend 重试）：隔离 / 重复返回原结论（通知按幂等键补发）；已入链的按首次载荷重放
  const existing = await findReceiptByEventId(orgId, eventId, EMAIL_FORWARD_SOURCE);
  if (existing?.status === "quarantined") {
    await notifyQuarantine(orgId, existing);
    return { status: 200, body: { ok: true, outcome: "quarantined", reasons: storedReasons(existing), eventId } };
  }
  if (existing?.status === "duplicate") {
    await notifyDuplicate(orgId, existing);
    return { status: 200, body: { ok: true, outcome: "duplicate", eventId } };
  }
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

  // 3. 白名单只需要信封里的 from：不在白名单 → 不取正文、不解析，直接隔离（垃圾邮件不触发 Resend API 调用与解析）
  if (!isAllowlistedSender(sender, channel.allowlist)) {
    return quarantine(orgId, blankEmailInquiry(eventId), ["sender_not_allowed"], { ...baseMeta, parse: null, auth: null }, now, senderQuarantineNotifyKey(orgId, now));
  }

  // 4. 正文：载荷里有就用，没有就经 fetcher 取；配置了受信 authserv-id 时同时取原始邮件头（失败 → 502，Resend 重试）
  let content: InboundEmailContent = { text: str(data.text) || null, html: str(data.html) || null, headers: data.headers ?? null, rawHeaders: null };
  const needBody = !content.text && !content.html;
  const needRaw = !!trustedAuthServId;
  if (needBody && !resendEmailId) return ignored("missing_email_id");
  if ((needBody || needRaw) && resendEmailId) {
    try {
      const fetched = await (deps.fetchEmail ?? fetcherOverrideForTest ?? fetchInboundEmailFromResend)(resendEmailId, { rawHeaders: needRaw });
      content = {
        text: needBody ? fetched.text : content.text,
        html: needBody ? fetched.html : content.html,
        headers: content.headers ?? fetched.headers,
        rawHeaders: fetched.rawHeaders ?? null,
      };
    } catch (err) {
      logger.warn("trade.inbound.email_body_fetch_failed", { orgId, error: err instanceof Error ? err.message : String(err) });
      return { status: 502, body: { ok: false, error: "email body unavailable" } };
    }
  }

  // 5. 解析 + 隔离判定
  const parsed = parseForwardedEmail({
    from: sender,
    subject,
    text: content.text,
    html: content.html,
    excludeAddresses: [...channel.allowlist, ...recipients],
    excludeDomains: [domain],
  });
  const v = buildEmailInquiry(parsed, eventId);
  const auth: AuthVerdict = parseAuthVerdict({ rawHeaders: content.rawHeaders, headers: content.headers }, sender, { trustedAuthServId });
  const reasons = quarantineReasons({ sender, allowlist: channel.allowlist, auth, buyerEmail: v.email, buyerPhone: v.phone });
  const meta: Record<string, unknown> = {
    ...baseMeta,
    subject: parsed.originalSubject || subject,
    parse: {
      format: parsed.format,
      forwardFormat: parsed.forwardFormat,
      platform: parsed.platform,
      senderKind: parsed.senderKind,
      platformInquiryId: parsed.platformInquiryId || null,
      websiteInquiryId: parsed.websiteInquiryId || null,
      quantity: parsed.quantity || null,
      originalDate: parsed.originalDate || null,
      confidence: parsed.confidence,
      signals: parsed.signals,
    },
    auth,
  };

  if (reasons.length) return quarantine(orgId, v, reasons, meta, now, null);

  // 6. 双重入站：只对官网通知 / 本厂人员与系统地址发出的邮件判定（买家来信、平台通知永远不会被记为重复）
  const twin = mayBeWebsiteNotification(parsed) ? await findWebsiteTwin(orgId, parsed, v, now) : null;
  if (twin) {
    const { receipt } = await recordTerminalReceipt(
      orgId,
      v,
      "duplicate",
      { ...meta, duplicate: { websiteReceiptId: twin.receipt.id, websiteEventId: twin.receipt.eventId, matchedBy: twin.matchedBy } },
      now,
      twin.receipt,
    );
    await notifyDuplicate(orgId, receipt);
    return { status: 200, body: { ok: true, outcome: "duplicate", eventId } };
  }

  // 7. 入链（deferred：请求内不跑 FDE）
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
  // 同一封邮件的另一次投递正在处理：返回 409 让 Resend 稍后重试（重试时按收据补齐）。若返回 200，
  // 首次处理之后失败就再也没人重试（邮件收据没有网站那样的重同步入口）
  if (result.busy) return { status: 409, body: { ok: false, outcome: "busy", eventId } };
  // 主干没建起来：返回 5xx 让 Resend 重发；重发按收据补齐（Trade 线索不会重复建）
  if (!result.spine.ok && result.spine.code === "SPINE_FAILED") {
    return { status: 500, body: { ok: false, error: "intake incomplete, retry", eventId } };
  }
  return { status: 200, body: { ok: true, outcome: result.replay ? "replay" : "ingested", eventId } };
}
