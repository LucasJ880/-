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
 * no-reply 类系统地址、平台中转地址都不会被选为买家邮箱）。
 *
 * 公开仓库：测试与注释只用虚构企业。
 */

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

const EMAIL_IN_TEXT_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_STRICT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 免费邮箱域：转发人用这些域时不能把「同域」当成本厂人员 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "yandex.com",
  "qq.com", "163.com", "126.com", "sina.com", "sohu.com", "foxmail.com", "aliyun.com", "139.com", "yeah.net",
]);

const PLATFORMS: Array<{ key: B2bPlatform; domains: string[]; name: RegExp }> = [
  { key: "alibaba", domains: ["alibaba.com", "alibaba-inc.com", "alibabagroup.com"], name: /alibaba\.com|阿里巴巴国际站|alibaba international/i },
  { key: "made_in_china", domains: ["made-in-china.com"], name: /made-in-china\.com|中国制造网/i },
  { key: "global_sources", domains: ["globalsources.com"], name: /global\s?sources/i },
];

const SYSTEM_LOCAL_RE = /^(no-?reply|do-?not-?reply|donotreply|noreply-[\w.-]+|notifications?|notice|alerts?|mailer-daemon|postmaster|bounces?|system)([+._-].*)?$/i;

// ── 文本归一 ────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "©", reg: "®",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) {
      const cp = parseInt(key.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    if (key.startsWith("#")) {
      const cp = parseInt(key.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[key] ?? m;
  });
}

/** HTML → 纯文本：块级标签换行，表格单元格之间用制表符（「Name\tValue」可按标签解析） */
export function htmlToText(html: string): string {
  let s = html.slice(0, MAX_INPUT_CHARS);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table|section|article|ul|ol|pre)\s*>/gi, "\n");
  s = s.replace(/<(p|div|tr|li|h[1-6]|blockquote|table|section|article)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/t[dh]\s*>/gi, "\t");
  s = s.replace(/<hr\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]{0,2000}>/g, "");
  s = decodeEntities(s);
  return normalizeText(s);
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

/** 「"Name" <addr>」/「Name [mailto:addr]」/ 裸地址 → 小写裸地址；没有地址返回 "" */
export function bareAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const angle = raw.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const candidate = angle ? angle[1] : (raw.match(EMAIL_IN_TEXT_RE) ?? [])[0] ?? "";
  const addr = candidate.replace(/^mailto:/i, "").trim().toLowerCase();
  return EMAIL_STRICT_RE.test(addr) ? addr : "";
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

const HEADER_LINE_RE =
  /^[*_>\s]{0,4}(from|sent|date|to|cc|subject|reply-to|发件人|寄件者|发信人|寄件人|发送时间|发送日期|日期|时间|寄件日期|收件人|收件者|抄送|副本|主题|主旨|回复至|答复)[*_\s]{0,3}[:：][*_\s]{0,3}(.*)$/i;

type ForwardMarker = "gmail" | "outlook" | "apple" | "qq";

function markerOf(line: string): ForwardMarker | null {
  const l = line.replace(/[*_]/g, "").trim();
  if (/^-{2,}\s*(forwarded message|转发的邮件|转发邮件|已转发邮件)\s*-{2,}$/i.test(l)) return "gmail";
  if (/^begin forwarded message:?$/i.test(l) || /^开始转发的邮件[:：]?$/.test(l)) return "apple";
  if (/^-{2,}\s*(original message|原始邮件|原邮件)\s*-{2,}$/i.test(l)) return "outlook";
  if (/^-{4,}\s*(original|原始邮件)\s*-{4,}$/i.test(l)) return "qq";
  if (/^_{10,}$/.test(l)) return "outlook";
  return null;
}

