/**
 * Revenue Spine — 归一化纯函数（去重键 / 语言识别）
 */

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.ca",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.ca",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "qq.com",
  "163.com",
  "126.com",
  "foxmail.com",
  "sina.com",
  "yeah.net",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || !EMAIL_RE.test(v)) return null;
  return v;
}

export function isValidEmail(raw: string | null | undefined): boolean {
  return normalizeEmail(raw) !== null;
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : null;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

/** 可用于去重的公司域名（免费邮箱域名不算） */
export function matchableEmailDomain(email: string | null | undefined): string | null {
  const d = emailDomain(email);
  if (!d || isFreeMailDomain(d)) return null;
  return d;
}

const COMPANY_SUFFIX_RE =
  /\b(inc|inc\.|incorporated|llc|l\.l\.c\.|ltd|ltd\.|limited|co|co\.|corp|corp\.|corporation|company|gmbh|s\.a\.|sa|srl|s\.r\.l\.|pty|plc|bv|b\.v\.|ag|kg|oy|ab|as|group|holdings?|international|intl|trading|import|export|imports|exports)\b/g;

/** 规范化公司名：小写、去公司后缀、去标点与多余空白（去重三级键） */
export function normalizeCompanyName(raw: string | null | undefined): string | null {
  let v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  v = v
    .replace(/[（(].*?[)）]/g, " ")
    .replace(/(有限责任公司|股份有限公司|有限公司|集团|公司)/g, " ")
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return v.length >= 2 ? v : null;
}

/** 电话规范化：仅保留数字，取末 10 位比较（去重四级键） */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D+/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** 小写 hostname，去 www */
export function websiteHost(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const h = new URL(s).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

export type InquiryLanguage = "zh" | "en" | "mixed";

/** 语言识别：按 CJK 字符占比（去空白与数字后） */
export function detectLanguage(text: string | null | undefined): InquiryLanguage {
  const t = (text ?? "").replace(/[\s\d\p{P}]/gu, "");
  if (!t) return "en";
  const cjk = (t.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const ratio = cjk / t.length;
  if (ratio >= 0.7) return "zh";
  if (ratio <= 0.1) return "en";
  return "mixed";
}

/** 把任意值安全裁成字符串 */
export function clipText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}
