/**
 * 邮件转发入站（PRD F1.2）— 纯规则：验签、别名、白名单、DKIM/DMARC 判定、隔离原因、官网询盘孪生判定
 *
 * 不访问 DB。验签用已安装的 resend SDK（内部是 Svix：HMAC-SHA256 + 时间戳 5 分钟容差），
 * 在路由里先于任何 DB 访问执行。
 *
 * 公开仓库：测试与注释只用虚构企业。
 */

import { createHash } from "node:crypto";
import { Resend } from "resend";
import type { NormalizedInquiry } from "./website-inquiry";
import { bareAddress, cleanPhone, senderAddress, type ParsedForwardedEmail } from "./email-forward-parse";

// ── 验签 ────────────────────────────────────────────────────────────────────

export type ResendSignatureFailure = "secret_misconfigured" | "missing_headers" | "expired" | "invalid_signature" | "invalid_payload";

export type ResendSignatureResult = { ok: true; event: unknown } | { ok: false; reason: ResendSignatureFailure };

export interface SvixHeaders {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
}

/** Resend / Svix 签名密钥：whsec_ + base64（Svix 解码失败会抛错，先在这里判定为配置错误） */
const WEBHOOK_SECRET_RE = /^(whsec_)?[A-Za-z0-9+/]{16,}={0,2}$/;

let verifierClient: Resend | null = null;
function verifier(): Resend {
  // 只用 webhooks.verify（本地计算，不发网络请求）；SDK 构造要求一个 key，给占位值
  if (!verifierClient) verifierClient = new Resend("re_inbound_signature_verify_only");
  return verifierClient;
}

/**
 * 校验 Resend 入站 webhook 签名（svix-id / svix-timestamp / svix-signature）。
 * 过期 = 时间戳与当前相差超过 5 分钟（Svix 容差，双向）。签名通过才返回解析后的事件。
 */
export function verifyResendWebhookSignature(rawBody: string, headers: SvixHeaders, secret: string): ResendSignatureResult {
  const key = (secret ?? "").trim();
  if (!WEBHOOK_SECRET_RE.test(key)) return { ok: false, reason: "secret_misconfigured" };
  const id = headers.id?.trim();
  const timestamp = headers.timestamp?.trim();
  const signature = headers.signature?.trim();
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  try {
    const event = verifier().webhooks.verify({ payload: rawBody, headers: { id, timestamp, signature }, webhookSecret: key });
    return { ok: true, event };
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, reason: "invalid_payload" };
    const msg = err instanceof Error ? err.message : String(err);
    if (/timestamp too (old|new)/i.test(msg)) return { ok: false, reason: "expired" };
    if (/missing required headers|invalid signature headers/i.test(msg)) return { ok: false, reason: "missing_headers" };
    if (/base64|secret/i.test(msg) && !/signature/i.test(msg)) return { ok: false, reason: "secret_misconfigured" };
    return { ok: false, reason: "invalid_signature" };
  }
}

// ── 别名与地址 ──────────────────────────────────────────────────────────────

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const INBOUND_ALIAS_RE = /^inq-[a-z2-7]{10}$/;

/** 询盘邮箱别名：inq- + 10 位 base32（随机源可注入以便测试；与组织 code 无关） */
export function formatInboundAlias(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new Error("need 10 random bytes");
  let out = "";
  for (let i = 0; i < 10; i++) out += BASE32_ALPHABET[bytes[i] & 31];
  return `inq-${out}`;
}

/** INBOUND_EMAIL_DOMAIN 归一（去空白、去前导 @、小写）；未配置返回 null（页面显示「未开通」） */
export function normalizeInboundDomain(raw: string | null | undefined): string | null {
  const d = (raw ?? "").trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? d : null;
}

/** 展示用转发地址；域名未配置或别名无效时不生成地址 */
export function inboundAddressFor(alias: unknown, domainRaw: string | null | undefined): string | null {
  const domain = normalizeInboundDomain(domainRaw);
  if (!domain || typeof alias !== "string" || !INBOUND_ALIAS_RE.test(alias)) return null;
  return `${alias}@${domain}`;
}

