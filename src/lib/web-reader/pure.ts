/**
 * 读公开网页（TREE-1）的纯函数：地址判断、网址校验与归一、站点名单、robots、登录页 / 人机验证识别、
 * Retry-After 解析、原因文案。无 DB / 网络 / 时钟。
 */

import { isIP } from "node:net";
import { validatePublicHttpUrl } from "@/lib/supplier-intel/submission-parser";
import type {
  BlockedReason,
  PageReadReason,
  RefusedReason,
  SiteClass,
  SitePolicy,
} from "./types";

/* ───────────────────────────── 地址 ───────────────────────────── */

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return out.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? out : null;
}

function ipv4Blocked(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8 本网络
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 运营商级 NAT
  if (a === 127) return true; // 回环
  if (a === 169 && b === 254) return true; // 链路本地（含云元数据地址）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0/24 协议分配、192.0.2/24 文档
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 中继
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 测试
  if (a === 198 && b === 51 && c === 100) return true; // 文档
  if (a === 203 && b === 0 && c === 113) return true; // 文档
  if (a >= 224) return true; // 组播 224/4、保留 240/4、广播
  return false;
}

/** IPv6 → 8 个 16 位段；不合法返回 null（支持 :: 压缩与末尾点分 IPv4；调用前已由 isIP 校验过格式） */
function parseIpv6(raw: string): number[] | null {
  let ip = raw.split("%")[0]; // 去区域标识
  let tail: number[] = [];
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    const v4 = parseIpv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    ip = ip.slice(0, lastColon + 1); // 以 ":" 结尾
    if (!ip.endsWith("::")) ip = ip.slice(0, -1);
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) =>
    s === "" ? [] : s.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 2) {
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
  }
  return known === 8 ? [...head, ...tail] : null;
}

function ipv6Blocked(g: number[]): boolean {
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const embeddedV4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  if (allZero(0, 8)) return true; // ::
  if (allZero(0, 7) && g[7] === 1) return true; // ::1
  if (allZero(0, 5) && g[5] === 0xffff) return ipv4Blocked(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (allZero(0, 6)) return true; // ::a.b.c.d（已废弃的 IPv4 兼容地址）
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return ipv4Blocked(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return ipv4Blocked(embeddedV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 文档
  if (g[0] === 0x0100 && allZero(1, 4)) return true; // 100::/64 丢弃
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 站点本地（废弃）
  if ((g[0] & 0xff00) === 0xff00) return true; // 组播
  return false;
}

/** 内网、回环、链路本地、运营商级 NAT、组播、未指定、文档与其它保留地址 → true；不是合法 IP 也返回 true */
export function isBlockedAddress(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, "");
  const kind = isIP(ip.split("%")[0]);
  if (kind === 4) {
    const v4 = parseIpv4(ip);
    return v4 ? ipv4Blocked(v4) : true;
  }
  if (kind === 6) {
    const v6 = parseIpv6(ip);
    return v6 ? ipv6Blocked(v6) : true;
  }
  return true;
}

/* ───────────────────────────── 网址 ───────────────────────────── */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: RefusedReason };

/** 网址校验：既有的公开网址校验 + 不带凭证 + 只收默认端口 */
export function checkPublicUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = validatePublicHttpUrl(raw.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  // WHATWG URL 在端口等于协议默认端口时把 port 置空
  if (url.port !== "") return { ok: false, reason: "non_default_port" };
  if (!url.hostname) return { ok: false, reason: "invalid_url" };
  return { ok: true, url };
}

/** 网址归一（缓存键）：去片段；主机名小写与默认端口由 URL 自身归一 */
export function normalizePageUrl(url: URL): string {
  const u = new URL(url.toString());
  u.hash = "";
  return u.toString();
}

/** 主机名（小写、去 IPv6 方括号、去末尾的点） */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** 主机名本身就是 IP 字面量时返回它 */
export function ipLiteralOf(url: URL): string | null {
  const h = hostOf(url);
  return isIP(h) ? h : null;
}

/* ───────────────────────────── 站点名单 ───────────────────────────── */

/**
 * 预置站点名单（代码常量）。后缀匹配：`merx.com` 同时管 `www.merx.com`。
 * - deny「不碰」：要登录才能看的站。
 * - humanInitiated「按人发起处理」：不看 robots，读页额度与其它站相同（Evan 2026-11-22 定）。
 * - allow「可以读」：与默认同样处理（照 robots 读），只是文档化已知的政府开放站点。
 */
export const PRESET_SITE_POLICY: SitePolicy = Object.freeze({
  deny: Object.freeze([
    "detail.1688.com",
    "login.1688.com",
    "merx.com",
    "linkedin.com",
    "facebook.com",
    "instagram.com",
  ]),
  humanInitiated: Object.freeze(["importyeti.com"]),
  allow: Object.freeze(["canada.ca", "gc.ca", "canadabuys.canada.ca"]),
});

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

function cleanDomainList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v.slice(0, 500)) {
    if (typeof item !== "string") continue;
    const d = item.trim().toLowerCase().replace(/^\*?\./, "").replace(/\.$/, "");
    if (DOMAIN_RE.test(d)) out.add(d);
  }
  return [...out];
}

