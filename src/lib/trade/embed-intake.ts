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
import { hashClientIp, isWellFormedPublicKey, matchPublicKey, originAllowed, readWebsiteCredentials } from "./website-channel-credentials";
import type { IngestResult, NormalizedInquiry } from "./website-inquiry";
import { EMBED_INQUIRY_SOURCE } from "./website-inquiry-receipts";

export const EMBED_KEY_HEADER = "x-qingyan-form-key";
/**
 * 公开 key 也放在接口地址的查询参数里（/embed?k=qyk_…）：浏览器预检（OPTIONS）不带请求头的值，
 * 只有这样预检才能按通道判断来源。鉴权仍只认请求头 x-qingyan-form-key。
 */
export const EMBED_KEY_QUERY = "k";
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
 * 预检（OPTIONS）：按查询参数里的公开 key 定位通道，Origin 在**该通道**白名单里才回显（返回该来源），
 * 否则 null。没有 key 不回显——不能拿预检探测哪些来源登记过青砚。真正的授权在 POST 里按请求头的 key 校验。
 */
export async function preflightAllowedOrigin(origin: string | null, key: string | null): Promise<string | null> {
  if (!origin || !key) return null;
  const channel = await resolveWebsiteChannelByPublicKey(key.trim());
  return channel && originAllowed(origin, channel.allowedOrigins) ? origin : null;
}

/** 嵌入表单要求说明需求：感兴趣的产品、数量（已并入留言）、留言至少一项——主干拒收没有内容的询盘 */
export function hasInquiryContent(v: Pick<NormalizedInquiry, "message" | "product">): boolean {
  return Boolean(v.message.trim() || v.product.trim());
}

/**
 * 主干没建成时区分两种情况：
 * - 拒收（字段 / 组织配置问题，带 intakeCode 或主干自己的拒收码）：同一事件重试不会变好，不能让脚本重试；
 * - 暂时失败（抛错 / INCOMPLETE）：用同一事件 id 重试即可补齐（收据幂等）。
 */
export function isPermanentSpineRejection(spine: IngestResult["spine"]): boolean {
  if (spine.ok) return false;
  if (spine.code === "SPINE_FAILED") return "intakeCode" in spine && Boolean(spine.intakeCode);
  if (spine.code === "INCOMPLETE" || spine.code === "REPLAY") return false;
  return true;
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
