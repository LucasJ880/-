/**
 * 情报调研树的闸（纯函数）：
 * - 外发闸：搜索词与网址是外发数据，命中敏感词或本项目的内部数字一律不发；
 * - 事实核对：只收「摘录逐字出现在读到的正文里、值逐字出现在摘录里、数字对得上」的事实。
 */

import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
import { containsOutboundSensitive } from "@/lib/muse-bridge/contract";
import { numbersIn } from "@/lib/tender-rfq/inbound-contract";
import { RESEARCH_TREE_LIMITS } from "./limits";

/* ───────────────────────────── 外发闸 ───────────────────────────── */

export type OutboundBlockReason = "sensitive_word" | "internal_number" | "unclear_digits" | "too_long" | "empty";

/** 本项目的内部数字（估值、我方报价、中标价）：只取整数部分 ≥ 3 位的（小于 3 位的数太常见，不拦） */
export function internalNumberTokens(values: ReadonlyArray<number | null | undefined>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const s = BigInt(Math.trunc(Math.abs(v))).toString();
    if (s.length >= 3) out.add(s);
  }
  return [...out];
}

/** 去掉小数末尾的 0（「1.250」→「1.25」，「230.0」→「230」） */
function trimDecimal(x: number, digits: number): string {
  return x.toFixed(digits).replace(/\.?0+$/, "");
}

/** 内部数字的缩写写法（只取精确相等的）：230k、1.25m、1.25million、125万 */
function abbreviations(token: string): string[] {
  const n = Number(token);
  if (!Number.isFinite(n) || n < 1000) return [];
  const out: string[] = [];
  const exact = (x: number, d: number) => (Math.abs(Number(trimDecimal(x, d)) - x) < 1e-9 ? trimDecimal(x, d) : null);
  const k = exact(n / 1_000, 3);
  if (k) out.push(`${k}k`);
  const m = exact(n / 1_000_000, 6);
  if (m && n >= 100_000) out.push(`${m}m`, `${m}mm`, `${m}million`);
  const w = exact(n / 10_000, 4);
  if (w) out.push(`${w}万`);
  return out;
}

/** 宽松的百分号解码：逐个 %XX 解（落单的 % 原样留下），最多三层 */
function lenientPercentDecode(s: string): string[] {
  const out: string[] = [];
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const next = cur.replace(/(?:%[0-9a-f]{2})+/gi, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
      }
    });
    if (next === cur) break;
    out.push(next);
    cur = next;
  }
  return out;
}

/** HTML 数字实体（&#49; &#x31;） */
function decodeNumericEntities(s: string): string {
  return s.replace(/&#(x[0-9a-f]+|\d+);?/gi, (m, g: string) => {
    const cp = g[0] === "x" || g[0] === "X" ? parseInt(g.slice(1), 16) : parseInt(g, 10);
    return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
  });
}

/** 外发前要查的几种写法：原文、各层百分号解码、实体解码；每种都做 NFKC、去掉不可见格式字符 */
function variantsOf(s: string): string[] {
  const raw = [s, ...lenientPercentDecode(s)];
  const all = new Set<string>();
  for (const r of raw) {
    for (const x of [r, decodeNumericEntities(r)]) all.add(x.normalize("NFKC").replace(/\p{Cf}/gu, ""));
  }
  return [...all];
}

/**
 * 把文字里的数字按几种写法连起来，用来比对内部数字：数字之间隔着不超过两个非字母的符号就算连着
 * （「1.250.000」「1 250 000」「1·250·000」→ 1250000），以及按千分位连写后的每个整数部分（「23,000.50」→ 23000）。
 * 宁可多拦：连写可能把相邻的两个数拼在一起。
 */
