/**
 * 嵌入表单接入（PRD F1.1）— POST /api/trade/webhook/website/embed 的服务端部分：按公开 key 定位通道、预检来源、
 * 载荷白名单与事件 id（emb:<浏览器 uuid>）、限流。也放 website 通道的共用读取（按凭证定位通道、读表单载荷）。
 * 契约见 docs/QINGYAN_INTAKE_WEBHOOK.md §3。
 */

import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
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

/**
 * 限流（公开 key 写在网页里、Origin 可被非浏览器伪造，挡滥用的是限流）。权威计数来自数据库：本组织 source=embed 的收据
 * （每个新事件一张，访客 IP 的 HMAC 在载荷 meta.ipHash）。先查后写：大量同时到达的新事件可能略超上限（见文档 §3.4）。
 */
export interface EmbedRateLimits {
  /** 每访客 IP（HMAC）窗口内最多新事件数 */
  perIp: number;
  perIpWindowMs: number;
  /** 每组织 1 小时 / 24 小时内最多新事件数 */
  perOrgHour: number;
  perOrgDay: number;
}

export const EMBED_RATE_LIMITS: EmbedRateLimits = { perIp: 5, perIpWindowMs: 10 * 60 * 1000, perOrgHour: 40, perOrgDay: 300 };
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** 前置粗筛（checkRateLimitAsync：配了 Upstash 走 Redis，否则内存）：每通道 × 每访客 IP 10 分钟内的请求次数（含无效请求、蜜罐、重发） */
export const EMBED_ATTEMPT_LIMIT = { name: "trade-embed-attempts", windowMs: 10 * 60 * 1000, maxRequests: 30 } as const;

export interface EmbedSubmissionCounts {
  ipWindow: number;
  orgHour: number;
  orgDay: number;
}

export type EmbedRateDecision =
  | { allowed: true }
  | { allowed: false; reason: "ip" | "org_hour" | "org_day"; retryAfterSec: number };

/** 纯函数：计数 ≥ 上限即拒绝；先 IP（最具体），再组织小时、组织日；retryAfterSec 取对应窗口长度（保守值） */
export function decideEmbedRateLimit(counts: EmbedSubmissionCounts, limits: EmbedRateLimits = EMBED_RATE_LIMITS): EmbedRateDecision {
  const checks = [
    ["ip", counts.ipWindow, limits.perIp, limits.perIpWindowMs],
    ["org_hour", counts.orgHour, limits.perOrgHour, HOUR_MS],
    ["org_day", counts.orgDay, limits.perOrgDay, DAY_MS],
  ] as const;
  for (const [reason, count, max, windowMs] of checks) {
    if (count >= max) return { allowed: false, reason, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  return { allowed: true };
}

export interface EmbedChannel {
  id: string;
  orgId: string;
  allowedOrigins: string[];
  ipSalt: string;
}

/** 在 active 的 website 通道里找 config 匹配的第一条（每 org 一条，行数极少）；逐条都比较，耗时不随命中位置变化 */
export async function findActiveWebsiteChannel(match: (config: unknown) => boolean) {
  const channels = await db.tradeChannel.findMany({
    where: { channel: "website", status: "active" },
    select: { id: true, orgId: true, config: true },
  });
  let found: (typeof channels)[number] | null = null;
  for (const ch of channels) {
    if (match(ch.config) && !found) found = ch;
  }
  return found;
}

/** 表单载荷：JSON 对象，或 form-urlencoded / multipart 的字符串字段；其余（非对象 JSON、解析失败、其它类型）为 null */
export async function readInquiryPayload(request: Request): Promise<Record<string, unknown> | null> {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  }
  // 非表单类型的 formData() 会抛错 → null
  const form = await request.formData().catch(() => null);
  if (!form) return null;
  const out: Record<string, unknown> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

/** 按公开 key 定位 website 通道（只认 active 通道） */
export async function resolveWebsiteChannelByPublicKey(key: string): Promise<EmbedChannel | null> {
  if (!isWellFormedPublicKey(key)) return null;
  const found = await findActiveWebsiteChannel((c) => matchPublicKey(c, key));
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