/**
 * 读组织覆盖：`Organization.settingsJson.researchTree.sites = { deny?: string[], allow?: string[] }`。
 * 只收这两类；`humanInitiated` 不能由组织设置新增（不看 robots 是要拍板的放宽）。
 */
export function readOrgSiteOverride(settingsJson: unknown): { deny: string[]; allow: string[] } {
  const root = settingsJson && typeof settingsJson === "object" ? (settingsJson as Record<string, unknown>) : {};
  const rt = root.researchTree && typeof root.researchTree === "object" ? (root.researchTree as Record<string, unknown>) : {};
  const sites = rt.sites && typeof rt.sites === "object" ? (rt.sites as Record<string, unknown>) : {};
  return { deny: cleanDomainList(sites.deny), allow: cleanDomainList(sites.allow) };
}

/** 预置 + 组织覆盖；「不碰」永远优先（分类时先查 deny） */
export function mergeSitePolicy(preset: SitePolicy, override: { deny: readonly string[]; allow: readonly string[] }): SitePolicy {
  return {
    deny: [...new Set([...preset.deny, ...override.deny])],
    humanInitiated: [...preset.humanInitiated],
    allow: [...new Set([...preset.allow, ...override.allow])],
  };
}

function hostMatches(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

export function classifySite(host: string, policy: SitePolicy): SiteClass {
  const h = host.toLowerCase();
  if (policy.deny.some((e) => hostMatches(h, e))) return "deny";
  if (policy.humanInitiated.some((e) => hostMatches(h, e))) return "human_initiated";
  if (policy.allow.some((e) => hostMatches(h, e))) return "allow";
  return "default";
}

/* ───────────────────────────── robots ───────────────────────────── */

export const ROBOTS_PRODUCT_TOKEN = "QingyanResearchBot";
/** RFC 9309：至少解析前 500 KiB */
export const ROBOTS_MAX_BYTES = 500 * 1024;

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/** 解析 robots.txt（RFC 9309）：user-agent 行开组，规则行归最近的组；未知字段忽略 */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue; // 组外的规则忽略
      if (value === "") continue; // 空 Disallow = 不限制
      current.rules.push({ allow: key === "allow", pattern: value });
      continue;
    }
    // sitemap、crawl-delay 等不影响分组
  }
  return groups;
}

/** `*` 通配、末尾 `$` 锚定的前缀匹配；不用正则，最坏 O(n·m)、无回溯爆炸 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  let p = pattern;
  let anchored = false;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  let pi = 0;
  let si = 0;
  let starP = -1;
  let starS = 0;
  while (si < path.length) {
    if (pi < p.length && p[pi] === "*") {
      starP = pi++;
      starS = si;
    } else if (pi < p.length && p[pi] === path[si]) {
      pi++;
      si++;
    } else if (pi >= p.length && !anchored) {
      return true; // 模式已匹配完（前缀匹配）
    } else if (starP >= 0) {
      pi = starP + 1;
      si = ++starS;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi >= p.length;
}

/** 按 QingyanResearchBot 组（没有则 * 组）判断路径（含查询）能不能读；最长匹配优先，同长 Allow 优先 */
export function isAllowedByRobots(groups: readonly RobotsGroup[], pathWithQuery: string): boolean {
  if (pathWithQuery === "/robots.txt") return true;
  const token = ROBOTS_PRODUCT_TOKEN.toLowerCase();
  let matched = groups.filter((g) => g.agents.includes(token));
  if (matched.length === 0) matched = groups.filter((g) => g.agents.includes("*"));
  if (matched.length === 0) return true;
  let best: RobotsRule | null = null;
  for (const g of matched) {
    for (const r of g.rules) {
      if (!robotsPatternMatches(r.pattern, pathWithQuery)) continue;
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) {
        best = r;
      }
    }
  }
  return best ? best.allow : true;
}

/* ─────────────────────── 登录页 / 人机验证 ─────────────────────── */

const LOGIN_PATH_SEGMENTS = new Set([
  "login",
  "log-in",
  "log_in",
  "signin",
  "sign-in",
  "sign_in",
  "logon",
  "log-on",
  "sso",
  "auth",
  "oauth",
  "oauth2",
  "authenticate",
  "authorize",
  "cas",
  "wp-login",
  "saml",
]);
const LOGIN_HOST_PREFIXES = ["login.", "signin.", "sso.", "auth.", "accounts.", "idp.", "secure.login."];

