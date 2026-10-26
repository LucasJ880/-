/**
 * FDE 询盘回复草稿的结构化 diff 与买家信息替换（B-1，openspec change fde-feedback-loop）
 *
 * 纯函数：正文按段落分成问候 / 事实段 / 追问段 / 签名，按行比较两版正文，得出改动段落类型、
 * 改动字数占比与新增事实句里的数值；快照与驳回原因里的买家联系人名、公司名、电话、非收件人邮箱换成占位符。
 * 输出只含结构信息与数字，不含正文；数值只捕获带数量 / 时长单位的（不含货币与百分比，不存任何金额）。
 */

import { createHash } from "crypto";
import { buildStructuredDiff, type StructuredDiff } from "@/lib/employee-ai/diff";

/** 与 pending-actions/exec-sales-inquiry-reply.ts 发送前的处理一致：trim + 截断 10k */
export const DRAFT_BODY_MAX = 10_000;

export function normalizeDraftBody(body: string | null | undefined): string {
  return (body ?? "").trim().slice(0, DRAFT_BODY_MAX);
}

/** 归一后正文的短哈希（不含任何正文，可存） */
export function draftContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ── 段落分类 ──────────────────────────────────────────────────

export type DraftSection = "greeting" | "facts" | "questions" | "signature";
export const DRAFT_SECTIONS: readonly DraftSection[] = ["greeting", "facts", "questions", "signature"];

export interface DraftParagraph {
  section: DraftSection;
  lines: string[];
}

const GREETING_RE = /^(dear|hi|hello|good (morning|afternoon|evening))\b/i;
const GREETING_ZH_RE = /^(尊敬的|您好|你好)|(您好|你好)[：:，,]?$/;
const CLOSING_RE = /^(best regards|kind regards|warm regards|regards|best wishes|sincerely|yours sincerely|yours faithfully|many thanks|thanks|thank you|cheers)[,，!！.]?$/i;
const CLOSING_ZH_RE = /^(此致|祝好|顺祝商祺|祝商祺|谢谢|敬上|顺颂商祺)[！!，,。.]?/;
// 编号列表项（"1. " / "2、"）；"10.5 cm" 这类小数不算
const NUMBERED_RE = /^\d{1,2}[.、)）](?!\d)/;
const QUESTION_END_RE = /[?？]$/;
const SENTENCE_END_RE = /[。!！?？:：;；]$/;

function splitParagraphs(body: string): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) out.push(current);
  return out;
}

function isGreeting(lines: string[]): boolean {
  return lines.length <= 2 && (GREETING_RE.test(lines[0]) || GREETING_ZH_RE.test(lines[0]));
}

function isClosing(line: string): boolean {
  return CLOSING_RE.test(line) || CLOSING_ZH_RE.test(line);
}

/**
 * 没有结束语时，最后一段若全是短行（姓名 / 职位 / 公司 / 联系方式）视为签名：
 * 不以句读结尾；以英文句点结尾的只允许是短的名称（如 "Sunny Home Deco Co., Ltd."，不超过 6 个词）。
 */
function looksLikeSignatureBlock(lines: string[]): boolean {
  return lines.every((l) => l.length <= 80 && !SENTENCE_END_RE.test(l) && (!l.endsWith(".") || l.split(/\s+/).length <= 6));
}

export function classifyParagraphs(body: string): DraftParagraph[] {
  const paragraphs = splitParagraphs(normalizeDraftBody(body));
  const out: DraftParagraph[] = [];
  let inSignature = false;
  paragraphs.forEach((lines, i) => {
    if (!inSignature && lines.some(isClosing)) {
      // 结束语所在段：结束语之前的行仍按正文判，结束语及之后是签名
      const at = lines.findIndex(isClosing);
      if (at > 0) out.push({ section: sectionOf(lines.slice(0, at), i === 0), lines: lines.slice(0, at) });
      out.push({ section: "signature", lines: lines.slice(at) });
      inSignature = true;
      return;
    }
    if (inSignature) {
      out.push({ section: "signature", lines });
      return;
    }
    if (i === paragraphs.length - 1 && i > 0 && looksLikeSignatureBlock(lines)) {
      out.push({ section: "signature", lines });
      return;
    }
    out.push({ section: sectionOf(lines, i === 0), lines });
  });
  return out;
}

function sectionOf(lines: string[], first: boolean): DraftSection {
  if (first && isGreeting(lines)) return "greeting";
  if (lines.some((l) => QUESTION_END_RE.test(l) || NUMBERED_RE.test(l))) return "questions";
  return "facts";
}

// ── 数值捕获 ──────────────────────────────────────────────────

export interface CapturedNumber {
  value: number;
  unit: string;
  /** "per color" / "每色" 这类修饰 */
  per: string | null;
}