function digitRuns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[0-9](?:[^\p{L}0-9]{0,2}[0-9])*/gu)) {
    const raw = m[0];
    out.push(raw.replace(/[^0-9]+/g, ""));
    const joined = raw.replace(/[,\s'’_](?=[0-9]{3}(?![0-9]))/g, "");
    for (const part of joined.split(/[^0-9.]+/)) {
      const intPart = part.split(".")[0] ?? "";
      if (intPart) out.push(intPart);
    }
  }
  return out;
}

export function containsInternalNumber(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  for (const v of variantsOf(String(text ?? ""))) {
    const runs = digitRuns(v);
    if (runs.some((r) => tokens.some((t) => r.includes(t)))) return true;
    const squashed = v.toLowerCase().replace(/[\s,'’_]+/g, "");
    if (tokens.some((t) => abbreviations(t).some((a) => squashed.includes(a)))) return true;
  }
  return false;
}

/** 0–9 以外的数字（阿拉伯-印度数字、天城文数字等）：认不清，一律不发 */
function hasUnclearDigits(s: string): boolean {
  return variantsOf(s).some((v) => /[^\P{Nd}0-9]/u.test(v));
}

function sensitive(s: string): boolean {
  return variantsOf(s).some((v) => {
    // 再查一遍去掉空白与标点的写法（「c o s t」「co-st」）
    const squashed = v.replace(/[\s\p{P}\p{S}]+/gu, "");
    return (
      containsSensitiveSupplierBriefText(v) ||
      containsOutboundSensitive(v, { strict: true }) ||
      containsSensitiveSupplierBriefText(squashed) ||
      containsOutboundSensitive(squashed, { strict: true })
    );
  });
}

/** 搜索词的外发闸：任一命中即不发（宁可多拦） */
export function outboundBlockReason(
  text: string,
  opts: { internalNumbers: readonly string[]; maxChars: number },
): OutboundBlockReason | null {
  const s = String(text ?? "");
  if (!s.trim()) return "empty";
  if (s.length > opts.maxChars) return "too_long";
  if (hasUnclearDigits(s)) return "unclear_digits";
  if (sensitive(s)) return "sensitive_word";
  if (containsInternalNumber(s, opts.internalNumbers)) return "internal_number";
  return null;
}

/**
 * 网址的外发闸：只查本项目的内部数字与认不清的数字（网址只可能来自本支的搜索结果，不含我方写的词；
 * 套敏感词闸会把 budget / costco 这类正常网址也拦下）
 */
export function urlBlockReason(url: string, internalNumbers: readonly string[]): OutboundBlockReason | null {
  const s = String(url ?? "");
  if (!s.trim()) return "empty";
  if (s.length > 4096) return "too_long";
  if (hasUnclearDigits(s)) return "unclear_digits";
  if (containsInternalNumber(s, internalNumbers)) return "internal_number";
  return null;
}

/** 读页层交来的网址放不放行（allowUrl 的判断，单独导出便于测试）：在本支可读网址里、网址里没有内部数字 */
export function allowReadableUrl(key: string | null, readable: ReadonlyMap<string, unknown>, internalNumbers: readonly string[]): boolean {
  if (!key || !readable.has(key)) return false;
  return urlBlockReason(key, internalNumbers) === null;
}

export const OUTBOUND_BLOCK_ZH: Readonly<Record<OutboundBlockReason, string>> = Object.freeze({
  sensitive_word: "搜索词里有不能外发的词（成本、预算、毛利一类），没有发出",
  internal_number: "搜索词或网址里有本项目的内部数字，没有发出",
  unclear_digits: "搜索词或网址里有认不清的数字写法，没有发出",
  too_long: "搜索词或网址太长，没有发出",
  empty: "搜索词或网址是空的，没有发出",
});

/* ───────────────────────────── 事实核对 ───────────────────────────── */

export type FactCandidate = { factType: unknown; value: unknown; excerpt: unknown };

export type FactRejectReason =
  | "type_not_allowed"
  | "bad_shape"
  | "too_long"
  | "excerpt_too_short"
  | "bad_digits"
  | "no_digit"
  | "excerpt_not_in_page"
  | "value_not_in_excerpt"
  | "number_not_in_excerpt";

export type FactCheck = { ok: true; factType: string; value: string; excerpt: string } | { ok: false; why: FactRejectReason };

/** 摘录最短这么多字（太短的摘录在任何页上都找得到，等于没核对） */
export const MIN_EXCERPT_CHARS = 12;

/**
 * 比对用的归一：NFKC、去掉不可见的格式字符、空白压成一个空格（**不删空白**：表格里相邻的「1」「250」「000」
 * 不会被拼成 1250000）、不分大小写。
 */
export function normalizeForMatch(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 归一后还有 0–9 以外的数字（阿拉伯-印度数字等）：数字核对认不了，一律不收 */
function hasNonAsciiDigit(s: string): boolean {
  return /[^\P{Nd}0-9]/u.test(s);
}

/**
 * 一条事实过核对（代码做，不改写，不满足就丢）：
 * 1. 类型在本支允许的类型里；值与摘录都是非空字符串、不超过 200 字；摘录归一后不少于 12 字；
 * 2. 值与摘录里只有 0–9 的数字；数字类事实（metric 类型）的值里至少有一个数字；
 * 3. 摘录逐字（归一后）出现在正文里；值逐字（归一后）出现在摘录里；
 * 4. 值里的每一个数都出现在摘录的数里。
 */
export function checkFact(
  c: FactCandidate,
  pageText: string,
  allowedTypes: readonly string[],
  numericTypes: readonly string[] = [],
): FactCheck {
  if (typeof c.factType !== "string" || typeof c.value !== "string" || typeof c.excerpt !== "string") {
    return { ok: false, why: "bad_shape" };
  }
  const value = c.value.trim();
  const excerpt = c.excerpt.trim();
  if (!allowedTypes.includes(c.factType)) return { ok: false, why: "type_not_allowed" };
  if (!value || !excerpt) return { ok: false, why: "bad_shape" };
  if (value.length > RESEARCH_TREE_LIMITS.MAX_VALUE_CHARS || excerpt.length > RESEARCH_TREE_LIMITS.MAX_EXCERPT_CHARS) {
    return { ok: false, why: "too_long" };
  }
  const v = normalizeForMatch(value);
  const e = normalizeForMatch(excerpt);
  if (!v || e.length < MIN_EXCERPT_CHARS) return { ok: false, why: "excerpt_too_short" };
  if (hasNonAsciiDigit(v) || hasNonAsciiDigit(e)) return { ok: false, why: "bad_digits" };
  if (numericTypes.includes(c.factType) && !/[0-9]/.test(v)) return { ok: false, why: "no_digit" };
  if (!normalizeForMatch(pageText).includes(e)) return { ok: false, why: "excerpt_not_in_page" };
  if (!e.includes(v)) return { ok: false, why: "value_not_in_excerpt" };
  const inExcerpt = numbersIn(excerpt);
  for (const n of numbersIn(value)) {
    if (!inExcerpt.some((m) => Math.abs(m - n) < 1e-9)) return { ok: false, why: "number_not_in_excerpt" };
  }
  return { ok: true, factType: c.factType, value, excerpt };
}
