/**
 * 网站询盘通道凭证（TradeChannel(channel=website).config，无迁移）
 *
 * 两类凭证，用途不同：
 * - secret（服务端密钥）：站点**后端**调用 POST /api/trade/webhook/website 与状态接口时放在
 *   x-qingyan-webhook-secret 请求头里。不能出现在浏览器里。轮换时旧密钥在宽限期内仍可用
 *   （最近一个：secretPrev + secretPrevExpiresAt；宽限期内再次轮换时更早的旧密钥移入
 *   secretPrevOlder[{secret, expiresAt}]，各自按自己的到期时间失效，默认 72 小时），站点后端有时间换上新密钥。
 *   宽限期内最多同时保留 MAX_PREVIOUS_SECRETS 个旧密钥：再轮换会被拒绝（不挤掉站点可能仍在用的旧密钥），
 *   需要时可「立即停用旧密钥」（endSecretGraceConfig，密钥泄露时用）。
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
/** 宽限期内同时保留的旧密钥上限（含最近一个）；已满时拒绝再轮换 */
export const MAX_PREVIOUS_SECRETS = 3;
/** 来源域名白名单上限（防止把白名单当成任意来源） */
export const MAX_ALLOWED_ORIGINS = 20;

/** 接口里可以原样返回的非凭证字段；其余字符串一律只显示末 4 位 */
const NON_SECRET_CONFIG_KEYS = new Set(["allowedOrigins", "secretPrevExpiresAt", "secretRotatedAt", "secretGraceEndedAt", "publicKeyRotatedAt"]);
/** 永远不出服务端的字段 */
const SERVER_ONLY_CONFIG_KEYS = new Set(["ipSalt"]);

/** 轮换下来的旧密钥及其宽限期到期时间（ISO） */
export interface PreviousSecret {
  secret: string;
  expiresAt: string;
}

export interface WebsiteChannelCredentials {
  secret: string | null;
  secretPrev: string | null;
  secretPrevExpiresAt: string | null;
  /** 全部旧密钥（最近一个在前，含可能已过期的；判断有效用 activePreviousSecrets） */
  previousSecrets: PreviousSecret[];
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
  const secretPrev = strOrNull(c.secretPrev);
  const secretPrevExpiresAt = strOrNull(c.secretPrevExpiresAt);
  const previousSecrets: PreviousSecret[] = secretPrev ? [{ secret: secretPrev, expiresAt: secretPrevExpiresAt ?? "" }] : [];
  if (Array.isArray(c.secretPrevOlder)) {
    for (const item of c.secretPrevOlder) {
      const r = asRec(item);
      const secret = strOrNull(r.secret);
      if (secret) previousSecrets.push({ secret, expiresAt: strOrNull(r.expiresAt) ?? "" });
    }
  }
  return {
    secret: strOrNull(c.secret),
    secretPrev,
    secretPrevExpiresAt,
    previousSecrets,
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

/** 宽限期内仍有效的旧密钥（最近一个在前）；到期时间缺失 / 无法解析按已过期处理（宁可拒绝） */
export function activePreviousSecrets(config: unknown, now: Date): PreviousSecret[] {
  return readWebsiteCredentials(config).previousSecrets.filter((p) => {
    const exp = Date.parse(p.expiresAt);
    return Number.isFinite(exp) && exp > now.getTime();
  });
}

function writePreviousSecrets(c: Rec, list: PreviousSecret[]): void {
  delete c.secretPrev;
  delete c.secretPrevExpiresAt;
  delete c.secretPrevOlder;
  if (list[0]) {
    c.secretPrev = list[0].secret;
    c.secretPrevExpiresAt = list[0].expiresAt;
  }
  if (list.length > 1) c.secretPrevOlder = list.slice(1).map((p) => ({ secret: p.secret, expiresAt: p.expiresAt }));
}

/** 宽限期内旧密钥已达上限：拒绝再轮换（retryAt = 最早一个旧密钥到期、腾出名额的时间） */
export class SecretRotationLimitError extends Error {
  constructor(public retryAt: string) {
    super(`secret rotation limit reached until ${retryAt}`);
  }
}

/**
 * 轮换服务端密钥：新密钥立即生效；被换下的密钥在 graceMs 内仍被接受，
 * 此前仍在宽限期内的旧密钥保留各自的到期时间（宽限期内连续轮换不会让站点仍在用的密钥提前失效）。
 * 已过期的旧密钥在此清掉。保留数超过 MAX_PREVIOUS_SECRETS → SecretRotationLimitError（不改任何东西）。
 */
export function rotateSecretConfig(existing: unknown, now: Date, graceMs: number = SECRET_ROTATION_GRACE_MS): Rec {
  const c = ensureWebsiteCredentialConfig(existing);
  const old = strOrNull(c.secret);
  const keep = activePreviousSecrets(c, now);
  const next = old && graceMs > 0 ? [{ secret: old, expiresAt: new Date(now.getTime() + graceMs).toISOString() }, ...keep] : keep;
  if (next.length > MAX_PREVIOUS_SECRETS) {
    const earliest = Math.min(...keep.map((p) => Date.parse(p.expiresAt)));
    throw new SecretRotationLimitError(new Date(earliest).toISOString());
  }
  c.secret = generateWebsiteSecret();
  writePreviousSecrets(c, next);
  c.secretRotatedAt = now.toISOString();
  return c;
}

/** 立即停用全部旧密钥（结束宽限期；密钥泄露时用）。当前密钥不变 */
export function endSecretGraceConfig(existing: unknown, now: Date): Rec {
  const c = { ...asRec(existing) };
  writePreviousSecrets(c, []);
  c.secretGraceEndedAt = now.toISOString();
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
 * 服务端密钥比对：current = 当前密钥；previous = 某个旧密钥且仍在它自己的宽限期内；null = 不匹配。
 * 宽限期到期时间无法解析时按已过期处理（宁可拒绝）。
 */
export function matchWebsiteSecret(config: unknown, provided: string, now: Date = new Date()): "current" | "previous" | null {
  if (!provided) return null;
  const cred = readWebsiteCredentials(config);
  // 每个比较都做，耗时不随哪个命中而变
  const cur = constantTimeEquals(cred.secret, provided);
  let prev = false;
  for (const p of cred.previousSecrets) {
    const hit = constantTimeEquals(p.secret, provided);
    const exp = Date.parse(p.expiresAt);
    if (hit && Number.isFinite(exp) && exp > now.getTime()) prev = true;
  }
  if (cur) return "current";
  return prev ? "previous" : null;
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