// 只捕获数量 / 时长 / 规格单位；不含货币与百分比（任务书：偏好记忆里不存任何金额；百分比可能是毛利率）
const UNIT_ALIASES: Record<string, string> = {
  pcs: "pcs",
  pc: "pcs",
  pieces: "pcs",
  piece: "pcs",
  units: "units",
  unit: "units",
  sets: "sets",
  set: "sets",
  days: "days",
  day: "days",
  weeks: "weeks",
  week: "weeks",
  months: "months",
  month: "months",
  kg: "kg",
  g: "g",
  gsm: "gsm",
  cm: "cm",
  mm: "mm",
  m: "m",
  天: "天",
  周: "周",
  个月: "个月",
  件: "件",
  套: "套",
  个: "个",
  米: "米",
  克: "克",
};
const UNIT_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const PER_PATTERN = "(?:\\s*(?:per|/|each|a)\\s*(colou?r|size|design|style|sku|item|order)|\\s*/?\\s*每\\s*(色|款|个颜色|个尺码|单))?";
const NUMBER_RE = new RegExp(`(?<![\\d.$¥€£])(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?\\s*(${UNIT_PATTERN})(?![A-Za-z])${PER_PATTERN}`, "gi");
const CURRENCY_BEFORE_RE = /(?:\$|US\$|USD|¥|RMB|CNY|EUR|€|£|GBP)\s*$/i;

export function captureNumbers(line: string): CapturedNumber[] {
  const out: CapturedNumber[] = [];
  for (const m of line.matchAll(NUMBER_RE)) {
    const before = line.slice(0, m.index ?? 0);
    if (CURRENCY_BEFORE_RE.test(before)) continue;
    const value = Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
    if (!Number.isFinite(value)) continue;
    const unit = UNIT_ALIASES[m[3].toLowerCase()] ?? UNIT_ALIASES[m[3]] ?? m[3];
    const per = (m[4] ?? m[5] ?? null)?.toLowerCase().replace("colour", "color") ?? null;
    out.push({ value, unit, per });
  }
  return out;
}

// ── diff ──────────────────────────────────────────────────────

export interface DraftDiff extends StructuredDiff {
  /** 改动涉及的段落类型（按问候 / 事实 / 追问 / 签名顺序） */
  sections: DraftSection[];
  /** 改动行字数 / 两版总字数，0–1 */
  changedRatio: number;
  /** 新正文事实段新增行里带单位的数值 */
  capturedNumbers: CapturedNumber[];
}

const normLine = (l: string) => l.replace(/\s+/g, " ").trim();

function taggedLines(body: string): Array<{ line: string; section: DraftSection }> {
  return classifyParagraphs(body).flatMap((p) => p.lines.map((line) => ({ line: normLine(line), section: p.section })));
}

/** 带段落类型的规范化行（与 diff 同一切法；B-2 商务事实抽取用来与原文逐行对齐） */
export function sectionedLines(body: string | null | undefined): Array<{ line: string; section: DraftSection }> {
  return taggedLines(normalizeDraftBody(body));
}

/** sent 相对 original 新增的行在 sectionedLines(sent) 里的下标（多重集差，按出现次数；顺序与原文一致） */
export function addedLineIndexes(original: string | null | undefined, sent: string | null | undefined): number[] {
  const remaining = new Map<string, number>();
  for (const { line } of sectionedLines(original)) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const out: number[] = [];
  sectionedLines(sent).forEach(({ line }, i) => {
    const n = remaining.get(line) ?? 0;
    if (n > 0) remaining.set(line, n - 1);
    else out.push(i);
  });
  return out;
}

/** 多重集差：a 里有、b 里没有（按出现次数）的行 */
function onlyIn(a: Array<{ line: string; section: DraftSection }>, b: Array<{ line: string }>) {
  const remaining = new Map<string, number>();
  for (const { line } of b) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  return a.filter(({ line }) => {
    const n = remaining.get(line) ?? 0;
    if (n > 0) {
      remaining.set(line, n - 1);
      return false;
    }
    return true;
  });
}

export function buildDraftDiff(original: string | null | undefined, sent: string | null | undefined): DraftDiff {
  const a = normalizeDraftBody(original);
  const b = normalizeDraftBody(sent);
  const base = buildStructuredDiff(a, b);
  // 结构化 diff 的摘要与备注都是固定文案（不含正文），可直接保留
  if (a === b) return { ...base, changed: false, sections: [], changedRatio: 0, capturedNumbers: [] };

  const linesA = taggedLines(a);
  const linesB = taggedLines(b);
  const removed = onlyIn(linesA, linesB);
  const added = onlyIn(linesB, linesA);
  const touched = new Set<DraftSection>([...removed, ...added].map((l) => l.section));
  const total = [...linesA, ...linesB].reduce((s, l) => s + l.line.length, 0);
  const changed = [...removed, ...added].reduce((s, l) => s + l.line.length, 0);
  return {
    ...base,
    // 只有空白差异时行级比较为空：仍算改过（正文确实不同），但没有段落类型
    changed: true,
    sections: DRAFT_SECTIONS.filter((s) => touched.has(s)),
    changedRatio: total > 0 ? Math.round((changed / total) * 1000) / 1000 : 0,
    capturedNumbers: added.filter((l) => l.section === "facts").flatMap((l) => captureNumbers(l.line)),
  };
}

// ── 买家信息替换 ──────────────────────────────────────────────

