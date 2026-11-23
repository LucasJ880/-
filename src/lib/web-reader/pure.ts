/**
 * 读公开网页（TREE-1）的纯函数：地址判断、网址校验与归一、站点名单、robots、登录页 / 人机验证识别、
 * Retry-After 解析、原因文案。无 DB / 网络 / 时钟。
 */

import { isIP } from "node:net";
import { validatePublicHttpUrl } from "@/lib/supplier-intel/submission-parser";
import type {
  BlockedReason,
  PageReadOutcome,
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
  if (allZero(0, 4) && g[4] === 0xffff && g[5] === 0) return ipv4Blocked(embeddedV4(g[6], g[7])); // ::ffff:0:a.b.c.d（IPv4 翻译地址）
  if (allZero(0, 6)) return true; // ::a.b.c.d（已废弃的 IPv4 兼容地址）
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return ipv4Blocked(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0x0001) return true; // 64:ff9b:1::/48 本地用 NAT64
  if (g[0] === 0x2002) return ipv4Blocked(embeddedV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 文档
  if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return true; // 2001:2::/48 基准测试
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return true; // 2001:10::/28 ORCHID
  if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return true; // 3fff::/20 文档
  if (g[0] === 0x5f00) return true; // 5f00::/16 SRv6
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
  // 主机名不能有空标签（「a..b」「.a」「a..」）：避免同一个站有多种写法
  if (!url.hostname || /^\.|\.\./.test(url.hostname)) return { ok: false, reason: "invalid_url" };
  return { ok: true, url };
}

/** 网址归一（缓存键）：去片段、去主机名末尾的点；主机名小写与默认端口由 URL 自身归一 */
export function normalizePageUrl(url: URL): string {
  const u = new URL(url.toString());
  u.hash = "";
  // 主机名末尾的点（example.gov.）与不带点的是同一个站
  if (u.hostname.endsWith(".")) u.hostname = u.hostname.replace(/\.+$/, "");
  return u.toString();
}

/** 主机名（小写、去 IPv6 方括号、去末尾的点） */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

/** 站点键（主机名字符串）：小写、去方括号、去末尾的点、去开头的 www.（调用方传回的被挡站也按它归一） */
export function siteKeyOfHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "").replace(/^www\./, "");
}

const EMBEDDED_HOST_RE = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}/g;
/** 嵌入主机名的扫描范围与个数上限（防止超长网址占 CPU） */
const EMBEDDED_SCAN_MAX_CHARS = 4096;
const EMBEDDED_MAX_HOSTS = 64;

/**
 * 网址的路径与查询里嵌着的主机名（站点键，去重；不含网址自己的主机）。用于识别「经抓取代理 / 快照 / 翻译代理
 * 换地址读同一个站」：`https://proxy.example/https://gov.example/a`、`?url=gov.example%2Fa` 都能认出 gov.example。
 * 百分号编码最多解两层。
 */
export function embeddedHostsOf(url: URL): string[] {
  let s = (url.pathname + url.search).slice(0, EMBEDDED_SCAN_MAX_CHARS).toLowerCase();
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(s.replace(/\+/g, " "));
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  const own = siteKeyOfHost(hostOf(url));
  const out = new Set<string>();
  for (const m of s.matchAll(EMBEDDED_HOST_RE)) {
    const k = siteKeyOfHost(m[0]);
    if (k && k !== own) out.add(k);
    if (out.size >= EMBEDDED_MAX_HOSTS) break;
  }
  return [...out];
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
    // 青砚自己的站与预览域名：不对自家站点发请求
    "qingyan.ca",
    "qingyan.ai",
    "vercel.app",
    // 第三方抓取代理、网页快照与翻译代理：经它们读别的站等于「换地址、换代理」（任务书规则 4 不做）。
    // 名单列不全；通用的防线是「网址里嵌着被挡站 / 不碰站的主机名」也按被挡 / 不碰处理（embeddedHostsOf）
    "translate.goog",
    "translate.google.com",
    "translate.googleusercontent.com",
    "webcache.googleusercontent.com",
    "jina.ai",
    "12ft.io",
    "1ft.io",
    "smry.ai",
    "archive.org",
    "archive.ph",
    "archive.is",
    "archive.today",
    "archive.li",
    "archive.vn",
    "archive.md",
    "archive.fo",
    "ghostarchive.org",
    "cachedview.nl",
    "mementoweb.org",
    "translatetheweb.com",
    "microsofttranslator.com",
    "croxyproxy.com",
    "proxysite.com",
    "hidester.com",
    "kproxy.com",
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
/** 规则条数与单条模式长度的上限：超过就按「读取规则取不到」处理（防止对方用超大规则表占满 CPU） */
export const ROBOTS_MAX_RULES = 5000;
export const ROBOTS_MAX_PATTERN_CHARS = 512;
/** 一次判断的匹配步数预算：超了按不许读处理 */
export const ROBOTS_MATCH_STEP_BUDGET = 2_000_000;

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/**
 * robots 规则与路径的比较前归一（RFC 9309 §2.2.2）：非 ASCII 字符按 UTF-8 百分号编码；
 * 百分号编码的非保留字符（A–Z a–z 0–9 - . _ ~）解码回字符；其余 %xx 的十六进制统一大写。
 */
export function canonRobotsPath(s: string): string {
  return s
    .replace(/[^\x00-\x7f]/gu, (ch) => encodeURIComponent(ch))
    .replace(/%([0-9a-f]{2})/gi, (m, hex: string) => {
      const ch = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9\-._~]/.test(ch) ? ch : m.toUpperCase();
    });
}