function headerOf(line: string): { key: HeaderKey; value: string } | null {
  const m = line.match(HEADER_LINE_RE);
  if (!m) return null;
  const key = HEADER_ALIASES[m[1].toLowerCase()];
  return key ? { key, value: m[2].replace(/[*_]+$/g, "").trim() } : null;
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

function isReplyIntro(line: string, next: string | undefined): boolean {
  const l = line.trim();
  if (REPLY_INTRO_RES.some((re) => re.test(l))) return true;
  // Gmail 纯文本把 "On …, Name <\naddr> wrote:" 折成两行
  return /^on\b/i.test(l) && next !== undefined && /\bwrote:\s*$/i.test(next.trim()) && l.length + next.length < 400;
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

/** 切出签名：签名分隔符 "-- "、手机落款、或结尾 15 行内的短结束语；返回正文行与签名行 */
function splitSignature(lines: string[]): { body: string[]; signature: string[] } {
  const nonEmptyIdx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const tailStart = nonEmptyIdx.length > 15 ? nonEmptyIdx[nonEmptyIdx.length - 15] : 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === "--" || l === "-- " || l === "—" || l === "__") return { body: lines.slice(0, i), signature: lines.slice(i + 1) };
    if (MOBILE_FOOTER_RE.test(l)) return { body: lines.slice(0, i), signature: lines.slice(i + 1) };
    if (i >= tailStart && l.length <= 40 && CLOSING_RE.test(l)) return { body: lines.slice(0, i), signature: lines.slice(i + 1) };
  }
  return { body: lines, signature: [] };
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
  company: "company", "company name": "company", organization: "company", organisation: "company", "buyer company": "company", "公司": "company", "公司名称": "company", "买家公司": "company",
  country: "country", "country / region": "country", "country/region": "country", region: "country", "buyer country": "country", location: "country",
  "国家": "country", "国家/地区": "country", "国家 / 地区": "country", "地区": "country",
  product: "product", products: "product", "product interest": "product", "product name": "product", item: "product", "product inquired": "product",
  "inquired product": "product", "产品": "product", "产品名称": "product", "意向产品": "product", "询价产品": "product",
  quantity: "quantity", "estimated quantity": "quantity", "purchase quantity": "quantity", "order quantity": "quantity", qty: "quantity",
  "quantity required": "quantity", "数量": "quantity", "采购数量": "quantity", "预计数量": "quantity",
  message: "message", inquiry: "message", "inquiry content": "message", "inquiry details": "message", content: "message", details: "message",
  requirements: "message", "message content": "message", "留言": "message", "询盘内容": "message", "内容": "message", "需求": "message", "需求描述": "message",
  "inquiry id": "inquiryId", "inquiry no": "inquiryId", "inquiry no.": "inquiryId", "inquiry number": "inquiryId", "rfq id": "inquiryId",
  "rfq no": "inquiryId", "rfq no.": "inquiryId", "询盘编号": "inquiryId", "询盘号": "inquiryId", "询价单号": "inquiryId",
  "inquiry id / eventid": "eventId", "inquiry id/eventid": "eventId", eventid: "eventId", "event id": "eventId",
  contact: "contact", "联系方式": "contact",
  from: "from",
};

/** 平台 / 官网通知的页脚套话：多行留言收集到这里为止 */
const NOTICE_FOOTER_RE =
  /^(reply to this (inquiry|message)|view (the |this )?(inquiry|message|details)|log ?in to|sign in to|click here|to reply|please reply|unsubscribe|this (e-?mail|message) (was|is) (sent|generated)|do not reply|copyright|©|all rights reserved|回复此询盘|登录.{0,10}(查看|回复)|点击.{0,10}(查看|回复)|本邮件由系统)/i;

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

function labelOf(line: string): { key: FieldKey | "meta"; value: string } | null {
  const m = line.match(LABEL_LINE_RE);
  if (!m) {
    // HTML 通知里「Message」常单独成行（标题加粗、正文在下一块）
    const bare = line.length <= 40 ? normLabel(line.replace(/[*_:：]/g, "")) : "";
    return bare && FIELD_ALIASES[bare] === "message" ? { key: "message", value: "" } : null;
  }
  const label = normLabel(m[1]);
  if (META_LABELS.has(label)) return { key: "meta", value: "" };
  const key = FIELD_ALIASES[label];
  if (!key) return null;
  const value = m[2].replace(/\t+/g, " ").replace(/[*_]+$/g, "").trim();
  return { key, value: EMPTY_VALUE_RE.test(value) ? "" : value };
}

