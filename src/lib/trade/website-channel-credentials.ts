/**
 * 网站询盘通道凭证（TradeChannel(channel=website).config，无迁移）
 *
 * 两类凭证，用途不同：
 * - secret（服务端密钥）：站点**后端**调用 POST /api/trade/webhook/website 与状态接口时放在
 *   x-qingyan-webhook-secret 请求头里。不能出现在浏览器里。轮换时旧密钥在宽限期内仍可用
 *   （secretPrev + secretPrevExpiresAt，默认 72 小时），站点后端有时间换上新密钥。
 * - publicKey（公开 key，"qyk_" + 24 随机字节 base64url）：嵌入表单脚本放在网页里，本来就是公开的；
 *   只有配合 allowedOrigins（精确的 scheme + host[:port]）与限流才有意义。轮换立即生效（滥用时用）。
 *
 * ipSalt：嵌入表单把访客 IP 做 HMAC 后存进收据（只用于限流计数），盐只在服务端，接口从不返回。
 *
 * 本文件只有纯函数（随机数生成除外），供通道服务、嵌入接口与单测共用。
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PUBLIC_KEY_PREFIX = "qyk_";
/** "qyk_" + base64url(24 字节) = 4 + 32 字符 */
export const PUBLIC_KEY_RE = /^qyk_[A-Za-z0-9_-]{32}$/;
/** 轮换服务端密钥后旧密钥仍被接受的默认时长 */
export const SECRET_ROTATION_GRACE_MS = 72 * 60 * 60 * 1000;
/** 来源域名白名单上限（防止把白名单当成任意来源） */
export const MAX_ALLOWED_ORIGINS = 20;

/** 接口里可以原样返回的非凭证字段；其余字符串一律只显示末 4 位 */
const NON_SECRET_CONFIG_KEYS = new Set(["allowedOrigins", "secretPrevExpiresAt", "secretRotatedAt", "publicKeyRotatedAt"]);
/** 永远不出服务端的字段 */
const SERVER_ONLY_CONFIG_KEYS = new Set(["ipSalt"]);

export interface WebsiteChannelCredentials {
  secret: string | null;
  secretPrev: string | null;
  secretPrevExpiresAt: string | null;
  publicKey: string | null;
  allowedOrigins: string[];
  ipSalt: string | null;
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function generateWebsiteSecret(): string {
  return randomBytes(18).toString("base64url");
}

export function generatePublicKey(): string {
  return PUBLIC_KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function generateIpSalt(): string {
  return randomBytes(16).toString("base64url");
}

export function isWellFormedPublicKey(v: unknown): v is string {
  return typeof v === "string" && PUBLIC_KEY_RE.test(v);
}

/** 读通道 config（容忍历史数据：缺字段即 null / 空数组） */
export function readWebsiteCredentials(config: unknown): WebsiteChannelCredentials {
  const c = asRec(config);
  const origins = Array.isArray(c.allowedOrigins) ? c.allowedOrigins.filter((x): x is string => typeof x === "string") : [];
  return {
    secret: strOrNull(c.secret),
    secretPrev: strOrNull(c.secretPrev),
    secretPrevExpiresAt: strOrNull(c.secretPrevExpiresAt),
    publicKey: strOrNull(c.publicKey),
    allowedOrigins: origins,
    ipSalt: strOrNull(c.ipSalt),
  };
}

/**
 * 补齐缺失的凭证，保留已有的（重复保存不让已部署的代码失效）。
 * 调用方提交的 config 不能写入任何凭证字段：这里只认既有 config。
 */
export function ensureWebsiteCredentialConfig(existing: unknown): Rec {
  const c = { ...asRec(existing) };
  if (!strOrNull(c.secret)) c.secret = generateWebsiteSecret();
  if (!isWellFormedPublicKey(c.publicKey)) c.publicKey = generatePublicKey();
  if (!strOrNull(c.ipSalt)) c.ipSalt = generateIpSalt();
  if (!Array.isArray(c.allowedOrigins)) c.allowedOrigins = [];
  return c;
}

/** 轮换服务端密钥：新密钥立即生效，旧密钥在 graceMs 内仍被接受 */
export function rotateSecretConfig(existing: unknown, now: Date, graceMs: number = SECRET_ROTATION_GRACE_MS): Rec {
  const c = ensureWebsiteCredentialConfig(existing);
  const old = strOrNull(c.secret);
  c.secret = generateWebsiteSecret();
  if (old && graceMs > 0) {
    c.secretPrev = old;
    c.secretPrevExpiresAt = new Date(now.getTime() + graceMs).toISOString();
  } else {
    delete c.secretPrev;
    delete c.secretPrevExpiresAt;
  }
  c.secretRotatedAt = now.toISOString();
  return c;
}

/** 轮换公开 key：立即生效（旧 key 嵌入的表单马上失效，滥用时用） */
export function rotatePublicKeyConfig(existing: unknown, now: Date): Rec {
  const c = ensureWebsiteCredentialConfig(existing);
  c.publicKey = generatePublicKey();
  c.publicKeyRotatedAt = now.toISOString();
  return c;
}

function constantTimeEquals(expected: string | null, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 服务端密钥比对：current = 当前密钥；previous = 轮换前的旧密钥且仍在宽限期内；null = 不匹配。
 * 宽限期到期时间无法解析时按已过期处理（宁可拒绝）。
 */
export function matchWebsiteSecret(config: unknown, provided: string, now: Date = new Date()): "current" | "previous" | null {
  if (!provided) return null;
  const cred = readWebsiteCredentials(config);
  // 两个比较都做，耗时不随哪个命中而变
  const cur = constantTimeEquals(cred.secret, provided);
  const prevMatch = constantTimeEquals(cred.secretPrev, provided);
  if (cur) return "current";
  if (prevMatch) {
    const exp = cred.secretPrevExpiresAt ? Date.parse(cred.secretPrevExpiresAt) : NaN;
    if (Number.isFinite(exp) && exp > now.getTime()) return "previous";
  }
  return null;
}

export function matchPublicKey(config: unknown, provided: string): boolean {
  if (!isWellFormedPublicKey(provided)) return false;
  return constantTimeEquals(readWebsiteCredentials(config).publicKey, provided);
}

/**
 * 来源规范化：只接受 http(s)，只要 scheme + host[:port]（默认端口省略、主机小写）。
 * 带路径（"/" 除外）、查询、片段、用户信息、通配符的都拒绝——白名单必须是精确来源。
 */
export function normalizeOrigin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 300 || raw.includes("*")) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.search || u.hash) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  if (!u.hostname) return null;
  return u.origin;
}