/** 收件地址 → 别名：域名必须等于收信域名；去掉 +tag；不是 inq- 别名返回 null */
export function aliasFromRecipient(recipient: string, domainRaw: string | null | undefined): string | null {
  const domain = normalizeInboundDomain(domainRaw);
  const addr = bareAddress(recipient);
  if (!domain || !addr) return null;
  const at = addr.lastIndexOf("@");
  if (addr.slice(at + 1) !== domain) return null;
  const local = addr.slice(0, at).split("+")[0];
  return INBOUND_ALIAS_RE.test(local) ? local : null;
}

// ── 转发白名单 ──────────────────────────────────────────────────────────────

export const FORWARDER_ALLOWLIST_MAX = 50;
const ALLOWLIST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 白名单输入：字符串（逗号 / 分号 / 空白 / 换行分隔）或字符串数组 → 小写去重的地址列表 */
export function normalizeForwarderAllowlist(input: unknown): { ok: true; value: string[] } | { ok: false; invalid: string[]; error: string } {
  const raw: string[] = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string")
    : typeof input === "string"
      ? // 逗号 / 分号 / 换行分隔；「Name <addr>」整段保留，其余再按空白拆
        input.split(/[\r\n,;，；]+/).flatMap((p) => (/<[^<>]+>/.test(p) ? [p] : p.split(/\s+/)))
      : input === undefined || input === null
        ? []
        : ["<invalid>"];
  const invalid: string[] = [];
  const out: string[] = [];
  for (const item of raw) {
    const t = item.trim();
    if (!t) continue;
    const addr = bareAddress(t) || t.toLowerCase();
    if (!ALLOWLIST_EMAIL_RE.test(addr) || addr.length > 200) {
      invalid.push(t.slice(0, 80));
      continue;
    }
    if (!out.includes(addr)) out.push(addr);
  }
  if (invalid.length) return { ok: false, invalid, error: "转发白名单里有无效的邮箱地址" };
  if (out.length > FORWARDER_ALLOWLIST_MAX) return { ok: false, invalid: [], error: `转发白名单最多 ${FORWARDER_ALLOWLIST_MAX} 个邮箱` };
  return { ok: true, value: out };
}

