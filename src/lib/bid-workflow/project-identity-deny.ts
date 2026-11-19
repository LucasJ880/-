/**
 * CHAIN-4b — 发给供应商的内容不带出招标身份（纯函数，零 DB / 零 LLM / 不读环境变量）
 *
 * 每个项目一份禁出清单（招标编号 / 采购方名称 / 截标日期 / 交货地址 / 项目名称），
 * 外加邮箱与电话的格式检查。命中即整份失败（调用方负责：不建轮次 / 不建卡 / 不写文件），
 * 这里只负责「有没有命中、命中在哪一类、哪个位置」，从不返回命中的原文。
 *
 * 规格：openspec/changes/rfq-supplier-identity-guard/specs/tender/supplier-identity-guard/spec.md
 */

import { createHash } from "node:crypto";
import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";

/* ---------------------------------- 类别与说明（不依赖 Node，前后端共用） ---------------------------------- */

import {
  identityLeakDocMessageZh,
  type DenyCategory,
  type IdentityCategory,
  type IdentityHit,
  type IdentitySegmentKind,
} from "./project-identity-messages";

export {
  IDENTITY_CATEGORY_ZH,
  describeIdentityHits,
  identityLeakDocMessageZh,
  identityLeakFieldMessageZh,
  identityLeakMessageZh,
  type DenyCategory,
  type IdentityCategory,
  type IdentityHit,
  type IdentitySegmentKind,
} from "./project-identity-messages";

/* ---------------------------------- 来源 ---------------------------------- */

export type ProjectIdentitySources = {
  projectName: string | null;
  solicitationNumber: string | null;
  clientOrganization: string | null;
  closeDate: Date | null;
  /** IANA 时区（组织设置；调用方已解析好） */
  timeZone: string;
  /** 当前可用分析里状态为已知的关键事实原文（每类可能有多条：原值与中文各一） */
  facts: {
    tenderNumber: string[];
    buyer: string[];
    projectTitle: string[];
    closingDatetime: string[];
    location: string[];
  };
  /** 允许出现在供应商侧内容里的我方邮箱（询价设置的显示发件地址与授权邮箱） */
  allowedEmails: string[];
};

export type DenyEntry = { category: DenyCategory; normalized: string; cjk: boolean };
export type ProjectIdentityDenyList = { entries: DenyEntry[]; allowedEmails: string[] };

/** 规整：全半角统一、转小写、& → and、字母数字以外的字符视为分隔、连续分隔合一 */
export function normalizeIdentityText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
const MIN_ENTRY_CHARS = 4;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 招标编号片段：长度 ≥ 6、含 ≥ 4 位数字、只由字母数字与 - / . _ 组成 */
function tenderNumberFragments(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/[A-Za-z0-9][A-Za-z0-9\-/._]*[A-Za-z0-9]/g)) {
    const t = m[0];
    if (t.length >= 6 && (t.match(/\d/g)?.length ?? 0) >= 4) out.push(t);
  }
  return out;
}

/** 截标时间在组织时区的日期，六种写法 */
function closeDateForms(d: Date, timeZone: string): string[] {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const y = parts.year;
  const mm = parts.month;
  const dd = parts.day;
  if (!y || !mm || !dd) return [];
  const m = Number(mm);
  const day = Number(dd);
  return [
    `${y}-${mm}-${dd}`,
    `${y}/${mm}/${dd}`,
    `${y}年${m}月${day}日`,
    `${MONTHS[m - 1]} ${day}, ${y}`,
    `${MONTHS_SHORT[m - 1]} ${day}, ${y}`,
    `${day} ${MONTHS[m - 1]} ${y}`,
  ];
}

const POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;