/** 解析白名单输入（数组或按行/逗号分隔的文本）：去重、规范化，返回无效项供界面提示 */
export function parseAllowedOrigins(input: unknown): { origins: string[]; invalid: string[] } {
  const items: string[] = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string")
    : typeof input === "string"
      ? input.split(/[\n,]+/)
      : [];
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const item of items) {
    const t = item.trim();
    if (!t) continue;
    const o = normalizeOrigin(t);
    if (!o) invalid.push(t.slice(0, 120));
    else if (!origins.includes(o)) origins.push(o);
  }
  return { origins, invalid };
}

/**
 * 请求 Origin 是否在白名单里（精确匹配 scheme + host[:port]）。
 * 浏览器发来的 Origin 已是序列化来源；"null"（沙箱 iframe / file://）与缺失一律拒绝。
 */
export function originAllowed(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin || origin === "null") return false;
  // 白名单项已按 URL.origin 规范化（主机小写、省略默认端口、无尾斜杠），与浏览器发送的 Origin 同形；
  // 不对请求值做任何宽松处理（大小写、尾斜杠、路径都视为不同来源）
  return allowed.includes(origin);
}

/** 凭证掩码：只显示末 4 位 */
export function maskCredential(v: string): string {
  return v.length > 8 ? `****${v.slice(-4)}` : "****";
}

/**
 * 通道 config 的对外视图：凭证一律只显示末 4 位，服务端专用字段（ipSalt）不出现，
 * 白名单与时间戳等非凭证字段原样返回。所有通道（WhatsApp / 微信 / 企业微信 / 网站）共用。
 */
export function maskChannelConfig(config: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(asRec(config))) {
    if (SERVER_ONLY_CONFIG_KEYS.has(key)) continue;
    if (NON_SECRET_CONFIG_KEYS.has(key)) {
      out[key] = Array.isArray(val) ? val.filter((x) => typeof x === "string") : val;
      continue;
    }
    out[key] = typeof val === "string" ? maskCredential(val) : "****";
  }
  return out;
}

/** 访客 IP 的 HMAC（只用于限流计数；盐只在服务端） */
export function hashClientIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(`embed-ip:${ip}`).digest("hex").slice(0, 32);
}
