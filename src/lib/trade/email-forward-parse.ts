/**
 * 邮件转发询盘解析（PRD F1.2）— 纯函数，无 DB / 网络
 *
 * 业务员把询盘邮件转发到组织的询盘邮箱（inq-xxxxxxxxxx@<INBOUND_EMAIL_DOMAIN>）。这里把转发邮件还原成
 * 「买家是谁、要什么」：
 *   - 拆开 Gmail「---------- Forwarded message ---------」、Outlook「From: / Sent: / To: / Subject:」、
 *     Apple Mail「Begin forwarded message:」、QQ / Foxmail「Original」等转发头；转发套转发时逐层往里找，
 *     直到第一封不是本厂人员（转发人 / 白名单 / 转发人的企业域名）发出的邮件；
 *   - 识别常见 B2B 平台询盘通知（Alibaba.com / Made-in-China.com / Global Sources 一类：买家名、公司、国家、
 *     产品、数量、平台询盘编号）与工厂官网自己的内部询盘通知（带「Inquiry ID / eventId」），尽力而为并给出置信度；
 *   - 去掉引用的历史回复（On … wrote: / 在 … 写道： / > 引用行）与签名（签名里的电话、公司先取出来再去掉）。
 *
 * 不变量：转发人永远不会被当成买家（转发人地址、调用方给的排除地址 / 域名、转发人的企业域名、
 * no-reply 类系统地址、平台中转地址都不会被选为买家邮箱；业务员手写内容里转发人自己的签名电话——
 * 没有 "--" / 结束语也一样——不会被选为买家电话，见 staffNotePhone）。
 * 全部线性时间：地址正则有界、HTML 单趟扫描，病态输入（无 @ 长串、未闭合标签）不会回溯成平方级。
 *
 * 公开仓库：测试与注释只用虚构企业。
 */

import { isFreeMailDomain, isValidEmail } from "@/lib/revenue-spine/normalize";

export type ForwardFormat =
  | "gmail_forward"
  | "outlook_forward"
  | "apple_forward"
  | "platform_notification"
  | "website_notification"
  | "plain";

export type B2bPlatform = "alibaba" | "made_in_china" | "global_sources";

export interface ForwardedEmailInput {
  /** 入站邮件的发件人（= 转发人）：「Name <addr>」或裸地址 */
  from: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  /** 绝不能被当成买家的地址（转发白名单、询盘邮箱本身等）；转发人地址自动加入 */
  excludeAddresses?: readonly string[];
  /** 绝不能被当成买家的域名（如询盘收信域名） */
  excludeDomains?: readonly string[];
}

export interface ParsedBuyer {
  name: string;
  email: string;
  phone: string;
  company: string;
  country: string;
}

export interface ParsedForwardedEmail {
  format: ForwardFormat;
  /** 拆出转发头时的转发格式（format 被平台 / 官网通知覆盖时仍保留） */
  forwardFormat: Exclude<ForwardFormat, "platform_notification" | "website_notification">;
  platform: B2bPlatform | null;
  buyer: ParsedBuyer;
  product: string;
  quantity: string;
  message: string;
  /** 原邮件主题（去掉 Fwd: / FW: / Re: 前缀） */
  originalSubject: string;
  /** 选中那封邮件的发件地址（可能是平台 / 系统地址；不一定是买家） */
  originalFrom: string;
  /**
   * 选中那封邮件的发件人是谁：buyer = 外部地址（可当买家）；staff = 本厂人员（转发人 / 白名单 / 同企业域名，
   * 无转发头时就是转发人自己）；system = no-reply 类系统地址；platform = B2B 平台地址；unknown = 没有地址。
   * 双重入站判定只对 staff / system 发出的邮件（官网内部通知）做。
   */
  senderKind: "buyer" | "staff" | "system" | "platform" | "unknown";
  originalDate: string;
  platformInquiryId: string;
  /** 官网询盘编号（官网内部通知里的「Inquiry ID / eventId」）：用于识别同一询盘已经由官网 webhook 入站 */
  websiteInquiryId: string;
  /** 0–1：买家联系方式、格式识别、正文、姓名 / 公司、产品各占一部分 */
  confidence: number;
  /** 解析依据（排障用，不含正文） */
  signals: string[];
  /** 整封邮件转成的纯文本（内容孪生比对用） */
  fullText: string;
}

const MAX_INPUT_CHARS = 200_000;
const MAX_LINES = 4_000;
const MESSAGE_MAX = 4_000;

// 有界量词 + 后顾断言：只从字符串的起点尝试、本地部分最长 64、域名每段最长 63。
// 不加界时，没有 @ 的长串（如 20 万个 a）会在每个起点回溯到串尾，成为平方级（实测 199k 字符 46 s）。
const EMAIL_IN_TEXT_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
const ADDRESS_MAX = 254;

const PLATFORMS: Array<{ key: B2bPlatform; domains: string[]; name: RegExp }> = [
  { key: "alibaba", domains: ["alibaba.com", "alibaba-inc.com", "alibabagroup.com"], name: /alibaba\.com|阿里巴巴国际站|alibaba international/i },
  { key: "made_in_china", domains: ["made-in-china.com"], name: /made-in-china\.com|中国制造网/i },
  { key: "global_sources", domains: ["globalsources.com"], name: /global\s?sources/i },
];

const SYSTEM_LOCAL_RE = /^(no-?reply|do-?not-?reply|donotreply|noreply-[\w.-]+|notifications?|notice|alerts?|mailer-daemon|postmaster|bounces?|system)([+._-].*)?$/i;

// ── 文本归一 ────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "©", reg: "®",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    const key = body.toLowerCase();
    if (!key.startsWith("#")) return NAMED_ENTITIES[key] ?? m;
    const cp = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

const BLOCK_TAGS = new Set(["p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "section", "article", "ul", "ol", "pre"]);
const SKIP_CONTENT_TAGS = new Set(["script", "style", "head", "title"]);

/**
 * HTML → 纯文本：块级标签换行，表格单元格之间用制表符（「Name\tValue」可按标签解析）。
 * 单趟线性扫描（不用正则回溯）：任意长度的标签（如内联 data: URI 图片）整段去掉；未闭合的注释 / 标签 /
 * script 不会让后续每个「<」都扫到串尾。
 */
export function htmlToText(html: string): string {
  const s = html.slice(0, MAX_INPUT_CHARS);
  const lower = s.toLowerCase();
  const out: string[] = [];
  const unclosed = new Set<string>();
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out.push(s.slice(i));
      break;
    }
    if (lt > i) out.push(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      out.push(" ");
      if (end < 0) break; // 未闭合注释：其后都是注释（与浏览器一致）
      i = end + 3;
      continue;
    }
    const next = lower.charCodeAt(lt + 1);
    const tagStart = (next >= 97 && next <= 122) || next === 47 /* / */ || next === 33 /* ! */ || next === 63; /* ? */
    if (!tagStart) {
      out.push("<"); // 「a < b」这类正文
      i = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", lt + 1);
    if (gt < 0) {
      out.push(s.slice(lt)); // 之后再没有「>」：其余都是正文
      break;
    }
    const m = /^(\/?)([a-z][a-z0-9]{0,15})/.exec(lower.slice(lt + 1, Math.min(gt, lt + 20)));
    const closing = m?.[1] === "/";
    const name = m?.[2] ?? "";
    i = gt + 1;
    if (!closing && SKIP_CONTENT_TAGS.has(name) && !unclosed.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      out.push(" ");
      if (close < 0) {
        unclosed.add(name); // 之后不会再有闭合标签：内容按正文保留，不再重复查找
        continue;
      }
      const closeGt = s.indexOf(">", close);
      i = closeGt < 0 ? s.length : closeGt + 1;
      continue;
    }
    if (name === "br" || name === "hr" || BLOCK_TAGS.has(name)) out.push("\n");
    else if (closing && (name === "td" || name === "th")) out.push("\t");
  }
  return normalizeText(decodeEntities(out.join("")));
}

function normalizeText(s: string): string {
  return s
    .slice(0, MAX_INPUT_CHARS)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \f\v]+/g, " ").replace(/\t[\t ]*/g, "\t").replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── 地址 ────────────────────────────────────────────────────────────────────