function extractLabeledFields(lines: string[]): { fields: Partial<Record<FieldKey, string>>; labelLines: Set<number> } {
  const fields: Partial<Record<FieldKey, string>> = {};
  const labelLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const hit = labelOf(lines[i]);
    if (!hit) continue;
    labelLines.add(i);
    if (hit.key === "meta") continue;
    if (hit.key === "message") {
      // 多行留言：值在下一行起，直到下一个已知标签 / 通知页脚 / 结束语
      const parts = hit.value ? [hit.value] : [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j].trim();
        if (labelOf(lines[j]) || NOTICE_FOOTER_RE.test(l) || (l.length <= 40 && CLOSING_RE.test(l))) break;
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
  const v = raw.replace(/\s+/g, " ").trim().slice(0, 60);
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

function mineSignatureName(lines: string[]): string {
  for (const line of lines.slice(0, 3)) {
    const l = line.trim();
    if (!l) continue;
    if (/^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(l) && l.length <= 40 && !COMPANY_SUFFIX_RE.test(l)) return l;
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(l)) return l;
    return "";
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

function emptyBuyer(): ParsedBuyer {
  return { name: "", email: "", phone: "", company: "", country: "" };
}

function oneLine(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
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
    return !!forwarderDomain && !FREE_MAIL_DOMAINS.has(forwarderDomain) && d === forwarderDomain;
  };
  const buyerEligible = (addr: string) => !!addr && EMAIL_STRICT_RE.test(addr) && !isStaff(addr) && !isSystemAddress(addr) && !platformOfAddress(addr);

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
    : first.marker === "apple"
      ? "apple_forward"
      : first.marker === "gmail"
        ? "gmail_forward"
        : first.marker === "outlook" || first.marker === "qq" || first.usesSent
          ? "outlook_forward"
          : "gmail_forward";

  const senderRaw = chosen.headers?.from ?? input.from;
  const senderAddr = bareAddress(senderRaw);
  const replyTo = bareAddress(chosen.headers?.replyTo);
  const originalSubject = stripSubjectPrefixes(chosen.headers?.subject ?? input.subject);
  const originalDate = oneLine(chosen.headers?.date ?? "", 120);

  // 2. 正文：去引用 / 去历史回复 / 切签名
  const bodyLines = stripQuotedReplies(unquoteIfMostlyQuoted(chosen.lines));
  const split = splitSignature(bodyLines);
  // 选中的是本厂人员自己写的内容（没有转发头 / 整条链都是同事）：签名是转发人的，不能拿来当买家信息；
  // 另外在转发人显示名那一行截断（很多签名没有 "--" 或结束语）
  const chosenFromStaff = !forwarded.length || isStaff(senderAddr);
  let body = split.body;
  if (chosenFromStaff) {
    const forwarderName = displayName(input.from).toLowerCase();
    const cut = forwarderName ? body.findIndex((l) => l.trim().toLowerCase() === forwarderName) : -1;
    if (cut >= 0) body = body.slice(0, cut);
  }
  const signature = chosenFromStaff ? [] : split.signature;
  const all = extractLabeledFields(bodyLines);
  const inBody = extractLabeledFields(body);

  // 3. 平台 / 官网通知识别
  const fullText = text;
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
  const { fields, labelLines } = notification ? all : chosenFromStaff ? inBody : all;

  const websiteInquiryId = oneLine(fields.eventId ?? (!platform ? fields.inquiryId ?? "" : ""), 120);
  const platformInquiryId = platform ? oneLine(fields.inquiryId ?? "", 120) : "";
  if (websiteInquiryId) signals.push("website_inquiry_id");

  // 4. 买家联系方式（转发人永不入选）
  const senderIsBuyer = buyerEligible(senderAddr);
  const labeledEmail = bareAddress(fields.email ?? (fields.contact?.includes("@") ? fields.contact : ""));
  const textEmails = (ls: string[]) => (ls.join("\n").match(EMAIL_IN_TEXT_RE) ?? []).map((a) => a.toLowerCase());
  const candidates = notification
    ? [labeledEmail, replyTo, ...textEmails(bodyLines), senderIsBuyer ? senderAddr : ""]
    : [senderIsBuyer ? senderAddr : "", labeledEmail, replyTo, ...textEmails(signature), ...textEmails(body)];
  const email = candidates.find((c) => buyerEligible(c)) ?? "";
  if (email) signals.push(email === senderAddr ? "buyer_email:sender" : email === labeledEmail ? "buyer_email:labeled" : "buyer_email:body");

  const buyer = emptyBuyer();
  buyer.email = email.slice(0, 200);
  const contactAsPhone = fields.contact && !fields.contact.includes("@") ? cleanPhone(fields.contact) : "";
  buyer.phone = cleanPhone(fields.phone ?? "") || contactAsPhone || (notification ? "" : minePhone(signature));
  const contactAsName = fields.contact && !fields.contact.includes("@") && !contactAsPhone ? fields.contact : "";
  const fromAsName = platform && fields.from && !fields.from.includes("@") ? fields.from : "";
  const senderName = email && email === senderAddr ? displayName(senderRaw) : "";
  buyer.name = oneLine(fields.name ?? (contactAsName || fromAsName || senderName || (notification ? "" : mineSignatureName(signature))), 120);
  buyer.company = oneLine(fields.company ?? (notification ? "" : mineCompany(signature)), 200);
  buyer.country = oneLine(fields.country ?? "", 80);

  // 5. 产品 / 数量 / 留言
  let product = oneLine(fields.product ?? "", 200);
  if (!product && platform) {
    const m = originalSubject.match(/(?:inquiry|enquiry|rfq|quotation request)\s+(?:about|for|on|of)\s+(.{2,120})$/i);
    if (m) product = oneLine(m[1], 200);
  }
  const quantity = oneLine(fields.quantity ?? "", 120);
  let message: string;
  if (notification) {
    message = fields.message ? tidyMessage(fields.message.split("\n")) : tidyMessage(body.filter((_, i) => !labelLines.has(i)));
  } else {
    message = tidyMessage(body);
  }
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
    originalDate,
    platformInquiryId,
    websiteInquiryId,
    confidence,
    signals,
    fullText,
  };
}
