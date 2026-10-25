/**
 * 嵌入表单接入（PRD F1.1）— POST /api/trade/webhook/website/embed 的服务端部分
 *
 * 与站点后端转发（POST /api/trade/webhook/website，带服务端密钥）的区别：
 * - 浏览器直接提交，凭证是公开 key（x-qingyan-form-key）+ Origin 精确匹配通道的 allowedOrigins；
 * - 限流（数据库计数，见 embed-rate-limit.ts），访客 IP 只以 HMAC 存进收据载荷 meta.ipHash；
 * - 事件 id = emb:<浏览器生成的 uuid>，收据来源 embed（与站点转发的事件身份空间分开）；
 * - 响应只有 { ok, receiptId }：不返回线索 / 商机 / 是否重复等内部信息，防枚举。
 * 入站链路与站点转发相同：ingestWebsiteInquiry(..., { origin: { kind: "embed" }, fdeMode: "deferred" })，请求里没有 LLM。
 */

import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { DAY_MS, EMBED_RATE_LIMITS, HOUR_MS, type EmbedRateLimits, type EmbedSubmissionCounts } from "./embed-rate-limit";
import { hashClientIp, isWellFormedPublicKey, matchPublicKey, readWebsiteCredentials } from "./website-channel-credentials";
import { EMBED_INQUIRY_SOURCE } from "./website-inquiry-receipts";

export const EMBED_KEY_HEADER = "x-qingyan-form-key";
export const EMBED_EVENT_PREFIX = "emb:";
/** 请求体上限（表单字段总和远小于此；超出直接 413，不解析） */
export const EMBED_MAX_BODY_BYTES = 32 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmbedChannel {
  id: string;
  orgId: string;
  allowedOrigins: string[];
  ipSalt: string;
}

/** 按公开 key 定位 website 通道（行数极少，逐条恒时比较；只认 active 通道） */
export async function resolveWebsiteChannelByPublicKey(key: string): Promise<EmbedChannel | null> {
  if (!isWellFormedPublicKey(key)) return null;
  const channels = await db.tradeChannel.findMany({
    where: { channel: "website", status: "active" },
    select: { id: true, orgId: true, config: true },
  });
  let found: (typeof channels)[number] | null = null;
  for (const ch of channels) {
    if (matchPublicKey(ch.config, key) && !found) found = ch;
  }
  if (!found) return null;
  const cred = readWebsiteCredentials(found.config);
  return {
    id: found.id,
    orgId: found.orgId,
    allowedOrigins: cred.allowedOrigins,
    // 盐与公开 key 同时生成；历史数据缺盐时退回服务端密钥（同样不出服务端）
    ipSalt: cred.ipSalt ?? cred.secret ?? found.id,
  };
}

/**
 * 预检（OPTIONS）用：浏览器预检不带 key 的值，无法定位通道，所以只判断该来源是否在
 * 任一已启用嵌入表单的通道白名单里。真正的授权在 POST 里按 key 定位通道后精确匹配。
 */
export async function isOriginRegisteredForEmbed(origin: string | null): Promise<boolean> {
  if (!origin || origin === "null") return false;
  const channels = await db.tradeChannel.findMany({
    where: { channel: "website", status: "active" },
    select: { config: true },
  });
  return channels.some((ch) => {
    const cred = readWebsiteCredentials(ch.config);
    return isWellFormedPublicKey(cred.publicKey) && cred.allowedOrigins.includes(origin);
  });
}

/** 访客 IP：Vercel 覆盖写入 x-forwarded-for（首个即客户端），其次 x-real-ip */
export function clientIpFrom(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function embedIpHash(headers: Headers, channel: Pick<EmbedChannel, "ipSalt">): string {
  return hashClientIp(clientIpFrom(headers), channel.ipSalt);
}

/** 权威计数：本组织 source=embed 的收据（每个新事件一张；重发不新增） */
export async function countEmbedSubmissions(
  orgId: string,
  ipHash: string,
  now: Date = new Date(),
  limits: EmbedRateLimits = EMBED_RATE_LIMITS,
): Promise<EmbedSubmissionCounts> {
  const base = { orgId, source: EMBED_INQUIRY_SOURCE };
  const [ipWindow, orgHour, orgDay] = await Promise.all([
    db.websiteInquiryReceipt.count({
      where: {
        ...base,
        firstSeenAt: { gte: new Date(now.getTime() - limits.perIpWindowMs) },
        payload: { path: ["meta", "ipHash"], equals: ipHash },
      },
    }),
    db.websiteInquiryReceipt.count({ where: { ...base, firstSeenAt: { gte: new Date(now.getTime() - HOUR_MS) } } }),
    db.websiteInquiryReceipt.count({ where: { ...base, firstSeenAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
  ]);
  return { ipWindow, orgHour, orgDay };
}

/** 事件 id：浏览器生成的 uuid（同一次填写重试时不变 → 幂等）；缺失或格式不对时服务端生成（不幂等） */
export function embedEventId(clientId: unknown): string {
  const id = typeof clientId === "string" ? clientId.trim() : "";
  return EMBED_EVENT_PREFIX + (UUID_RE.test(id) ? id.toLowerCase() : randomUUID());
}

function field(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "";
}

/**
 * 嵌入表单载荷 → normalizeInquiry 的输入：只取表单字段（白名单），数量并入留言
 * （NormalizedInquiry 没有数量字段，业务指纹不变），事件 id 由服务端加前缀。
 */
export function toEmbedInquiryRaw(payload: Record<string, unknown>): Record<string, unknown> {
  const quantity = field(payload, "quantity").replace(/\s+/g, " ").trim().slice(0, 120);
  const message = field(payload, "message");
  const raw: Record<string, unknown> = {
    name: field(payload, "name"),
    email: field(payload, "email"),
    phone: field(payload, "phone"),
    company: field(payload, "company"),
    country: field(payload, "country"),
    product: field(payload, "product"),
    message: quantity ? `Quantity: ${quantity}${message.trim() ? ` — ${message}` : ""}` : message,
    page: field(payload, "page"),
    referrer: field(payload, "referrer"),
    landing: field(payload, "landing"),
    eventId: embedEventId(payload.eventId),
    // 蜜罐字段原样交给 normalizeInquiry 判定
    _hp: field(payload, "_hp"),
    website_url: field(payload, "website_url"),
  };
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) raw[k] = field(payload, k);
  return raw;
}

/** 蜜罐命中时回给机器人的假收据 id（形似 cuid，不对应任何记录） */
export function decoyReceiptId(): string {
  return `c${randomBytes(12).toString("hex")}`;
}