/** 去掉引号里的显示名与 (注释)；未闭合时 ok=false */
function stripQuotedAndComments(raw: string): { text: string; ok: boolean } {
  let text = "";
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && (inQuote || depth > 0)) {
      i++;
      continue;
    }
    if (inQuote) {
      if (c === '"') {
        inQuote = false;
        text += " ";
      }
      continue;
    }
    if (c === '"') {
      inQuote = true;
      continue;
    }
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")" && depth > 0) {
      depth--;
      if (!depth) text += " ";
      continue;
    }
    if (depth > 0) continue;
    text += c;
  }
  return { text, ok: !inQuote && depth === 0 };
}

function normalizeAddr(candidate: string): string {
  const addr = candidate.replace(/^mailto:/i, "").trim().toLowerCase();
  return addr.length <= ADDRESS_MAX && isValidEmail(addr) ? addr : "";
}

const ANGLE_ADDR_RE = /<\s*([^<>\s]{1,320})\s*>/g;

function lastAngleOrFirstBare(s: string): string {
  const angles = [...s.matchAll(ANGLE_ADDR_RE)].map((m) => m[1]).filter((a) => a.includes("@"));
  return angles.length ? angles[angles.length - 1] : (s.match(EMAIL_IN_TEXT_RE) ?? [])[0] ?? "";
}

/**
 * 「"Name" <addr>」/「Name [mailto:addr]」/ 裸地址 → 小写裸地址；没有地址返回 ""。
 * 取显示名之后的那个地址：先去掉引号里的显示名与 (注释)，再取最后一个 <…>
 * （「"<lily@a.example>" <mallory@b.example>」得 mallory@b.example）。
 * 解析转发正文里的头用；判定入站发件人请用更严格的 senderAddress。
 */
