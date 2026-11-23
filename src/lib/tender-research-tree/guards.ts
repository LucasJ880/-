/**
 * 情报调研树的闸（纯函数）：
 * - 外发闸：搜索词与网址是外发数据，命中敏感词或本项目的内部数字一律不发；
 * - 事实核对：只收「摘录逐字出现在读到的正文里、值里的数字都在摘录里」的事实。
 */

import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
import { containsOutboundSensitive } from "@/lib/muse-bridge/contract";
import { numbersIn, verifyEvidence } from "@/lib/tender-rfq/inbound-contract";
import { RESEARCH_TREE_LIMITS } from "./limits";

/* ───────────────────────────── 外发闸 ───────────────────────────── */

export type OutboundBlockReason = "sensitive_word" | "internal_number" | "too_long" | "empty";

/** 本项目的内部数字（估值、我方报价、中标价）：只取整数部分 ≥ 3 位的（小于 3 位的数太常见，不拦） */
export function internalNumberTokens(values: ReadonlyArray<number | null | undefined>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const int = Math.trunc(Math.abs(v));
    const s = String(int);
    if (s.length >= 3) out.add(s);
  }
  return [...out];
}

/**
 * 把文字里的数字按几种写法连起来，用来比对内部数字：去掉分隔符整串连写（「1.250.000」「1 250 000」→ 1250000），
 * 以及按千分位连写后的每个整数部分（「23,000.50」→ 23000）。宁可多拦：连写可能把相邻的两个数拼在一起。
 */
function digitRuns(text: string): string[] {
  const t = text.normalize("NFKC");
  const out: string[] = [];
  for (const m of t.matchAll(/\d[\d,\s._'-]*\d|\d/g)) {
    const raw = m[0];
    out.push(raw.replace(/\D+/g, ""));
    const joined = raw.replace(/[,\s'_](?=\d{3}(?!\d))/g, "");
    for (const part of joined.split(/[^\d.]+/)) {
      const intPart = part.split(".")[0] ?? "";
      if (intPart) out.push(intPart);
    }
  }
  return out;
}

export function containsInternalNumber(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const runs = digitRuns(text);
  return runs.some((r) => tokens.some((t) => r.includes(t)));
}

/** 搜索词与网址的外发闸：任一命中即不发（宁可多拦） */
export function outboundBlockReason(
  text: string,
  opts: { internalNumbers: readonly string[]; maxChars: number },
): OutboundBlockReason | null {
  const s = String(text ?? "");
  if (!s.trim()) return "empty";
  if (s.length > opts.maxChars) return "too_long";
  if (containsSensitiveSupplierBriefText(s) || containsOutboundSensitive(s, { strict: true })) return "sensitive_word";
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    // 解不开的按原文查
  }
  if (decoded !== s && (containsSensitiveSupplierBriefText(decoded) || containsOutboundSensitive(decoded, { strict: true }))) {
    return "sensitive_word";
  }
  if (containsInternalNumber(s, opts.internalNumbers) || containsInternalNumber(decoded, opts.internalNumbers)) {
    return "internal_number";
  }
  return null;
}

export const OUTBOUND_BLOCK_ZH: Readonly<Record<OutboundBlockReason, string>> = Object.freeze({
  sensitive_word: "搜索词或网址里有不能外发的词（成本、预算、毛利一类），没有发出",
  internal_number: "搜索词或网址里有本项目的内部数字，没有发出",
  too_long: "搜索词太长，没有发出",
  empty: "搜索词是空的，没有发出",
});

/* ───────────────────────────── 事实核对 ───────────────────────────── */

export type FactCandidate = { factType: unknown; value: unknown; excerpt: unknown };

export type FactCheck =
  | { ok: true; factType: string; value: string; excerpt: string }
  | { ok: false; why: "type_not_allowed" | "bad_shape" | "too_long" | "excerpt_not_in_page" | "number_not_in_excerpt" };

/**
 * 一条事实过核对：类型在本支允许的类型里；值与摘录都是非空字符串、不超过 200 字；摘录逐字（NFKC、去空白、
 * 不分大小写）出现在正文里；值里的每一个数字都出现在摘录里。不改写，不满足就丢。
 */
export function checkFact(c: FactCandidate, pageText: string, allowedTypes: readonly string[]): FactCheck {
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
  if (!verifyEvidence(pageText, excerpt)) return { ok: false, why: "excerpt_not_in_page" };
  const inExcerpt = numbersIn(excerpt);
  for (const n of numbersIn(value)) {
    if (!inExcerpt.some((m) => Math.abs(m - n) < 1e-9)) return { ok: false, why: "number_not_in_excerpt" };
  }
  return { ok: true, factType: c.factType, value, excerpt };
}