/** 交货地址：加拿大邮编（带 / 不带空格）、以门牌号开头的街道段；含其一时整段原文也算 */
function addressEntries(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(POSTAL)) {
    const compact = m[0].replace(/[ -]/g, "").toUpperCase();
    out.push(`${compact.slice(0, 3)} ${compact.slice(3)}`, compact);
  }
  for (const seg of raw.split(/[,;\n]/)) {
    const m = seg.trim().match(/(?:^|\s)(\d{1,6}[A-Za-z]?(?:-\d{1,6})?\s+[A-Za-z][A-Za-z.' -]*[A-Za-z.])$/);
    if (m) out.push(m[1].trim());
  }
  if (out.length > 0) out.push(raw);
  return out;
}

export function buildProjectIdentityDenyList(src: ProjectIdentitySources): ProjectIdentityDenyList {
  const raw: Array<{ category: DenyCategory; text: string }> = [];
  const add = (category: DenyCategory, text: string | null | undefined) => {
    const t = (text ?? "").trim();
    if (t) raw.push({ category, text: t });
  };

  for (const v of [src.solicitationNumber, ...src.facts.tenderNumber]) {
    add("tender_number", v);
    for (const frag of tenderNumberFragments(v ?? "")) add("tender_number", frag);
  }
  for (const v of [src.clientOrganization, ...src.facts.buyer]) {
    add("buyer_name", v);
    if (v?.trim()) add("buyer_name", normalizeBuyerName(v));
  }
  if (src.closeDate && !Number.isNaN(src.closeDate.getTime())) {
    for (const f of closeDateForms(src.closeDate, src.timeZone)) add("close_date", f);
  }
  for (const v of src.facts.closingDatetime) add("close_date", v);
  for (const v of src.facts.location) for (const a of addressEntries(v)) add("delivery_address", a);
  for (const v of [src.projectName, ...src.facts.projectTitle]) add("project_name", v);

  const seen = new Set<string>();
  const entries: DenyEntry[] = [];
  for (const r of raw) {
    const normalized = normalizeIdentityText(r.text);
    if ([...normalized].length < MIN_ENTRY_CHARS) continue;
    const key = `${r.category}|${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ category: r.category, normalized, cjk: CJK.test(normalized) });
  }
  const allowedEmails = [...new Set(src.allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  return { entries, allowedEmails };
}

/* ---------------------------------- 扫描 ---------------------------------- */

/**
 * 一段供应商可见的文本。authored / human：五类 + 格式检查全查（human 命中时说明换成「你填的……」）；
 * tender（招标原文）：不查项目名称。
 */
export type IdentitySegment = { where: string; text: string; kind: IdentitySegmentKind };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 北美号码：区号与局号首位都是 2–9（排除 100-123-4567 这类编号），分段以空格、- 或 . 分隔
const PHONE_NANP = /(?<!\d)(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[\s.-])[2-9]\d{2}[\s.-]\d{4}(?!\d)/;
const PHONE_INTL = /(?<![\w+])\+\d[\d\s().-]{6,}\d/g;
const PHONE_CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/;

function hasForeignEmail(text: string, allowed: readonly string[]): boolean {
  for (const m of text.matchAll(EMAIL)) if (!allowed.includes(m[0].toLowerCase())) return true;
  return false;
}

function hasPhone(text: string): boolean {
  if (PHONE_NANP.test(text) || PHONE_CN_MOBILE.test(text)) return true;
  for (const m of text.matchAll(PHONE_INTL)) if ((m[0].match(/\d/g)?.length ?? 0) >= 8) return true;
  return false;
}

function entryHits(entry: DenyEntry, normalizedText: string, paddedText: string): boolean {
  return entry.cjk ? normalizedText.includes(entry.normalized) : paddedText.includes(` ${entry.normalized} `);
}

/** 逐段扫描；同一位置同一类只报一次，按出现顺序返回。不返回命中的原文。 */
export function scanIdentity(list: ProjectIdentityDenyList, segments: readonly IdentitySegment[]): IdentityHit[] {
  const hits: IdentityHit[] = [];
  const seen = new Set<string>();
  const push = (category: IdentityCategory, seg: IdentitySegment) => {
    const key = `${category}|${seg.where}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ category, where: seg.where, kind: seg.kind });
  };
  for (const seg of segments) {
    const text = seg.text ?? "";
    if (!text.trim()) continue;
    const normalized = normalizeIdentityText(text);
    const padded = ` ${normalized} `;
    for (const e of list.entries) {
      if (e.category === "project_name" && seg.kind === "tender") continue;
      if (entryHits(e, normalized, padded)) push(e.category, seg);
    }
    if (hasForeignEmail(text, list.allowedEmails)) push("email_address", seg);
    if (hasPhone(text)) push("phone_number", seg);
  }
  return hits;
}