export function bareAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const head = raw.slice(0, 2000);
  const stripped = stripQuotedAndComments(head);
  const found = lastAngleOrFirstBare(stripped.text);
  if (found || stripped.ok) return found ? normalizeAddr(found) : "";
  // 引号未闭合的残缺头（转发正文里偶见）：宽松地去掉引号再取
  return normalizeAddr(lastAngleOrFirstBare(head.replace(/"/g, " ")));
}

/**
 * 入站邮件发件人（转发人）的地址，严格版：引号 / 注释未闭合、或去掉显示名后不是恰好一个地址（多个 mailbox、
 * 多个 <…>、残留尖括号）一律返回 ""，按「不在白名单」隔离。白名单与 DKIM/DMARC 对齐都用它。
 */
export function senderAddress(raw: string | null | undefined): string {
  if (!raw || raw.length > 2000) return "";
  const stripped = stripQuotedAndComments(raw);
  if (!stripped.ok) return "";
  const angles = [...stripped.text.matchAll(/<([^<>]*)>/g)].map((m) => m[1].trim());
  const rest = stripped.text.replace(/<[^<>]*>/g, " ");
  if (/[<>]/.test(rest)) return "";
  const bare = rest.match(EMAIL_IN_TEXT_RE) ?? [];
  if (angles.length + bare.length !== 1) return "";
  return normalizeAddr((angles.length ? angles[0] : bare[0]) ?? "");
}

/** 「"Smith, Jane" <addr>」→ 「Smith, Jane」；没有显示名返回 "" */
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const cut = raw.split(/<|\[mailto:/i)[0] ?? "";
  const name = cut.replace(/["']/g, "").replace(EMAIL_IN_TEXT_RE, "").replace(/\s+/g, " ").trim();
  return name.length > 80 ? "" : name;
}

function domainOf(addr: string): string {
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : "";
}

function domainMatches(domain: string, base: string): boolean {
  return domain === base || domain.endsWith(`.${base}`);
}

export function isSystemAddress(addr: string): boolean {
  const local = addr.split("@")[0] ?? "";
  return SYSTEM_LOCAL_RE.test(local);
}

export function platformOfAddress(addr: string): B2bPlatform | null {
  const d = domainOf(addr);
  if (!d) return null;
  for (const p of PLATFORMS) if (p.domains.some((base) => domainMatches(d, base))) return p.key;
  return null;
}

// ── 转发头 ──────────────────────────────────────────────────────────────────

type HeaderKey = "from" | "date" | "to" | "cc" | "subject" | "replyTo";

const HEADER_ALIASES: Record<string, HeaderKey> = {
  from: "from", "发件人": "from", "寄件者": "from", "发信人": "from", "寄件人": "from",
  date: "date", sent: "date", "发送时间": "date", "日期": "date", "时间": "date", "寄件日期": "date", "发送日期": "date",
  to: "to", "收件人": "to", "收件者": "to",
  cc: "cc", "抄送": "cc", "副本": "cc",
  subject: "subject", "主题": "subject", "主旨": "subject",
  "reply-to": "replyTo", "回复至": "replyTo", "答复": "replyTo",
};

// 别名里没有正则元字符；与 HEADER_ALIASES 同源，不会漏改
const HEADER_LINE_RE = new RegExp(`^[*_>\\s]{0,4}(${Object.keys(HEADER_ALIASES).join("|")})[*_\\s]{0,3}[:：][*_\\s]{0,3}(.*)$`, "i");

type ForwardMarker = "gmail" | "outlook" | "apple";

/** 转发分隔行；QQ / Foxmail 的「---- Original ----」按 Outlook 计（Outlook 的「____」分隔行靠其后的 Sent: 识别） */
function markerOf(line: string): ForwardMarker | null {
  const l = line.replace(/[*_]/g, "").trim();
  if (/^-{2,}\s*(forwarded message|转发的邮件|转发邮件|已转发邮件)\s*-{2,}$/i.test(l)) return "gmail";
  if (/^begin forwarded message:?$/i.test(l) || /^开始转发的邮件[:：]?$/.test(l)) return "apple";
  if (/^-{2,}\s*(original message|原始邮件|原邮件)\s*-{2,}$/i.test(l) || /^-{4,}\s*original\s*-{4,}$/i.test(l)) return "outlook";
  return null;
}

function headerOf(line: string): { key: HeaderKey; value: string } | null {
  const m = line.match(HEADER_LINE_RE);
  return m ? { key: HEADER_ALIASES[m[1].toLowerCase()], value: m[2].replace(/[*_]+$/g, "").trim() } : null;
}

interface Segment {
  headers: Partial<Record<HeaderKey, string>> | null;
  marker: ForwardMarker | null;
  usesSent: boolean;
  lines: string[];
}

/** 从 From: 行开始读一个转发头块；Date/Sent、To、Subject 至少出现两个才算（避免把正文里的 "From:" 当头） */
function readHeaderBlock(lines: string[], start: number): { headers: Partial<Record<HeaderKey, string>>; usesSent: boolean; end: number } | null {
  const headers: Partial<Record<HeaderKey, string>> = {};
  let usesSent = false;
  let last: HeaderKey | null = null;
  let j = start;
  for (; j < lines.length && j < start + 14; j++) {
    const line = lines[j];
    if (!line.trim()) break;
    const h = headerOf(line);
    if (h) {
      if (j > start && h.key === "from") break;
      if (headers[h.key] === undefined) headers[h.key] = h.value;
      if (/^[*_>\s]{0,4}sent\b/i.test(line) || /发送时间/.test(line)) usesSent = true;
      last = h.key;
      continue;
    }
    // 折行的收件人 / 发件人地址（只接像地址的续行；头与正文之间没有空行时不能把正文吞进头里）
    const prev = last ? headers[last] ?? "" : "";
    if (last && (last === "to" || last === "cc" || last === "from") && j > start && (line.includes("@") || /[,;]$/.test(prev))) {
      headers[last] = `${prev} ${line.trim()}`.trim();
      continue;
    }
    break;
  }
  const seen = (["date", "to", "subject"] as const).filter((k) => headers[k] !== undefined).length;
  if (!headers.from || seen < 2) return null;
  return { headers, usesSent, end: j };
}

function splitSegments(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { headers: null, marker: null, usesSent: false, lines: [] };
  let pendingMarker: ForwardMarker | null = null;
  for (let i = 0; i < lines.length; ) {
    const marker = markerOf(lines[i]);
    if (marker) {
      pendingMarker = marker;
      i++;
      continue;
    }
    if (headerOf(lines[i])?.key === "from") {
      const block = readHeaderBlock(lines, i);
      if (block) {
        segments.push(current);
        current = { headers: block.headers, marker: pendingMarker, usesSent: block.usesSent, lines: [] };
        pendingMarker = null;
        i = block.end;
        continue;
      }
    }
    if (lines[i].trim()) pendingMarker = null;
    current.lines.push(lines[i]);
    i++;
  }
  segments.push(current);
  return segments;
}

// ── 引用与签名 ──────────────────────────────────────────────────────────────

const REPLY_INTRO_RES = [
  /^on\b.{0,300}\bwrote:\s*$/i,
  /^在.{0,200}写道[:：]?\s*$/,
  /^.{0,200}于.{0,120}写道[:：]\s*$/,
  /^le .{0,200}a écrit\s*:\s*$/i,
  /^am .{0,200}schrieb .{0,200}:\s*$/i,
  /^el .{0,200}escribió:\s*$/i,
];

const REPLY_HINT_RE = /wrote:|写道|a écrit|schrieb|escribió/i;

function isReplyIntro(line: string, next: string | undefined): boolean {
  const l = line.trim();
  if (l.length > 600) return false;
  // 先用便宜的关键字过滤，再跑带 .{0,n} 的完整规则（避免长行上逐行做大量回溯）
  if (REPLY_HINT_RE.test(l) && REPLY_INTRO_RES.some((re) => re.test(l))) return true;
  // Gmail 纯文本把 "On …, Name <\naddr> wrote:" 折成两行
  return /^on\b/i.test(l) && next !== undefined && l.length + next.length < 400 && /\bwrote:\s*$/i.test(next.trim());
}

function unquoteIfMostlyQuoted(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim());
  const quoted = nonEmpty.filter((l) => /^>/.test(l.trim()));
  if (nonEmpty.length >= 2 && quoted.length / nonEmpty.length >= 0.6) {
    return lines.map((l) => l.replace(/^\s*>\s?/, ""));
  }
  return lines;
}

/** 去掉引用的历史回复：从第一个 "On … wrote:" 起截断，并删掉 ">" 引用行 */
function stripQuotedReplies(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isReplyIntro(lines[i], lines[i + 1])) break;
    if (/^\s*>/.test(lines[i])) continue;
    out.push(lines[i]);
  }
  return out;
}

const MOBILE_FOOTER_RE = /^(sent from my|sent from (outlook|mail|yahoo)|get outlook for|发自我的|从我的.{0,10}发送|来自我的)/i;
const CLOSING_RE =
  /^((best|kind|warm|warmest|many)\s+(regards|wishes|thanks)|regards|best|thanks?( you)?( (and|&) (best )?regards)?|many thanks|thanks in advance|sincerely( yours)?|yours (sincerely|faithfully|truly)|cheers|br|b\.r\.|best wishes|此致|此致敬礼|祝好|谢谢|顺颂商祺|敬上)[\s,.!，。！]*$/i;

/** 签名分隔符 "-- " 或手机落款（已去首尾空白）：其后都是签名 */
function isSigBreak(l: string): boolean {
  return l === "--" || l === "—" || l === "__" || MOBILE_FOOTER_RE.test(l);
}

/** 签名之后的尾巴（P.S.、保密 / 免责声明、环保提示）：从这里起不再看，之前的结束语照样算签名起点 */
const SIG_TRAILER_RE =
  /^(p\.?\s?s\b|confidential(ity)?\b|disclaimer\b|legal notice\b|privacy notice\b|please consider the environment|follow us\b|(this|the information (contained )?in this) (e-?mail|message|communication)\b.{0,100}\b(confidential|privileged|intended (solely |only )?for)|免责声明|保密声明)/i;
/** P.S. 是写信人自己的话：紧跟在结束语后面（中间没有签名行）时结束语不算落款，P.S. 留在正文里 */
const POSTSCRIPT_RE = /^p\.?\s?s\b/i;
/** 询价正文的痕迹：数量 / 规格 / 贸易术语 / 问句。签名里不会有，出现了就不是签名（尺寸只认 × / *，ASCII x 会撞上电话分机「x 23」） */
const BODY_HINT_RE =
  /\d\s?(pcs|pc|pieces?|sets?|units?|cartons?|ctns?|dozens?|pairs?|rolls?|containers?|gsm|cm|mm|kgs?|tons?)\b|\d\s?[×*]\s?\d|\b(moq|fob|cif|exw|qty|quantity)\b|[?？](\s|$)|\d\s?(件|套|条|个|箱|米|吨)/i;
/** 请求 / 询价用语：带这些词的句子是正文，不是签名后的标语 */
const REQUEST_WORD_RE =
  /\b(please|pls|plz|kindly|ask|call|check|follow|reply|send|need|needs|want|wants|wanted|would like|looking for|interested in|quote)\b|请|麻烦|帮忙|跟进|需要|想要|报价/i;
/** 只有称呼的行（「Hi team,」「Hello Lily,」「您好，」）：称呼后面紧跟的结束语在信的开头，不是落款 */
const GREETING_LINE_RE =
  /^((hi|hello|hey|dear|greetings|good (morning|afternoon|evening|day))\b[\s\w.'/&-]{0,30}|您好|你好|大家好|各位好?|亲爱的[\s\S]{0,10})[\s,，!！:：。.]*$/i;

/** 60 字以上仍像签名的行要有签名的样子：分隔符 / 网址 / 邮箱 / 公司后缀 / 职位 / 带门牌号的地址 / 电话位数 */
function looksLikeLongSigLine(l: string): boolean {
  return (
    /[|•·]|https?:\/\/|www\.|@/i.test(l) ||
    COMPANY_SUFFIX_RE.test(l) ||
    TITLE_WORD_RE.test(l) ||
    (/\d/.test(l) && ADDRESS_HINT_RE.test(l)) ||
    digitCount(l) >= 7
  );
}

/**
 * 结束语之后一行的性质：sig = 像签名（不像句子；≤ 60 字，或 ≤ 100 字且有签名的样子：长地址行、单行签名）；
 * slogan = 签名下面的短句（「We are your partner in home comfort」），只在结束语之后先有像样的签名时容忍；
 * body = 正文（过长、带数量规格或问句、带请求用语的句子、「Buyer / 客户」标签的买家字段）。
 */
function tailLineKind(l: string): "sig" | "slogan" | "body" {
  if (l.length > 100 || BODY_HINT_RE.test(l)) return "body";
  const hit = labelOf(l);
  if (hit && hit.key !== "meta" && BUYERISH_LABEL_RE.test(hit.label)) return "body";
  if (!SENTENCE_WORD_RE.test(l)) return l.length <= 60 || looksLikeLongSigLine(l) ? "sig" : "body";
  return l.length <= 80 && !l.includes("@") && !REQUEST_WORD_RE.test(l) ? "slogan" : "body";
}

/**
 * 本厂人员写的内容里，结束语之后的行（见 closingLines 的 staff 参数）：
 * - kind(j) = "body"：一定是正文（带外部邮箱的 P.S.，或带外部邮箱且行里点明 buyer / customer / 客户）；
 * - kind(j) = "maybe"：像签名的行里有不属于本厂的邮箱，可能是买家联系方式，也可能是业务员自己的私人邮箱；
 * - ownSignOff(j)：第 j 行是业务员自己的落款（转发人姓名行、中文姓名行、本厂邮箱行）。
 */
interface StaffTail {
  kind: (j: number) => "body" | "maybe" | null;
  ownSignOff: (j: number) => boolean;
}

/**
 * closing[i]：第 i 行是短结束语，且其后（到签名分隔符 / 签名尾巴 / stop(j) 行为止）没有正文行，第一个非空行像签名
 * （或直接到了分隔处，但紧跟 P.S. 的不算）；其后有标语时，结束语前面要已有正文（不在信的开头），
 * 且标语前要有两行以上签名或一行联系方式 / 公司 / 职位行（「Thanks!\nJane\nMy colleague will …」不算落款）。
 * 短邮件开头的「Thanks!」后面还有正文时不算，否则正文和其中的买家联系方式会被当成签名丢掉；
 * 签名后面的长地址、单行签名、标语、P.S.、保密声明不妨碍结束语成立。
 *
 * staff（本厂人员写的内容）：
 * - 结束语后第一行是业务员自己的落款：结束语成立，落款下面像签名的行（私人邮箱 / WhatsApp）都是业务员的签名；
 *   其后若还有正文 / 标语 / P.S.（如「Buyer email: …」），resume[i] 记下正文从哪一行接着开始，签名只切到那里为止，
 *   不然后面的买家信息会随签名丢掉；
 *   而让结束语不成立的话，业务员签名里的号码会留在正文、紧挨买家邮箱时被当成买家电话（Revenue Spine 按电话并客户）。
 * - 否则「maybe」行只在结束语紧跟称呼（「Hi team,\n谢谢\nJane Doe …\njane@…」）时算正文；结束语前面已有正文、
 *   或结束语就是第一行时，它们是落款后的签名，照旧切掉（宁可漏取买家邮箱，也不把业务员的私人邮箱当买家）。
 * 从末尾一趟（加一趟从头算「前面只有称呼」），线性。resume[i] = -1：签名一直到末尾。
 */
function closingLines(
  lines: string[],
  stop: (j: number) => boolean = () => false,
  staff?: StaffTail,
): { closing: boolean[]; resume: number[] } {
  const closing = lines.map(() => false);
  const resume = lines.map(() => -1);
  // atTop[i]：第 i 行前面（到上一个 stop 行为止）只有空行 / 称呼；greeted[i]：并且确有称呼
  const atTop = lines.map(() => true);
  const greeted = lines.map(() => false);
  let seen = false;
  let greeting = false;
  for (let i = 0; i < lines.length; i++) {
    atTop[i] = !seen;
    greeted[i] = !seen && greeting;
    const l = lines[i].trim();
    if (stop(i)) seen = greeting = false;
    else if (l && l.length <= 60 && GREETING_LINE_RE.test(l) && !SENTENCE_WORD_RE.test(l)) greeting = true;
    else if (l) seen = true;
  }
  let clean = true; // 其后到分隔处为止没有正文行
  let first: "none" | "ps" | "sig" | "other" = "none"; // 其后第一个非空行（ps：直接是 P.S.）
  let firstIdx = -1;
  let topOther = -1; // 其后到分隔处为止最上面的非签名行（正文 / 标语）
  let slogan = false; // 其后有标语
  let sigRun = 0; // 结束语与（最上面的）标语之间的签名行数
  let contactSig = false; // 其中有联系方式 / 公司 / 职位行
  let maybe = false; // 其后有 staff.kind = "maybe" 的行
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.length <= 40 && CLOSING_RE.test(l)) {
      const own = !!staff && first === "sig" && staff.ownSignOff(firstIdx);
      closing[i] =
        own ||
        (clean &&
          (first === "none" || first === "sig") &&
          (!slogan || (!atTop[i] && (sigRun >= 2 || contactSig))) &&
          !(maybe && greeted[i]));
      if (closing[i]) {
        // 紧跟的下一行也是结束语（「Thanks,\nBest regards,\nLily …」）时沿用它的 resume
        resume[i] = own ? topOther : firstIdx >= 0 && closing[firstIdx] ? resume[firstIdx] : -1;
        // 再往上的结束语只看这一行；其下的签名已经归它
        first = "sig";
        firstIdx = i;
        clean = true;
        topOther = -1;
        slogan = maybe = contactSig = false;
        sigRun = 1;
        continue;
      }
    }
    const sk = staff?.kind(i) ?? null;
    if (sk !== "body" && (isSigBreak(l) || stop(i) || SIG_TRAILER_RE.test(l))) {
      clean = true;
      first = POSTSCRIPT_RE.test(l) ? "ps" : "none";
      firstIdx = -1;
      // 业务员落款下面的 P.S. 是业务员自己的话：落款只切到 P.S. 之前（买家签名后的 P.S. 照旧随签名切掉）
      topOther = staff && first === "ps" ? i : -1;
      slogan = maybe = contactSig = false;
      sigRun = 0;
      continue;
    }
    if (sk === "maybe") maybe = true;
    const kind = sk === "body" ? "body" : tailLineKind(l);
    if (kind === "body") clean = false;
    if (kind === "slogan") {
      slogan = true;
      sigRun = 0;
      contactSig = false;
    } else if (kind === "sig") {
      sigRun++;
      contactSig ||= looksLikeLongSigLine(l) || CONTACT_LABEL_RE.test(l);
    }
    if (kind !== "sig") topOther = i;
    first = kind === "sig" ? "sig" : "other";
    firstIdx = i;
  }
  return { closing, resume };
}

/**
 * 切出签名：签名分隔符、手机落款、或结尾 15 行内其后只剩签名的短结束语；返回正文行与签名行。
 * 结束语之后、签名之后的 P.S. 随签名一起切掉、不进留言（与早先的解析器一致；买家的签名区里留下它就得把签名拆成两段）；
 * 紧跟在结束语后面、前面没有签名行的 P.S. 不算签名尾巴，结束语不成立，P.S. 留在留言里。
 * 本厂人员写的内容：业务员落款下面接着的正文（resume）留在正文里，只切掉落款那几行。
 */
function splitSignature(lines: string[], staff?: StaffTail): { body: string[]; signature: string[] } {
  const nonEmptyIdx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const tailStart = nonEmptyIdx.length > 15 ? nonEmptyIdx[nonEmptyIdx.length - 15] : 0;
  const { closing, resume } = closingLines(lines, undefined, staff);
  const cut = lines.findIndex((l, i) => isSigBreak(l.trim()) || (i >= tailStart && closing[i]));
  if (cut < 0) return { body: lines, signature: [] };
  const back = closing[cut] ? resume[cut] : -1;
  if (back < 0) return { body: lines.slice(0, cut), signature: lines.slice(cut + 1) };
  return { body: [...lines.slice(0, cut), ...lines.slice(back)], signature: lines.slice(cut + 1, back) };
}

// ── 标签字段（平台通知 / 官网通知 / 签名） ──────────────────────────────────

type FieldKey =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "country"
  | "product"
  | "quantity"
  | "message"
  | "inquiryId"
  | "eventId"
  | "contact"
  | "from";

const FIELD_ALIASES: Record<string, FieldKey> = {
  name: "name", "full name": "name", "your name": "name", "buyer": "name", "buyer name": "name", "contact name": "name",
  "contact person": "name", "first name": "name", "姓名": "name", "联系人": "name", "买家": "name", "买家姓名": "name", "客户": "name",
  email: "email", "e-mail": "email", "email address": "email", "e-mail address": "email", "buyer email": "email", "邮箱": "email", "电子邮件": "email", "电子邮箱": "email",
  phone: "phone", tel: "phone", telephone: "phone", mobile: "phone", whatsapp: "phone", "whatsapp / phone": "phone", "phone / whatsapp": "phone",
  "whatsapp/phone": "phone", "phone/whatsapp": "phone", "phone number": "phone", "mobile phone": "phone", "电话": "phone", "手机": "phone", "联系电话": "phone",
  "buyer phone": "phone", "buyer tel": "phone", "buyer mobile": "phone", "buyer whatsapp": "phone", "customer phone": "phone", "customer tel": "phone",
  "customer mobile": "phone", "customer whatsapp": "phone", "client phone": "phone", "client whatsapp": "phone",
  "客户电话": "phone", "客户手机": "phone", "买家电话": "phone", "买家手机": "phone", "客户whatsapp": "phone",
  "customer name": "name", "client name": "name", "客户姓名": "name", "customer email": "email", "client email": "email", "客户邮箱": "email", "买家邮箱": "email",
  company: "company", "company name": "company", organization: "company", organisation: "company", "buyer company": "company", "公司": "company", "公司名称": "company", "买家公司": "company",
  country: "country", "country / region": "country", "country/region": "country", region: "country", "buyer country": "country", location: "country",
  "国家": "country", "国家/地区": "country", "国家 / 地区": "country", "地区": "country",
  product: "product", products: "product", "product interest": "product", "product name": "product", item: "product", "product inquired": "product",
  "inquired product": "product", "产品": "product", "产品名称": "product", "意向产品": "product", "询价产品": "product",
  quantity: "quantity", "estimated quantity": "quantity", "purchase quantity": "quantity", "order quantity": "quantity", qty: "quantity",
  "quantity required": "quantity", "数量": "quantity", "采购数量": "quantity", "预计数量": "quantity",
  message: "message", inquiry: "message", "inquiry content": "message", "inquiry details": "message", content: "message", details: "message",
  requirements: "message", "message content": "message", "留言": "message", "询盘内容": "message", "内容": "message", "需求": "message", "需求描述": "message",
  "inquiry id": "inquiryId", "inquiry no": "inquiryId", "inquiry number": "inquiryId", "rfq id": "inquiryId",
  "rfq no": "inquiryId", "询盘编号": "inquiryId", "询盘号": "inquiryId", "询价单号": "inquiryId",
  "inquiry id / eventid": "eventId", "inquiry id/eventid": "eventId", eventid: "eventId", "event id": "eventId",
  contact: "contact", "联系方式": "contact",
  from: "from",
};

/** 平台 / 官网通知的页脚套话：多行留言收集到这里为止 */
const NOTICE_FOOTER_RE =
  /^(reply to this (inquiry|message)|view (the |this )?(inquiry|message|details)|log ?in to|sign in to|click here|to reply|please reply|unsubscribe|this (e-?mail|message) (was|is) (sent|generated)|do not reply|copyright|©|all rights reserved|to keep your account (safe|secure)|回复此询盘|登录.{0,10}(查看|回复)|点击.{0,10}(查看|回复)|本邮件由系统)/i;

/** 通知页脚里常见的元数据标签：不取值，但多行留言收集到这里为止 */
const META_LABELS = new Set([
  "inquiry source", "source", "source page", "page", "landing page", "referrer", "referer", "utm", "submitted at", "submitted",
  "submission time", "submit time", "time", "ip", "ip address", "user agent", "来源", "来源页", "来源页面", "提交时间", "询盘来源",
]);

const LABEL_LINE_RE = /^[*_\s]{0,3}([A-Za-z\u4e00-\u9fa5][A-Za-z\u4e00-\u9fa5 /.&'-]{0,40}?)[*_\s]{0,3}(?:[:：]|\t)[*_\s]{0,3}(.*)$/;
const EMPTY_VALUE_RE = /^(not provided|n\/a|na|none|nil|null|-+|—+|未填写|未提供|无)$/i;

function normLabel(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function labelOf(line: string): { key: FieldKey | "meta"; value: string; label: string } | null {
  const m = line.match(LABEL_LINE_RE);
  if (!m) {
    // HTML 通知里「Message」常单独成行（标题加粗、正文在下一块）
    const bare = line.length <= 40 ? normLabel(line.replace(/[*_:：]/g, "")) : "";
    return bare && FIELD_ALIASES[bare] === "message" ? { key: "message", value: "", label: bare } : null;
  }
  const label = normLabel(m[1]);
  if (META_LABELS.has(label)) return { key: "meta", value: "", label };
  const key = FIELD_ALIASES[label];
  if (!key) return null;
  const value = m[2].replace(/\t+/g, " ").replace(/[*_]+$/g, "").trim();
  return { key, value: EMPTY_VALUE_RE.test(value) ? "" : value, label };
}

function extractLabeledFields(lines: string[]): { fields: Partial<Record<FieldKey, string>>; labelLines: Set<number> } {
  const fields: Partial<Record<FieldKey, string>> = {};
  const labelLines = new Set<number>();
  const labels = lines.map(labelOf);
  // 留言里的结束语：其后到下一个标签 / 通知页脚之间只剩签名才算
  const { closing } = closingLines(lines, (j) => !!labels[j] || NOTICE_FOOTER_RE.test(lines[j].trim()));
  for (let i = 0; i < lines.length; i++) {
    const hit = labels[i];
    if (!hit) continue;
    labelLines.add(i);
    if (hit.key === "meta") continue;
    if (hit.key === "message") {
      // 多行留言：值在下一行起，直到下一个已知标签 / 通知页脚 / 结束语
      const parts = hit.value ? [hit.value] : [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (labels[j] || NOTICE_FOOTER_RE.test(lines[j].trim()) || closing[j]) break;
        parts.push(lines[j]);
        labelLines.add(j);
      }
      const text = parts.join("\n").trim();
      if (text && !fields.message) fields.message = text;
      i = j - 1;
      continue;
    }
    if (hit.value && fields[hit.key] === undefined) fields[hit.key] = hit.value;
  }
  return { fields, labelLines };
}

const PHONE_LABELED_RE = /^(?:tel|phone|mobile|mob|cell|whatsapp|wa|m|t|电话|手机)\.?\s*[:：.]?\s*(\+?\d[\d\s().-]{6,24}\d)/i;
const PHONE_BARE_RE = /^(\+\d[\d\s().-]{6,24}\d)$/;
const COMPANY_SUFFIX_RE =
  /\b(co\.?,?\s*ltd\.?|company|inc\.?|incorporated|llc|l\.l\.c\.|gmbh|limited|ltd\.?|corp\.?|corporation|s\.a\.?|s\.r\.l\.?|b\.v\.?|pty|plc|ag|oy|trading|group|enterprises?|industries)\b|有限公司|公司$/i;

export function cleanPhone(raw: string): string {
  const v = raw.replace(/\s+/g, " ").trim().slice(0, 60).trimEnd();
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 16 ? v : "";
}

function minePhone(lines: string[]): string {
  for (const line of lines) {
    const l = line.trim();
    const m = l.match(PHONE_LABELED_RE) ?? l.match(PHONE_BARE_RE);
    if (m) {
      const p = cleanPhone(m[1]);
      if (p) return p;
    }
  }
  return "";
}

function mineCompany(lines: string[]): string {
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.length > 100 || l.includes("@") || /https?:\/\//i.test(l)) continue;
    if (l.split(/\s+/).length > 10) continue;
    if (COMPANY_SUFFIX_RE.test(l)) return l.replace(/^[|•·\s-]+/, "").trim();
  }
  return "";
}

/** 签名前 3 行里第一个非空行像人名时取它 */
function mineSignatureName(lines: string[]): string {
  const l = lines.slice(0, 3).find((x) => x.trim())?.trim() ?? "";
  const latin = /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(l) && l.length <= 40 && !COMPANY_SUFFIX_RE.test(l);
  return latin || /^[\u4e00-\u9fa5]{2,4}$/.test(l) ? l : "";
}

// ── 本厂人员自己写的内容：签名识别 ──────────────────────────────────────────
//
// 业务员手写 / 整条链都是同事时，签名是转发人自己的：其中的电话、公司绝不能当买家信息（否则 Revenue Spine 会按
// 电话把不相干的买家并到同一客户）。很多签名没有 "--" 或结束语，这里从末尾往上找：末尾连续的「像签名的行」
// （联系方式 / 地址 / 网址 / 短名字）里，从第一条「锚点行」（转发人姓名行、职位行、公司行、本厂邮箱行）起算签名。

interface StaffIdentity {
  /** 小写：显示名全称、首个词、邮箱本地部分（非 sales/info 这类通用名） */
  names: string[];
  isStaffAddr: (addr: string) => boolean;
}

type SigClass = "blank" | "anchor" | "sig" | "namey" | "other";

const TITLE_WORD_RE =
  /\b(manager|director|executive|representative|rep|assistant|coordinator|specialist|officer|merchandiser|engineer|consultant|supervisor|president|founder|owner|ceo|cfo|coo|cto|gm|vp|head of [a-z]+)\b|经理|总监|主管|董事|跟单|助理|专员|业务员|业务代表|销售代表|外贸|厂长|总裁|老板/i;
const SENTENCE_WORD_RE =
  /\b(please|pls|plz|kindly|ask|call|check|follow|reply|send|need|needs|want|wants|wanted|is|are|was|were|from|we|he|she|they|our|his|her|their|would|will|can|could|thanks|thank|this|that|wrote)\b|请|麻烦|帮忙|跟进|需要|想要/i;
const CONTACT_LABEL_RE =
  /^[*_\s]{0,3}(?:tel|tele|telephone|phone|mobile|mob|cell|whatsapp|wa|wechat|weixin|skype|qq|line|viber|fax|email|e-mail|mail|web|website|site|url|add|addr|address|电话|手机|微信|传真|邮箱|网址|网站|地址|[mtfew])\.?\s*[:：]/i;
const BARE_PHONE_LINE_RE = /^\+?\(?\d[\d\s().\-/]{5,24}\d$/;
const URL_LINE_RE = /^(https?:\/\/|www\.)\S+$/i;
const ADDRESS_HINT_RE = /\b(road|rd|street|st|avenue|ave|district|province|zone|industrial|park|building|bldg|floor|room|suite|no)\b|路|街|区|市|省|号|楼|室|镇|县|园/i;
const NAMEY_LINE_RE = /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}$/;
const GENERIC_LOCALS = new Set([
  "info", "sales", "admin", "service", "support", "contact", "export", "office", "inquiry", "inquiries", "enquiry", "marketing",
  "hello", "team", "mail", "business", "trade", "website", "web", "site",
]);
const PHONE_IN_LINE_RE = /\+?\d[\d\s().-]{5,24}\d/g;
const BUYERISH_LABEL_RE = /buyer|customer|client|客户|买家/i;

function digitCount(s: string): number {
  return s.replace(/\D/g, "").length;
}

function phoneKey(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-9) : "";
}

function staffIdentity(froms: Array<string | null | undefined>, isStaffAddr: (a: string) => boolean): StaffIdentity {
  const names = new Set<string>();
  for (const raw of froms) {
    if (!raw) continue;
    const dn = displayName(raw).toLowerCase();
    if (dn.length >= 2) {
      names.add(dn);
      const first = dn.split(/[\s,]+/)[0] ?? "";
      if (first.length >= 2) names.add(first);
    }
    const addr = bareAddress(raw);
    const local = (addr.split("@")[0] ?? "").split(/[._+-]/)[0] ?? "";
    if (/^[a-z]{3,}$/.test(local) && !GENERIC_LOCALS.has(local) && !isSystemAddress(addr)) names.add(local);
  }
  return { names: [...names].sort((a, b) => b.length - a.length), isStaffAddr };
}

/** 「Lily」「Lily Chen」「Lily | Sales Manager」「李丽 | 销售经理」；「Lily, this one is for you.」不算 */
function isStaffNameLine(l: string, id: StaffIdentity): boolean {
  const low = l.toLowerCase();
  for (const n of id.names) {
    if (!low.startsWith(n)) continue;
    const rest = l.slice(n.length);
    if (rest && !/^[\s|,/·•()\-–—]/.test(rest)) continue;
    const tail = rest.replace(/^[\s|,/·•()\-–—]+/, "").trim();
    if (!tail) return true;
    if (tail.length > 60 || /[:：@]/.test(tail) || SENTENCE_WORD_RE.test(tail)) continue;
    if (TITLE_WORD_RE.test(tail) || COMPANY_SUFFIX_RE.test(tail)) return true;
    if (tail.split(/\s+/).length <= 3 && /^(\p{Lu}|[一-龥])/u.test(tail)) return true;
  }
  return false;
}

function classifySignatureLine(raw: string, id: StaffIdentity): SigClass {
  const l = raw.trim().replace(/^[|•·]\s*/, "");
  if (!l) return "blank";
  if (l.length > 140) return "other";
  const sentence = SENTENCE_WORD_RE.test(l);
  const emails = l.match(EMAIL_IN_TEXT_RE) ?? [];
  if (emails.length) {
    // 买家 / 第三方邮箱所在行不是本厂签名；只有本厂邮箱的短行（「Email: lily@本厂」）是锚点
    if (emails.some((e) => !id.isStaffAddr(e.toLowerCase()))) return "other";
    return !sentence && l.length <= 100 ? "anchor" : "other";
  }
  if (l.length <= 40 && CLOSING_RE.test(l)) return "namey";
  if (isStaffNameLine(l, id)) return "anchor";
  if (CONTACT_LABEL_RE.test(l)) return "sig";
  if (BARE_PHONE_LINE_RE.test(l) && digitCount(l) >= 7 && digitCount(l) <= 16) return "sig";
  if (URL_LINE_RE.test(l)) return "sig";
  if (!sentence && !/[:：]/.test(l)) {
    const words = l.split(/\s+/).length;
    if (l.length <= 60 && words <= 7 && TITLE_WORD_RE.test(l)) return "anchor";
    if (l.length <= 100 && words <= 10 && COMPANY_SUFFIX_RE.test(l) && !/https?:\/\//i.test(l)) return "anchor";
    if (/\d/.test(l) && ADDRESS_HINT_RE.test(l)) return "sig";
    if ((NAMEY_LINE_RE.test(l) && l.length <= 30) || /^[一-龥]{2,4}$/.test(l)) return "namey";
  }
  if (labelOf(l)?.key === "company") return "sig";
  return "other";
}

/** 本厂人员自己写的内容里签名起始行；没有识别出签名返回 -1 */
function staffSignatureStart(lines: string[], id: StaffIdentity): { start: number; classes: SigClass[] } {
  const classes = lines.map((l) => classifySignatureLine(l, id));
  let suffix = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (classes[i] === "other") break;
    suffix = i;
  }
  const anchor = classes.indexOf("anchor", suffix);
  if (anchor < 0) return { start: -1, classes };
  let start = anchor;
  while (start - 1 >= suffix && classes[start - 1] === "namey") start--;
  return { start, classes };
}

/**
 * 业务员自己的落款行：转发人姓名行（「Lily」「Lily Chen | Sales」）、2–4 字中文姓名行（显示名常是英文名，落款用中文名）、
 * 只有本厂邮箱的行；公司行不算（也可能是买家公司）
 */
function isOwnSignOffLine(raw: string, id: StaffIdentity): boolean {
  const l = raw.trim().replace(/^[|•·]\s*/, "");
  if (isStaffNameLine(l, id) || /^[一-龥]{2,4}$/.test(l)) return true;
  const emails = l.match(EMAIL_IN_TEXT_RE) ?? [];
  return emails.length > 0 && emails.every((e) => id.isStaffAddr(e.toLowerCase()));
}

/**
 * 本厂人员写的内容：结束语后面各行的性质（见 closingLines）。买家邮箱只按地址判断不了——业务员签名里的私人邮箱
 * （Gmail / 163）同样「不是本厂地址」，所以只有带外部邮箱的 P.S.、或带外部邮箱且点明 buyer / customer / 客户的行
 * 一定是正文，其余像签名的带外部邮箱行交给 closingLines 按位置判断。
 */
function staffTail(lines: string[], id: StaffIdentity, isBuyerEmail: (addr: string) => boolean): StaffTail {
  return {
    kind: (j) => {
      const l = lines[j].trim();
      const emails = l.match(EMAIL_IN_TEXT_RE) ?? [];
      if (!emails.some((a) => isBuyerEmail(a.toLowerCase()))) return null;
      return POSTSCRIPT_RE.test(l) || BUYERISH_LABEL_RE.test(l.replace(EMAIL_IN_TEXT_RE, " ")) ? "body" : "maybe";
    },
    ownSignOff: (j) => j >= 0 && isOwnSignOffLine(lines[j], id),
  };
}

function phoneKeysIn(lines: string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of lines) {
    for (const m of line.match(PHONE_IN_LINE_RE) ?? []) {
      const k = phoneKey(cleanPhone(m));
      if (k) keys.add(k);
    }
  }
  return keys;
}

/**
 * 本厂人员写的内容里取买家电话：只认带标签的电话行（Phone / Tel / WhatsApp / 联系方式 …），并且
 *   - 不在签名里、号码不等于签名 / 被截掉部分里出现过的任何号码；
 *   - 标签本身点明是买家（Buyer phone / 客户电话），或上下 3 个非空行内有买家姓名 / 买家邮箱标签行，
 *     且中间没有隔着转发人姓名行、职位行、公司行这类签名锚点。
 * 宁可漏取（没有其它联系方式时按「无买家联系方式」隔离，管理员会收到通知），也不把转发人的号码当成买家。
 */
function staffNotePhone(
  lines: string[],
  classes: SigClass[],
  staffKeys: Set<string>,
  isBuyerEmail: (addr: string) => boolean,
  staffNames: readonly string[],
): string {
  const identityAt = (j: number): boolean => {
    const hit = labelOf(lines[j]);
    if (!hit || !hit.value) return false;
    if (hit.key === "email" || (hit.key === "contact" && hit.value.includes("@"))) return isBuyerEmail(bareAddress(hit.value));
    if (hit.key === "name") return !staffNames.includes(hit.value.toLowerCase());
    return false;
  };
  const nearIdentity = (idx: number): boolean => {
    for (const dir of [-1, 1]) {
      let seen = 0;
      for (let j = idx + dir; j >= 0 && j < lines.length && seen < 3; j += dir) {
        if (!lines[j].trim()) continue;
        seen++;
        if (identityAt(j)) return true;
        if (classes[j] === "anchor" || classes[j] === "namey") break;
      }
    }
    return false;
  };
  for (let i = 0; i < lines.length; i++) {
    const hit = labelOf(lines[i]);
    if (!hit || (hit.key !== "phone" && hit.key !== "contact") || !hit.value || hit.value.includes("@")) continue;
    const phone = cleanPhone(hit.value);
    if (!phone || staffKeys.has(phoneKey(phone))) continue;
    if (BUYERISH_LABEL_RE.test(hit.label) || nearIdentity(i)) return phone;
  }
  return "";
}

// ── 主题 ────────────────────────────────────────────────────────────────────

export function stripSubjectPrefixes(subject: string | null | undefined): string {
  let s = (subject ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^\s*(fwd?|fw|re|aw|wg|tr|转发|回复|答复)\s*[:：]\s*/i, "").replace(/^\s*\[(fwd?|fw)\]\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

function oneLine(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max).trimEnd();
}

function tidyMessage(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MESSAGE_MAX);
}

export function parseForwardedEmail(input: ForwardedEmailInput): ParsedForwardedEmail {
  const signals: string[] = [];
  const text = input.text && input.text.trim() ? normalizeText(input.text) : input.html ? htmlToText(input.html) : "";
  if (!input.text?.trim() && input.html) signals.push("body:html");
  const lines = text.split("\n").slice(0, MAX_LINES);

  const forwarder = bareAddress(input.from);
  const forwarderDomain = domainOf(forwarder);
  const excluded = new Set<string>([forwarder, ...(input.excludeAddresses ?? []).map((a) => bareAddress(a))].filter(Boolean));
  const excludedDomains = (input.excludeDomains ?? []).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  const isStaff = (addr: string) => {
    if (!addr) return false;
    if (excluded.has(addr)) return true;
    const d = domainOf(addr);
    if (excludedDomains.some((base) => domainMatches(d, base))) return true;
    // 转发人用企业邮箱时，同域地址视为本厂同事（免费邮箱域不算）
    return !!forwarderDomain && !isFreeMailDomain(forwarderDomain) && d === forwarderDomain;
  };
  const buyerEligible = (addr: string) => isValidEmail(addr) && !isStaff(addr) && !isSystemAddress(addr) && !platformOfAddress(addr);

  // 1. 拆转发头，选第一封不是本厂人员发出的邮件
  const segments = splitSegments(lines);
  const forwarded = segments.slice(1);
  let chosen: Segment = segments[0];
  if (forwarded.length) {
    chosen = forwarded.find((s) => !isStaff(bareAddress(s.headers?.from))) ?? forwarded[forwarded.length - 1];
    signals.push(`forward:segments=${forwarded.length}`);
  }
  const first = forwarded[0];
  const forwardFormat: ParsedForwardedEmail["forwardFormat"] = !first
    ? "plain"
    : first.marker
      ? `${first.marker}_forward`
      : first.usesSent
        ? "outlook_forward"
        : "gmail_forward";

  const senderRaw = chosen.headers?.from ?? input.from;
  const senderAddr = bareAddress(senderRaw);
  const replyTo = bareAddress(chosen.headers?.replyTo);
  const originalSubject = stripSubjectPrefixes(chosen.headers?.subject ?? input.subject);
  const originalDate = oneLine(chosen.headers?.date ?? "", 120);

  // 2. 正文：去引用 / 去历史回复 / 切签名
  const bodyLines = stripQuotedReplies(unquoteIfMostlyQuoted(chosen.lines));
  // 选中的是本厂人员自己写的内容（没有转发头 / 整条链都是同事）：签名是转发人的，不能拿来当买家信息；
  // 另外在转发人显示名那一行、以及识别出的签名起始行截断（很多签名没有 "--" 或结束语）
  const chosenFromStaff = !forwarded.length || isStaff(senderAddr);
  const identity = staffIdentity([input.from, chosen.headers?.from], isStaff);
  const split = splitSignature(bodyLines, chosenFromStaff ? staffTail(bodyLines, identity, buyerEligible) : undefined);
  let body = split.body;
  let staffPhoneKeys = new Set<string>();
  let sigClasses: SigClass[] = [];
  let staffNames: string[] = [];
  if (chosenFromStaff) {
    const cutAway: string[] = [...split.signature];
    const forwarderName = displayName(input.from).toLowerCase();
    const cut = forwarderName ? body.findIndex((l) => l.trim().toLowerCase() === forwarderName) : -1;
    if (cut >= 0) {
      cutAway.push(...body.slice(cut));
      body = body.slice(0, cut);
    }
    staffNames = identity.names;
    const sig = staffSignatureStart(body, identity);
    sigClasses = sig.classes;
    if (sig.start >= 0) {
      cutAway.push(...body.slice(sig.start));
      body = body.slice(0, sig.start);
      signals.push("staff_signature");
    }
    staffPhoneKeys = phoneKeysIn(cutAway);
  }
  const signature = chosenFromStaff ? [] : split.signature;
  const all = extractLabeledFields(bodyLines);

  // 3. 平台 / 官网通知识别
  const senderPlatform = platformOfAddress(senderAddr);
  let platform: B2bPlatform | null = senderPlatform;
  if (!platform) {
    const head = `${originalSubject}\n${bodyLines.slice(0, 40).join("\n")}`;
    const named = PLATFORMS.find((p) => p.name.test(head));
    const f = all.fields;
    if (named && /inquir|enquir|rfq|询盘|询价|quotation request/i.test(head) && (f.inquiryId || f.product || f.quantity || f.name)) {
      platform = named.key;
    }
  }
  if (platform) signals.push(`platform:${platform}${senderPlatform ? ":sender" : ":content"}`);

  const systemSender = !!senderAddr && (isSystemAddress(senderAddr) || isStaff(senderAddr));
  const looksLikeWebsiteNotice =
    !platform &&
    (!!all.fields.eventId ||
      (!!all.fields.email && systemSender && /(new|website)\s+(website\s+)?inquir|官网询盘|网站询盘|新询盘/i.test(`${originalSubject}\n${bodyLines.slice(0, 10).join("\n")}`)));

  let format: ForwardFormat = forwardFormat;
  if (platform) format = "platform_notification";
  else if (looksLikeWebsiteNotice) format = "website_notification";
  const notification = format === "platform_notification" || format === "website_notification";
  // 通知：整段都是结构化字段（结尾的平台落款不会出现在字段之前）；本厂人员自己写的：只看签名之前；买家来信：含签名
  const { fields, labelLines } = chosenFromStaff && !notification ? extractLabeledFields(body) : all;

  // 官网询盘编号只认官网通知里的「Inquiry ID / eventId」；买家来信里的「RFQ No. / Inquiry No.」不算
  // （否则买家自己的单号会和官网事件编号撞上，被误判成双重入站）
  const websiteInquiryId = oneLine(fields.eventId ?? (format === "website_notification" ? fields.inquiryId ?? "" : ""), 120);
  const platformInquiryId = platform ? oneLine(fields.inquiryId ?? "", 120) : "";
  if (websiteInquiryId) signals.push("website_inquiry_id");

  // 4. 买家联系方式（转发人永不入选）
  const senderIsBuyer = buyerEligible(senderAddr);
  const senderKind: ParsedForwardedEmail["senderKind"] = !senderAddr
    ? "unknown"
    : senderPlatform
      ? "platform"
      : isStaff(senderAddr)
        ? "staff"
        : isSystemAddress(senderAddr)
          ? "system"
          : "buyer";
  const labeledEmail = bareAddress(fields.email ?? (fields.contact?.includes("@") ? fields.contact : ""));
  const textEmails = (ls: string[]) => (ls.join("\n").match(EMAIL_IN_TEXT_RE) ?? []).map((a) => a.toLowerCase());
  const candidates = notification
    ? [labeledEmail, replyTo, ...textEmails(bodyLines), senderIsBuyer ? senderAddr : ""]
    : [senderIsBuyer ? senderAddr : "", labeledEmail, replyTo, ...textEmails(signature), ...textEmails(body)];
  const email = candidates.find((c) => buyerEligible(c)) ?? "";
  if (email) signals.push(email === senderAddr ? "buyer_email:sender" : email === labeledEmail ? "buyer_email:labeled" : "buyer_email:body");

  const contactAsPhone = fields.contact && !fields.contact.includes("@") ? cleanPhone(fields.contact) : "";
  const contactAsName = fields.contact && !fields.contact.includes("@") && !contactAsPhone ? fields.contact : "";
  const fromAsName = platform && fields.from && !fields.from.includes("@") ? fields.from : "";
  const senderName = email && email === senderAddr ? displayName(senderRaw) : "";
  const buyer: ParsedBuyer = {
    name: oneLine(fields.name ?? (contactAsName || fromAsName || senderName || (notification ? "" : mineSignatureName(signature))), 120),
    email: email.slice(0, 200),
    // 本厂人员写的（或无转发头直接发来的）内容：转发人的签名号码永不入选（见 staffNotePhone）
    phone: chosenFromStaff
      ? staffNotePhone(body, sigClasses, staffPhoneKeys, buyerEligible, staffNames)
      : cleanPhone(fields.phone ?? "") || contactAsPhone || (notification ? "" : minePhone(signature)),
    company: oneLine(fields.company ?? (notification ? "" : mineCompany(signature)), 200),
    country: oneLine(fields.country ?? "", 80),
  };

  // 5. 产品 / 数量 / 留言
  let product = oneLine(fields.product ?? "", 200);
  if (!product && platform) {
    const m = originalSubject.match(/(?:inquiry|enquiry|rfq|quotation request)\s+(?:about|for|on|of)\s+(.{2,120})$/i);
    if (m) product = oneLine(m[1], 200);
  }
  const quantity = oneLine(fields.quantity ?? "", 120);
  let message = tidyMessage(!notification ? body : fields.message ? fields.message.split("\n") : body.filter((_, i) => !labelLines.has(i)));
  if (quantity && !message.toLowerCase().includes(quantity.toLowerCase())) {
    message = `${message}${message ? "\n" : ""}Quantity: ${quantity}`.slice(0, MESSAGE_MAX);
  }

  // 6. 置信度
  let confidence = 0.2;
  if (buyer.email || buyer.phone) confidence += 0.3;
  if (format !== "plain") confidence += 0.15;
  if (message.length >= 20) confidence += 0.15;
  if (buyer.name || buyer.company) confidence += 0.1;
  if (product) confidence += 0.1;
  if (format === "plain" && !buyer.email) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

  return {
    format,
    forwardFormat,
    platform,
    buyer,
    product,
    quantity,
    message,
    originalSubject: oneLine(originalSubject, 200),
    originalFrom: senderAddr,
    senderKind,
    originalDate,
    platformInquiryId,
    websiteInquiryId,
    confidence,
    signals,
    fullText: text,
  };
}
