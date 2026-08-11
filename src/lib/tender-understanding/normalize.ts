/**
 * V2 确定性归一化（generic helpers only）
 *
 * Regex 在 V2 的唯一角色：通用格式（日期/金额/数量/单位/百分比/编号锚点）。
 * 明确禁止：任何指向具体 Tender 答案的模式（固定编号/固定日期/固定颜色/固定容量）。
 *
 * 独立实现（不 import tender-eval，避免生产↔考卷耦合）。
 */

import type { NormalizedValueV2 } from "./contract";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function normalizeWhitespace(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForMatch(s: string): string {
  return normalizeWhitespace(s).toLowerCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 文本中的全部日期 → YYYY-MM-DD（多格式等价："Aug 13 2026" == "2026-08-13"） */
export function extractDatesYmd(text: string): string[] {
  const out = new Set<string>();
  const t = text.normalize("NFKC");
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  for (const m of t.matchAll(
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/g,
  )) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (mo) out.add(`${m[3]}-${pad2(mo)}-${pad2(Number(m[2]))}`);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})\b/g)) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (mo) out.add(`${m[3]}-${pad2(mo)}-${pad2(Number(m[1]))}`);
  }
  return Array.from(out);
}

export function extractTimesHm(text: string): string[] {
  const out = new Set<string>();
  for (const m of text
    .normalize("NFKC")
    .matchAll(/\b(\d{1,2})\s*[:：]\s*(\d{2})\s*(am|pm)?\b/gi)) {
    let h = Number(m[1]);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h > 23 || Number(m[2]) > 59) continue;
    out.add(`${pad2(h)}:${m[2]}`);
  }
  return Array.from(out);
}

export function extractTimezoneLabel(text: string): string | null {
  const m = text.match(
    /\b(MDT|MST|EDT|EST|PDT|PST|CDT|CST|ADT|AST|NDT|NST|UTC|GMT)\b/i,
  );
  return m ? m[1]!.toUpperCase() : null;
}

export function extractMoneyAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text
    .normalize("NFKC")
    .matchAll(
      /\$\s*([\d,]+(?:\.\d+)?)\s*([km])?\b|\b([\d,]+(?:\.\d+)?)\s*(?:dollars|CAD|USD|加元|美元)\b/gi,
    )) {
    const raw = (m[1] ?? m[3] ?? "").replace(/,/g, "");
    if (!raw) continue;
    let v = Number(raw);
    if (Number.isNaN(v)) continue;
    const suffix = m[2]?.toLowerCase();
    if (suffix === "k") v *= 1_000;
    if (suffix === "m") v *= 1_000_000;
    out.push(v);
  }
  return out;
}

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text
    .normalize("NFKC")
    .matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g)) {
    const v = Number(m[0]!.replace(/,/g, ""));
    if (!Number.isNaN(v)) out.push(v);
  }
  return out;
}

export function extractDurationsDays(text: string): number[] {
  const out: number[] = [];
  for (const m of text
    .normalize("NFKC")
    .matchAll(
      /\b(\d+)\s*(?:calendar\s+|business\s+|working\s+)?days?\b|(\d+)\s*(?:个)?(?:日历日|工作日|天|日)/gi,
    )) {
    const v = Number(m[1] ?? m[2]);
    if (!Number.isNaN(v)) out.push(v);
  }
  return out;
}

export function extractPercents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.normalize("NFKC").matchAll(/\b(\d+(?:\.\d+)?)\s*%/g)) {
    out.push(Number(m[1]));
  }
  return out;
}

/**
 * 按 factType 语义归一化 rawValue/claim；解析不出 → null（绝不猜值）。
 * 返回值保留 raw（调用方存 rawValue）+ normalized。
 */
export function normalizeFactValue(
  factType: string,
  raw: string | null,
  claim: string,
): NormalizedValueV2 | null {
  const source = `${raw ?? ""} ${claim}`;
  switch (factType) {
    case "closing_datetime":
    case "question_deadline":
    case "site_visit": {
      const dates = extractDatesYmd(source);
      if (dates.length === 0) return null;
      const times = extractTimesHm(source);
      return {
        kind: "datetime",
        date: dates[0]!,
        time: times[0] ?? null,
        tz: extractTimezoneLabel(source),
      };
    }
    case "quantity": {
      const nums = extractNumbers(source);
      if (nums.length === 0) return null;
      return { kind: "quantity", value: nums[0]!, unit: null };
    }
    case "warranty":
    case "contract_duration":
    case "delivery": {
      const days = extractDurationsDays(source);
      if (days.length > 0) return { kind: "duration_days", days: days[0]! };
      const dates = extractDatesYmd(source);
      if (dates.length > 0) return { kind: "date", value: dates[0]! };
      return { kind: "text", value: normalizeForMatch(raw ?? claim) };
    }
    case "bond":
    case "insurance": {
      const money = extractMoneyAmounts(source);
      if (money.length > 0) return { kind: "money", amount: money[0]!, currency: null };
      return { kind: "text", value: normalizeForMatch(raw ?? claim) };
    }
    default: {
      const v = normalizeForMatch(raw ?? claim);
      return v ? { kind: "text", value: v } : null;
    }
  }
}

/* ---------------------------------- token 工具 ---------------------------------- */

const STOPWORDS = new Set(
  "the a an of to and or in on for with must be is are shall by at from as its it their any all that this within no not will".split(
    " ",
  ),
);

export function contentTokens(s: string): string[] {
  return normalizeForMatch(s)
    .replace(/[^a-z0-9一-鿿 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function tokenJaccard(a: string, b: string): number {
  const sa = new Set(contentTokens(a));
  const sb = new Set(contentTokens(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export function tokenOverlapRatio(needle: string, haystack: string): number {
  const n = contentTokens(needle);
  if (n.length === 0) return 1;
  const h = new Set(contentTokens(haystack));
  const hit = n.filter((t) => h.has(t)).length;
  return hit / n.length;
}

/** 语句指纹（去重用）：排序后的内容词串 */
export function statementFingerprint(s: string): string {
  return Array.from(new Set(contentTokens(s))).sort().join(" ");
}