/** 供应商侧生成文件命中时抛出；生成接口据此返回 422 */
export class SupplierIdentityLeakError extends Error {
  readonly errorCode = "IDENTITY_LEAK" as const;
  constructor(readonly hits: IdentityHit[]) {
    super(identityLeakDocMessageZh(hits));
    this.name = "SupplierIdentityLeakError";
  }
}

/* ---------------------------------- 发出邮件复查 ---------------------------------- */

/**
 * 渲染好的一封询价邮件的复查（送审时逐家、执行前逐家）：
 * 标题全是我方撰写 → 五类全查；正文含招标原文 → 不查项目名称。
 */
export function scanOutboundRfqEmail(
  list: ProjectIdentityDenyList,
  mail: { subject: string; body: string },
  wherePrefix = "",
): IdentityHit[] {
  return scanIdentity(list, [
    { where: `${wherePrefix}邮件标题`, text: mail.subject, kind: "authored" },
    { where: `${wherePrefix}邮件正文`, text: mail.body, kind: "tender" },
  ]);
}

/* ---------------------------------- 询价编号 ---------------------------------- */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** RFQ-{组织代码}-{项目创建年份}-{由项目 id 定的 5 位码}；同一项目任何时候都一样 */
export function rfqReference(input: { projectId: string; projectCreatedAt: Date; orgCode: string | null; timeZone: string }): string {
  const org = (input.orgCode ?? "").match(/[A-Za-z0-9]+/)?.[0]?.toUpperCase().slice(0, 8) || "QY";
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric" }).format(input.projectCreatedAt);
  const digest = createHash("sha256").update(`rfq-ref:${input.projectId}`).digest();
  // 取前 25 位（前 4 字节的高 25 位），每 5 位一个字符；用无符号 32 位整数运算
  const bits = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  let code = "";
  for (let i = 0; i < 5; i++) code += CROCKFORD[(bits >>> (27 - i * 5)) & 31];
  return `RFQ-${org}-${year}-${code}`;
}

/* ---------------------------------- 城市级目的地 ---------------------------------- */

const PROVINCES =
  "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT|Alberta|British Columbia|Manitoba|New Brunswick|Newfoundland and Labrador|Nova Scotia|Northwest Territories|Nunavut|Ontario|Prince Edward Island|Quebec|Québec|Saskatchewan|Yukon";
const CITY_PROV = new RegExp(`([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.' -]{0,60}?),\\s*(${PROVINCES})(?![A-Za-z])`, "g");

/** 地点原文里最后一处「城市, 省」；城市只取逗号前连续的首字母大写的词。找不到 → null */
export function cityLevelDestination(text: string | null | undefined): string | null {
  if (!text) return null;
  let last: string | null = null;
  for (const m of text.matchAll(CITY_PROV)) {
    const words = m[1].trim().split(/\s+/);
    const city: string[] = [];
    for (let i = words.length - 1; i >= 0; i--) {
      if (/^[A-ZÀ-Ý]/.test(words[i])) city.unshift(words[i]);
      else break;
    }
    if (city.length) last = `${city.join(" ")}, ${m[2]}`;
  }
  return last;
}