/** 登录地址：路径里有一段恰好是登录词（去扩展名后），或主机名以 login. / sso. / auth. / accounts. 等开头 */
export function isLoginUrl(url: URL): boolean {
  const host = hostOf(url);
  if (LOGIN_HOST_PREFIXES.some((p) => host.startsWith(p))) return true;
  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.some((s) => LOGIN_PATH_SEGMENTS.has(s.replace(/\.(php|aspx?|jsp|html?|do|cfm)$/, "")))) return true;
  // users/sign_in、session/new、account/login 这类由上面的单段规则覆盖；再认一个 session/new
  for (let i = 0; i + 1 < segments.length; i++) {
    if ((segments[i] === "session" || segments[i] === "sessions") && segments[i + 1] === "new") return true;
  }
  return false;
}

/** 强标记：出现即判为人机验证 */
const CAPTCHA_STRONG_MARKERS = [
  "<title>just a moment...</title>",
  "attention required! | cloudflare",
  "cf-chl-",
  "captcha-delivery.com",
  "_incapsula_resource",
  "px-captcha",
];
/** 弱标记：只在正文很少时判为人机验证（正常页面也会嵌表单验证码或 CDN 的检测脚本） */
const CAPTCHA_WEAK_MARKERS = [
  "g-recaptcha",
  "recaptcha/api.js",
  "h-captcha",
  "hcaptcha.com/1/api.js",
  "cf-turnstile",
  "challenges.cloudflare.com/turnstile",
  "/cdn-cgi/challenge-platform/",
];
/** 正文少于这么多字符才认「登录框 / 弱验证码标记」 */
export const LOGIN_PAGE_MAX_TEXT_CHARS = 2000;

const PASSWORD_INPUT_RE = /<input\b[^>]{0,2000}\btype\s*=\s*["']?password\b/i;

/** HTML 页面是不是登录页 / 人机验证；都不是返回 null */
export function detectAccessWall(input: { html: string; textChars: number }): "captcha" | "login_page" | null {
  const head = input.html.slice(0, 400_000).toLowerCase();
  if (CAPTCHA_STRONG_MARKERS.some((m) => head.includes(m))) return "captcha";
  const short = input.textChars < LOGIN_PAGE_MAX_TEXT_CHARS;
  if (short && CAPTCHA_WEAK_MARKERS.some((m) => head.includes(m))) return "captcha";
  if (short && PASSWORD_INPUT_RE.test(head)) return "login_page";
  return null;
}

/* ───────────────────────────── 429 ───────────────────────────── */

/** Retry-After：秒数或 HTTP 日期 → 需要等待的秒数（向上取整、不小于 0）；没有 / 认不出返回 null */
export function parseRetryAfterSeconds(header: string | null | undefined, nowMs: number): number | null {
  if (header == null) return null;
  const v = header.trim();
  if (!v) return null;
  if (/^\d{1,9}$/.test(v)) return Number(v);
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/** 429 等待上限（秒）：超过就按被挡处理 */
export const RATE_LIMIT_MAX_WAIT_SECONDS = 30;

/* ───────────────────────────── 文案 ───────────────────────────── */

const REASON_ZH: Record<PageReadReason, string> = {
  http_401: "对方要求登录（401），未读取",
  http_403: "对方拒绝访问（403），未读取",
  http_407: "对方要求代理认证（407），未读取",
  login_redirect: "跳转到了登录页，未读取",
  login_page: "这是登录页，未读取",
  captcha: "对方要求人机验证，未读取",
  robots_disallow: "该网站的 robots 声明不允许读取这个页面",
  robots_unavailable: "该网站的 robots 声明读取失败，按规则不读",
  rate_limited: "对方限流（429），未读取",
  site_blocked_in_branch: "这一支里该网站已被挡过，不再读取",
  timeout: "超时，重试后仍未接通",
  network_error: "连接中断，重试后仍未接通",
  dns_failed: "域名解析失败",
  http_5xx: "对方服务出错，重试后仍未接通",
  http_4xx: "页面不存在或不可用",
  too_many_redirects: "跳转次数过多，已停止",
  invalid_redirect: "跳转地址无效",
  deadline: "这一轮的时间用完，未读完",
  pdf_unreadable: "PDF 抽不出文字",
  invalid_url: "网址无效",
  credentials_in_url: "网址里带了用户名或密码，不读",
  non_default_port: "只读 80 / 443 端口的网址",
  private_address: "地址不是公网地址，不读",
  site_denied: "该网站在「不碰」名单里，不读",
  login_url: "这是登录地址，不读",
  unsupported_type: "不是网页、纯文本或 PDF，不读",
  budget_exhausted: "到上限，未查完",
};

export function reasonMessageZh(reason: PageReadReason | null): string {
  return reason ? REASON_ZH[reason] : "已读取";
}

export function isBlockedReason(reason: PageReadReason): reason is BlockedReason {
  return (
    reason === "http_401" ||
    reason === "http_403" ||
    reason === "http_407" ||
    reason === "login_redirect" ||
    reason === "login_page" ||
    reason === "captcha" ||
    reason === "robots_disallow" ||
    reason === "robots_unavailable" ||
    reason === "rate_limited" ||
    reason === "site_blocked_in_branch"
  );
}