/** 超过规则条数或单条模式长度上限时返回 null（调用方按「读取规则取不到」处理） */
export function parseRobotsLimited(text: string): RobotsGroup[] | null {
  const groups = parseRobots(text);
  let rules = 0;
  for (const g of groups) {
    rules += g.rules.length;
    if (g.rules.some((r) => r.pattern.length > ROBOTS_MAX_PATTERN_CHARS)) return null;
  }
  return rules > ROBOTS_MAX_RULES ? null : groups;
}

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
      // 只取产品名（RFC 9309：开头的字母、下划线、连字符；「QingyanResearchBot/1.0」「QingyanResearchBot 1.0」都算本机器人）
      const v = value.trim();
      current.agents.push(v.startsWith("*") ? "*" : (/^[A-Za-z_-]+/.exec(v)?.[0] ?? "").toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue; // 组外的规则忽略
      if (value === "") continue; // 空 Disallow = 不限制
      current.rules.push({ allow: key === "allow", pattern: canonRobotsPath(value) });
      continue;
    }
    // sitemap、crawl-delay 等不影响分组
  }
  return groups;
}

/** `*` 通配、末尾 `$` 锚定的前缀匹配；不用正则，最坏 O(n·m)、无回溯爆炸。budget 记步数，用完返回 null */
export function robotsPatternMatches(pattern: string, path: string, budget?: { steps: number }): boolean | null {
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
    if (budget && --budget.steps < 0) return null;
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

/**
 * 按 QingyanResearchBot 组（没有则 * 组）判断路径（含查询）能不能读；最长匹配优先，同长 Allow 优先。
 * 匹配步数超过预算按不许读处理。
 */
export function isAllowedByRobots(groups: readonly RobotsGroup[], rawPathWithQuery: string): boolean {
  const pathWithQuery = canonRobotsPath(rawPathWithQuery);
  if (pathWithQuery === "/robots.txt") return true;
  // 「//private/a」这类重复斜杠：多数服务器当作 /private/a，两种写法都要被允许才读
  const q = pathWithQuery.indexOf("?");
  const pathPart = q < 0 ? pathWithQuery : pathWithQuery.slice(0, q);
  const collapsed = pathPart.replace(/\/{2,}/g, "/") + (q < 0 ? "" : pathWithQuery.slice(q));
  if (collapsed !== pathWithQuery && !allowedByRobotsCanon(groups, collapsed)) return false;
  return allowedByRobotsCanon(groups, pathWithQuery);
}

function allowedByRobotsCanon(groups: readonly RobotsGroup[], pathWithQuery: string): boolean {
  const budget = { steps: ROBOTS_MATCH_STEP_BUDGET };
  const token = ROBOTS_PRODUCT_TOKEN.toLowerCase();
  let matched = groups.filter((g) => g.agents.includes(token));
  if (matched.length === 0) matched = groups.filter((g) => g.agents.includes("*"));
  if (matched.length === 0) return true;
  let best: RobotsRule | null = null;
  for (const g of matched) {
    for (const r of g.rules) {
      const m = robotsPatternMatches(r.pattern, pathWithQuery, budget);
      if (m === null) return false;
      if (!m) continue;
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
  "signon",
  "sign-on",
  "logon",
  "log-on",
  "sso",
  "auth",
  "oauth",
  "oauth2",
  "authenticate",
  "authentication",
  "authorize",
  "wp-login",
  "saml",
  // 加拿大法语页面
  "connexion",
  "se-connecter",
  "ouvrir-une-session",
]);
const LOGIN_HOST_PREFIXES = ["login.", "signin.", "sso.", "auth.", "accounts.", "idp.", "secure.login."];

function isLoginSegment(seg: string): boolean {
  const s = seg.split(";")[0].replace(/\.(php|aspx?|jsp|html?|do|cfm)$/, "");
  return LOGIN_PATH_SEGMENTS.has(s);
}

/**
 * 登录地址：路径里有一段恰好是登录词（去路径参数「;jsessionid=…」与扩展名后），或查询值里有这样一段
 * （「?route=account/login」），或主机名以 login. / sso. / auth. / accounts. 等开头。
 */
export function isLoginUrl(url: URL): boolean {
  const host = hostOf(url);
  if (LOGIN_HOST_PREFIXES.some((p) => host.startsWith(p))) return true;
  let path = url.pathname.toLowerCase();
  try {
    path = decodeURIComponent(path);
  } catch {
    // 保留原样
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.some(isLoginSegment)) return true;
  for (const value of url.searchParams.values()) {
    if (value.length <= 200 && value.toLowerCase().split("/").filter(Boolean).some(isLoginSegment)) return true;
  }
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
  "_cf_chl_opt",
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

/** `<meta http-equiv="refresh" content="0; url=…">` 的目标（相对地址按 base 解析）；没有返回 null */
export function metaRefreshTarget(html: string, base: URL): URL | null {
  const head = html.slice(0, 200_000);
  const m = /<meta\b[^>]{0,300}http-equiv\s*=\s*["']?refresh["']?[^>]{0,500}>/i.exec(head);
  if (!m) return null;
  const c = /content\s*=\s*["']?\s*\d*\s*[;,]?\s*url\s*=\s*["']?([^"'>\s]{1,2048})/i.exec(m[0]);
  if (!c) return null;
  try {
    return new URL(c[1], base);
  } catch {
    return null;
  }
}

/* ───────────────────────────── 429 ───────────────────────────── */

/** Retry-After：秒数或 HTTP 日期 → 需要等待的秒数（向上取整、不小于 0）；没有 / 认不出返回 null */
export function parseRetryAfterSeconds(header: string | null | undefined, nowMs: number): number | null {
  if (header == null) return null;
  const v = header.trim();
  if (!v) return null;
  if (/^\d{1,9}$/.test(v)) return Number(v);
  // 日期只认 HTTP 日期（IMF-fixdate，带 GMT）；「1.5」「-1」「10, 20」之类一律认不出
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v)) return null;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/** 429 等待上限（秒）：超过就按被挡处理 */
export const RATE_LIMIT_MAX_WAIT_SECONDS = 30;

/* ───────────────────────────── 文案 ───────────────────────────── */

/** 结果类别的中文名（页面直接用这一份，不另写） */
export const OUTCOME_ZH: Record<PageReadOutcome, string> = {
  ok: "读到",
  blocked: "被挡",
  unreachable: "打不开",
  refused: "不读",
  limit: "到上限",
};

/**
 * 每个原因一句中文（页面直接用这一份）。结尾按类别统一：被挡「…，未读取」、打不开「…，没打开」、不读「…，不读」。
 * 页面上要说明是哪个站时拼成「〈站名〉被挡：〈原因句〉」（站名在结果的 blocked.site）。
 */
const REASON_ZH: Record<PageReadReason, string> = {
  http_401: "需要登录才能看（401），未读取",
  http_403: "对方禁止访问（403），未读取",
  http_407: "需要登录或身份认证（407），未读取",
  login_redirect: "跳转到了登录页，未读取",
  login_page: "这是登录页，未读取",
  captcha: "对方要求人机验证，未读取",
  robots_disallow: "该网站声明不让程序读这个页面，未读取",
  robots_unavailable: "该网站的读取规则取不到，按规定未读取",
  rate_limited: "对方嫌访问太频繁（429），未读取",
  site_blocked_in_branch: "这一支里该网站已经挡过我们，未读取",
  timeout: "对方一直没响应，重试后仍没打开",
  network_error: "连不上对方网站，重试后仍没打开",
  dns_failed: "找不到这个网站（域名解析失败），没打开",
  http_5xx: "对方网站出错，重试后仍没打开",
  http_4xx: "页面不存在或已下线，没打开",
  too_many_redirects: "跳转次数太多，没打开",
  invalid_redirect: "跳转地址无效，没打开",
  deadline: "这一轮处理时间到了，没来得及读，下一轮再读",
  invalid_url: "网址无效，不读",
  credentials_in_url: "网址里带了用户名或密码，不读",
  non_default_port: "网址带了非标准端口，不读",
  private_address: "这是内部网络地址，不读",
  site_denied: "该网站在不读名单里，不读",
  login_url: "这是登录地址，不读",
  ip_literal: "网址是 IP 地址而不是网站域名，不读",
  url_not_allowed: "这个网址不是从搜索结果或已读页面里来的，不读",
  unsupported_type: "不是网页（HTML），不读",
  pdf_not_read: "PDF 不在线解析（安全原因），请用「我来补一页」上传，这里不读",
  budget_exhausted: "读页次数到上限，未读",
  robots_limit: "这一支查网站读取规则的次数到上限，未读",
  blocked_sites_limit: "这一支被挡的网站已达上限，未读",
};

export function reasonMessageZh(reason: PageReadReason | null): string {
  return reason ? REASON_ZH[reason] : OUTCOME_ZH.ok;
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
