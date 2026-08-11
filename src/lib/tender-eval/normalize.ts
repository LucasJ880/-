/**
 * 归一化比较：关键事实不做文本相似度，做值等价。
 * "2026-08-13" == "Aug 13 2026" == "August 13, 2026"；$2,000,000 == 2000000；
 * "30 days" == "30 calendar days"。
 *
 * 全部为确定性纯函数（评估可复现的前提）。
 */

import type { NormalizedValue } from "./contract";

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

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 从任意文本中抽出所有可识别日期，标准化为 YYYY-MM-DD */
export function extractDatesYmd(text: string): string[] {
  const out = new Set<string>();
  const t = text.normalize("NFKC");

  // ISO: 2026-08-13
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  // Month D, YYYY | Month D YYYY（含缩写）
  for (const m of t.matchAll(
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/g,
  )) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (!mo) continue;
    out.add(`${m[3]}-${pad2(mo)}-${pad2(Number(m[2]))}`);
  }
  // D Month YYYY
  for (const m of t.matchAll(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})\b/g,
  )) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) continue;
    out.add(`${m[3]}-${pad2(mo)}-${pad2(Number(m[1]))}`);
  }
  return Array.from(out);
}

/** 抽出 HH:MM（支持 "14 :00" 与 "2:00 pm"） */
export function extractTimesHm(text: string): string[] {
  const out = new Set<string>();
  const t = text.normalize("NFKC");
  for (const m of t.matchAll(/\b(\d{1,2})\s*[:：]\s*(\d{2})\s*(am|pm)?\b/gi)) {
    let h = Number(m[1]);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h > 23 || Number(m[2]) > 59) continue;
    out.add(`${pad2(h)}:${m[2]}`);
  }
  return Array.from(out);
}

/** 抽出金额（$2,000,000 / 2,000,000.00 / $400K） */
export function extractMoneyAmounts(text: string): number[] {
  const out: number[] = [];
  const t = text.normalize("NFKC");
  for (const m of t.matchAll(
    /\$\s*([\d,]+(?:\.\d+)?)\s*([km])?\b|\b([\d,]+(?:\.\d+)?)\s*(?:dollars|加元|美元)\b/gi,
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

/** 抽出裸数字（含千分位），用于数量比较 */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.normalize("NFKC").matchAll(/\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\b/g)) {
    const v = Number(m[0]!.replace(/,/g, ""));
    if (!Number.isNaN(v)) out.push(v);
  }
  return out;
}

/** 抽出天数时长（"30 days" / "30 calendar days" / "5 个日历日" / "90 天"） */
export function extractDurationsDays(text: string): number[] {
  const out: number[] = [];
  const t = text.normalize("NFKC");
  for (const m of t.matchAll(
    /\b(\d+)\s*(?:calendar\s+|business\s+|working\s+)?days?\b|(\d+)\s*(?:个)?(?:日历日|工作日|天|日)/gi,
  )) {
    const v = Number(m[1] ?? m[2]);
    if (!Number.isNaN(v)) out.push(v);
  }
  return out;
}

/** 锚词组匹配：组内 AND，组间 OR；锚词与文本均归一化 */
export function anchorGroupsMatch(text: string, groups: string[][]): boolean {
  if (groups.length === 0) return false;
  const t = normalizeText(text);
  return groups.some((group) =>
    group.length > 0 && group.every((a) => t.includes(normalizeText(a))),
  );
}

/** 内容词覆盖率：golden 文本的去停用词 token 有多大比例出现在 candidate 中 */
const STOPWORDS = new Set(
  "the a an of to and or in on for with must be is are shall by at from as its it their any all that this within no not".split(
    " ",
  ),
);

export function tokenCoverage(goldenText: string, candidateText: string): number {
  const norm = (s: string) =>
    normalizeText(s)
      .replace(/[^a-z0-9一-鿿 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const goldenTokens = norm(goldenText);
  if (goldenTokens.length === 0) return 1;
  const cand = new Set(norm(candidateText));
  const hit = goldenTokens.filter((w) => cand.has(w)).length;
  return hit / goldenTokens.length;
}

/**
 * 值等价判定：golden NormalizedValue 是否被 candidate 文本正确表达。
 */
export function valueMatchesText(
  expected: NormalizedValue,
  candidateText: string,
): boolean {
  switch (expected.kind) {
    case "date":
      return extractDatesYmd(candidateText).includes(expected.value);
    case "datetime": {
      const dateOk = extractDatesYmd(candidateText).includes(expected.date);
      const timeOk = extractTimesHm(candidateText).includes(expected.time);
      const tzOk =
        expected.tz === null ||
        normalizeText(candidateText).includes(normalizeText(expected.tz));
      return dateOk && timeOk && tzOk;
    }
    case "money":
      return extractMoneyAmounts(candidateText).includes(expected.amount);
    case "quantity": {
      const numOk = extractNumbers(candidateText).includes(expected.value);
      const unitOk =
        expected.unit === null ||
        normalizeText(candidateText).includes(normalizeText(expected.unit));
      return numOk && unitOk;
    }
    case "duration":
      return extractDurationsDays(candidateText).includes(expected.days);
    case "boolean":
      // boolean 事实由锚词候选定位表达；候选存在即视为系统作出该断言
      return expected.value;
    case "text": {
      const t = normalizeText(candidateText);
      const values = [expected.value, ...(expected.aliases ?? [])];
      return values.some((v) => t.includes(normalizeText(v)));
    }
  }
}