export interface BuyerPiiTerms {
  /** 买家联系人名 */
  contactName?: string | null;
  /** 买家公司 / 客户名 */
  companyName?: string | null;
  /** 收件人邮箱：唯一保留的买家个人信息 */
  recipientEmail?: string | null;
}

export const PII_PLACEHOLDERS = {
  contact: "{{buyer_contact}}",
  company: "{{buyer_company}}",
  phone: "{{phone}}",
  email: "{{email}}",
} as const;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_SENTINEL = (i: number) => `\u0001E${i}\u0001`;
const EMAIL_SENTINEL_RE = /\u0001E(\d+)\u0001/g;

// 电话必须有电话的结构：+ 开头、括号区号、三段式分隔、中国手机 / 座机；数量区间（500-1000）、日期、金额不算
const PHONE_RES: readonly RegExp[] = [
  /\+\d[\d\s().-]{6,}\d/g,
  /\(\d{2,4}\)\s*\d[\d\s.-]{4,}\d/g,
  /(?<!\d)(?<!\d[.,])\d{3,4}[\s.-]\d{3,4}[\s.-]\d{3,5}(?!\d)(?![.,]\d)/g,
  /(?<!\d)(?<!\d[.,])0\d{2,3}-\d{7,8}(?!\d)/g,
  /(?<!\d)(?<!\d[.,])1[3-9]\d{9}(?!\d)/g,
];
const UNIT_AFTER_RE = new RegExp(`^\\s*(?:${UNIT_PATTERN})(?![A-Za-z])`, "i");
const CURRENCY_BEFORE_PHONE_RE = /(?:\$|US\$|USD|¥|RMB|CNY|EUR|€|£|GBP)\s*$/i;

// 联系人名拆开后不单独替换的常见词（"Purchasing Team" 不能让每个 team 都被替换）
const NAME_TOKEN_STOPWORDS: ReadonlySet<string> = new Set([
  "team", "sales", "purchasing", "purchase", "procurement", "sourcing", "buyer", "buying", "manager", "department", "dept",
  "office", "import", "export", "company", "group", "the", "and", "for", "with", "from", "info", "admin", "contact",
  "service", "support", "home", "ltd", "inc", "llc", "corp", "limited", "trading",
]);
const HONORIFICS: ReadonlySet<string> = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "madam", "mx", "prof"]);
const HAS_HAN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 字母名按 Unicode 词边界匹配；中日韩文字按子串。单个名字只认原样与全大写（"John" / "JOHN"），不认小写常用词 */
function nameRe(name: string, caseSensitive: boolean): RegExp {
  if (HAS_HAN_RE.test(name)) return new RegExp(escapeRe(name), "gu");
  const body = caseSensitive ? `(?:${escapeRe(name)}|${escapeRe(name.toUpperCase())})` : escapeRe(name);
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, caseSensitive ? "gu" : "giu");
}

export function maskBuyerPii(text: string | null | undefined, terms: BuyerPiiTerms): string {
  const recipient = terms.recipientEmail?.trim().toLowerCase() ?? null;
  // 先把邮箱整体换成占位，避免名字替换把 john@acme.com 拆坏
  const emails: string[] = [];
  let out = (text ?? "").replace(EMAIL_RE, (m) => {
    emails.push(m);
    return EMAIL_SENTINEL(emails.length - 1);
  });

  // 整名：忽略大小写；长的先换
  const names = [
    { value: terms.companyName, placeholder: PII_PLACEHOLDERS.company },
    { value: terms.contactName, placeholder: PII_PLACEHOLDERS.contact },
  ]
    .map((n) => ({ value: n.value?.trim() ?? "", placeholder: n.placeholder }))
    .filter((n) => n.value.length >= 2)
    .sort((x, y) => y.value.length - x.value.length);
  for (const n of names) out = out.replace(nameRe(n.value, false), n.placeholder);

  // 联系人名的单个名字（如只写 "John"）：区分大小写、≥ 3 个字母、不是称谓或常见词
  const contact = terms.contactName?.trim() ?? "";
  if (contact && !HAS_HAN_RE.test(contact)) {
    for (const token of contact.split(/[\s,]+/).map((t) => t.replace(/\.$/, ""))) {
      const lower = token.toLowerCase();
      if (token.length >= 3 && /^\p{L}/u.test(token) && !HONORIFICS.has(lower) && !NAME_TOKEN_STOPWORDS.has(lower)) {
        out = out.replace(nameRe(token, true), PII_PLACEHOLDERS.contact);
      }
    }
  }

  for (const re of PHONE_RES) {
    out = out.replace(re, (m: string, offset: number, whole: string) => {
      if (m.replace(/\D/g, "").length < 7) return m;
      if (CURRENCY_BEFORE_PHONE_RE.test(whole.slice(0, offset))) return m;
      if (UNIT_AFTER_RE.test(whole.slice(offset + m.length))) return m;
      return PII_PLACEHOLDERS.phone;
    });
  }

  return out.replace(EMAIL_SENTINEL_RE, (_m, i: string) => {
    const email = emails[Number(i)];
    return recipient && email.toLowerCase() === recipient ? email : PII_PLACEHOLDERS.email;
  });
}