/** 通道 config 里的白名单（容错读取：非数组 / 非字符串项忽略） */
export function readForwarderAllowlist(config: unknown): string[] {
  const list = (config as { forwarderAllowlist?: unknown } | null)?.forwarderAllowlist;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

// ── DKIM / DMARC 判定 ───────────────────────────────────────────────────────

export type AuthNote =
  /** 未配置 INBOUND_EMAIL_AUTHSERV_ID：不知道哪条 Authentication-Results 是收信方写的，一律不信 */
  | "authserv_id_not_configured"
  /** 没拿到原始邮件头（Resend receiving API 没给 raw.download_url，或载荷自带正文时没取） */
  | "raw_headers_unavailable"
  | "no_authentication_results"
  /** 最上面一条 Authentication-Results 不是受信 authserv-id 写的 */
  | "topmost_not_trusted";

export interface AuthVerdict {
  /** pass = DMARC 通过或与发件域对齐的 DKIM 通过；fail = 有失败结果且无通过；missing = 没有可信的验证结果 */
  verdict: "pass" | "fail" | "missing";
  dkim: string | null;
  dkimDomain: string | null;
  spf: string | null;
  dmarc: string | null;
  authServId: string | null;
  /** 判定依据：raw = 原始邮件头里最上面一条；null = 没有可信来源（verdict 必为 missing） */
  source: "raw" | null;
  note: AuthNote | null;
  /** 看到的所有 Authentication-Results 的 authserv-id（按出现顺序，排障用：运维据此确定 INBOUND_EMAIL_AUTHSERV_ID） */
  seenAuthServIds: string[];
}

const RAW_HEADERS_MAX = 256 * 1024;

/** 原始邮件（RFC 5322）头块 → [{name, value}]，保持顺序；折行续接；遇到空行（头块结束）停止 */
export function headerFieldsFromRaw(raw: string | null | undefined): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  if (!raw) return out;
  let cur: { name: string; value: string } | null = null;
  for (const line of raw.slice(0, RAW_HEADERS_MAX).split(/\r?\n/)) {
    if (!line) break;
    if (/^[ \t]/.test(line)) {
      if (cur) cur.value = `${cur.value} ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i <= 0) {
      cur = null;
      continue;
    }
    cur = { name: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() };
    out.push(cur);
  }
  return out;
}

function authServIdOf(value: string): string {
  return ((value.split(";")[0] ?? "").trim().split(/\s+/)[0] ?? "").toLowerCase();
}

function headerValues(headers: unknown, name: string): string[] {
  const want = name.toLowerCase();
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
  };
  if (Array.isArray(headers)) {
    for (const h of headers) {
      const n = (h as { name?: unknown; key?: unknown })?.name ?? (h as { key?: unknown })?.key;
      if (typeof n === "string" && n.toLowerCase() === want) push((h as { value?: unknown }).value);
    }
  } else if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) if (k.toLowerCase() === want) push(v);
  }
  return out;
}

function aligned(senderDomain: string, d: string): boolean {
  const a = senderDomain.toLowerCase();
  const b = d.toLowerCase().replace(/^@/, "");
  return !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

/**
 * 判定发件人（转发人）地址是否可信：只看**原始邮件头**（raw MIME，顺序可靠）里**最上面一条**
 * Authentication-Results（= 最后一跳收信方写入），并且它必须由受信的 authserv-id（INBOUND_EMAIL_AUTHSERV_ID）写入。
 * 失败即关闭（fail closed）：
 *   - 未配置受信 authserv-id → missing（发件方可以自己写一条 Authentication-Results，不知道哪条可信就都不信）；
 *   - 没有原始头 → missing（Resend receiving API 的 headers 是 Record<string,string>，同名头怎么合并未知，
 *     可能留下发件方伪造的那条，所以只用来记录排障信息，不参与判定）；
 *   - 最上面一条不是受信 authserv-id 写的 → missing。
 * 前提（上线前用真实邮件确认，见 docs/QINGYAN_EMAIL_FORWARD_INTAKE.md）：Resend 的收信 MTA 会在最上面写入自己的
 * Authentication-Results。发件方伪造的同名头只会出现在它下面。
 */
export function parseAuthVerdict(
  source: { rawHeaders?: string | null; headers?: unknown },
  sender: string,
  opts?: { trustedAuthServId?: string | null },
): AuthVerdict {
  const rawValues = headerFieldsFromRaw(source.rawHeaders)
    .filter((h) => h.name === "authentication-results")
    .map((h) => h.value);
  const seenAuthServIds = (rawValues.length ? rawValues : headerValues(source.headers, "authentication-results")).map(authServIdOf).filter(Boolean).slice(0, 10);
  const none = (note: AuthNote): AuthVerdict => ({
    verdict: "missing",
    dkim: null,
    dkimDomain: null,
    spf: null,
    dmarc: null,
    authServId: null,
    source: null,
    note,
    seenAuthServIds,
  });
  const senderDomain = senderAddress(sender).split("@")[1] ?? "";
  const trusted = (opts?.trustedAuthServId ?? "").trim().toLowerCase();
  if (!trusted) return none("authserv_id_not_configured");
  if (!source.rawHeaders?.trim()) return none("raw_headers_unavailable");
  const pick = rawValues[0];
  if (!pick) return none("no_authentication_results");
  const topId = authServIdOf(pick);
  if (!(topId === trusted || topId.endsWith(`.${trusted}`))) return none("topmost_not_trusted");
  const authServId = (pick.split(";")[0] ?? "").trim().split(/\s+/)[0] ?? null;
  const dkimResults: Array<{ result: string; d: string | null }> = [];
  let spf: string | null = null;
  let dmarc: string | null = null;
  let dmarcFrom: string | null = null;
  for (const part of pick.split(";").slice(1)) {
    const m = part.trim().match(/^(dkim|spf|dmarc)\s*=\s*([a-z]+)\b([\s\S]*)$/i);
    if (!m) continue;
    const method = m[1].toLowerCase();
    const result = m[2].toLowerCase();
    const props = m[3] ?? "";
    if (method === "dkim") {
      const d = props.match(/header\.d\s*=\s*([^\s;]+)/i)?.[1] ?? props.match(/header\.i\s*=\s*([^\s;]+)/i)?.[1]?.split("@").pop() ?? null;
      dkimResults.push({ result, d: d ? d.toLowerCase() : null });
    } else if (method === "spf") {
      if (spf === null) spf = result;
    } else if (method === "dmarc" && dmarc === null) {
      dmarc = result;
      dmarcFrom = props.match(/header\.from\s*=\s*([^\s;]+)/i)?.[1] ?? null;
    }
  }
  const alignedPass = dkimResults.find((r) => r.result === "pass" && !!r.d && aligned(senderDomain, r.d));
  const shown = alignedPass ?? dkimResults.find((r) => r.result === "pass") ?? dkimResults[0];
  const dkim = shown?.result ?? null;
  const dkimDomain = shown?.d ?? null;
  const dmarcPass = dmarc === "pass" && (!dmarcFrom || aligned(senderDomain, dmarcFrom));
  let verdict: AuthVerdict["verdict"] = "missing";
  if (dmarcPass || alignedPass) verdict = "pass";
  // 有结论但不成立：DMARC 失败 / DKIM 失败 / DKIM 通过但签名域与发件域不对齐（他人代签）/ DMARC 通过但 header.from 不是发件人
  else if (dmarc === "fail" || dmarc === "pass" || dkimResults.some((r) => r.result === "fail" || r.result === "pass")) verdict = "fail";
  return { verdict, dkim, dkimDomain, spf, dmarc, authServId, source: "raw", note: null, seenAuthServIds };
}

// ── 隔离原因 ────────────────────────────────────────────────────────────────

export type QuarantineReason = "sender_not_allowed" | "auth_unverified" | "no_buyer_contact";

export const QUARANTINE_REASON_LABELS: Record<QuarantineReason, string> = {
  sender_not_allowed: "发件人不在转发白名单",
  auth_unverified: "发件域名未通过 DKIM / DMARC 验证（或缺少验证结果）",
  no_buyer_contact: "没有识别出买家邮箱或电话",
};

/** 发件人（严格解析：恰好一个地址，见 senderAddress）在转发白名单里 */
export function isAllowlistedSender(sender: string, allowlist: readonly string[]): boolean {
  const addr = senderAddress(sender);
  return !!addr && allowlist.includes(addr);
}

export function quarantineReasons(input: {
  sender: string;
  allowlist: readonly string[];
  auth: Pick<AuthVerdict, "verdict">;
  buyerEmail: string;
  buyerPhone: string;
}): QuarantineReason[] {
  const reasons: QuarantineReason[] = [];
  if (!isAllowlistedSender(input.sender, input.allowlist)) reasons.push("sender_not_allowed");
  if (input.auth.verdict !== "pass") reasons.push("auth_unverified");
  if (!input.buyerEmail && !input.buyerPhone) reasons.push("no_buyer_contact");
  return reasons;
}

// ── 事件身份与载荷 ──────────────────────────────────────────────────────────

const EVENT_ID_MAX = 120;

/** eventId = "email:<Message-ID>"（去尖括号）；超长时改用 sha256 摘要；没有 Message-ID 时用 Resend email_id */
export function emailEventId(messageId: string | null | undefined, resendEmailId?: string | null): string | null {
  const id = (messageId ?? "").trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  if (id) {
    const full = `email:${id}`;
    return full.length <= EVENT_ID_MAX ? full : `email:sha256:${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
  }
  const rid = (resendEmailId ?? "").trim();
  return rid ? `email:resend:${rid}`.slice(0, EVENT_ID_MAX) : null;
}

const LIMITS = { name: 120, email: 200, phone: 60, company: 200, country: 80, message: 4000, product: 200 } as const;

function line(s: string, max: number): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** 解析结果 → 与网站询盘同形的归一化载荷（来源页 / UTM 留空：邮件转发不是落地页归因） */
export function buildEmailInquiry(parsed: ParsedForwardedEmail, eventId: string): NormalizedInquiry {
  return {
    name: line(parsed.buyer.name, LIMITS.name),
    email: line(parsed.buyer.email, LIMITS.email).toLowerCase(),
    phone: line(parsed.buyer.phone, LIMITS.phone),
    company: line(parsed.buyer.company, LIMITS.company),
    country: line(parsed.buyer.country, LIMITS.country),
    message: (parsed.message ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMITS.message),
    product: line(parsed.product, LIMITS.product),
    website: "",
    page: "",
    referrer: "",
    landing: "",
    utm: { source: "", medium: "", campaign: "", content: "", term: "" },
    eventId,
    honeypotTripped: false,
  };
}

/** 发件人不在白名单时不取正文、不解析：只记一条空载荷的隔离收据（原主题等放在 meta） */
export function blankEmailInquiry(eventId: string): NormalizedInquiry {
  return {
    name: "",
    email: "",
    phone: "",
    company: "",
    country: "",
    message: "",
    product: "",
    website: "",
    page: "",
    referrer: "",
    landing: "",
    utm: { source: "", medium: "", campaign: "", content: "", term: "" },
    eventId,
    honeypotTripped: false,
  };
}

// ── 官网询盘孪生（同一询盘已由官网 webhook 入站） ───────────────────────────

/** 双重入站判定窗口：官网通知被转发过来通常在几分钟到一天内 */
export const EMAIL_WEBSITE_TWIN_WINDOW_MS = 48 * 60 * 60 * 1000;

function normForCompare(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function phoneDigits(s: string): string {
  const d = (cleanPhone(s ?? "") || "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}

/** 官网收据与转发解析出的买家是同一联系人：邮箱一致，或电话末 10 位一致 */
export function sameBuyerContact(web: { email: string; phone: string }, fwd: { email: string; phone: string }): boolean {
  const sameEmail = !!web.email && !!fwd.email && web.email.trim().toLowerCase() === fwd.email.trim().toLowerCase();
  const wp = phoneDigits(web.phone);
  return sameEmail || (!!wp && wp === phoneDigits(fwd.phone));
}

/** 内容孪生要求的官网留言最短长度（规范化后）：更短的留言（或空留言）不足以证明是同一封，宁可不判重复 */
export const WEBSITE_TWIN_MIN_MESSAGE = 20;

/**
 * 转发的邮件是不是官网已经推送过的那条询盘：联系人一致（邮箱，或电话末 10 位）且正文一致
 * （官网留言规范化后整段出现在转发全文里，或其 80% 以上的词出现在转发全文里）。
 * 官网留言为空或太短时一律不算（不再退回「同联系人 + 同产品」：同一买家之后发来的新询盘会被误判、内容丢失）。
 */
export function isWebsiteContentTwin(
  web: { email: string; phone: string; message: string; product: string },
  fwd: { buyerEmail: string; buyerPhone: string; fullText: string },
): boolean {
  if (!sameBuyerContact(web, { email: fwd.buyerEmail, phone: fwd.buyerPhone })) return false;
  const msg = normForCompare(web.message);
  if (msg.length < WEBSITE_TWIN_MIN_MESSAGE) return false;
  const hay = normForCompare(fwd.fullText);
  if (hay.includes(msg.slice(0, 160))) return true;
  const tokens = msg.split(" ").filter((t) => t.length >= 3);
  if (tokens.length < 4) return hay.includes(msg);
  const hayTokens = new Set(hay.split(" "));
  const hit = tokens.filter((t) => hayTokens.has(t)).length;
  return hit / tokens.length >= 0.8;
}

/**
 * 只有「本厂系统 / 本厂人员发出的邮件」才可能是官网自己的内部询盘通知：
 * 官网通知格式，或选中那封的发件人是本厂人员 / 系统地址；B2B 平台通知与买家来信一律不做双重入站判定。
 */
export function mayBeWebsiteNotification(parsed: Pick<ParsedForwardedEmail, "format" | "platform" | "senderKind">): boolean {
  if (parsed.platform || parsed.senderKind === "platform") return false;
  return parsed.format === "website_notification" || parsed.senderKind === "staff" || parsed.senderKind === "system";
}
