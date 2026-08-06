/**
 * Addendum 对比纯函数（无 DB）
 */

import type { ChangeType } from "./constants";

export type DiffRequirement = {
  requirementCode: string;
  chineseTranslation: string;
  originalRequirement?: string | null;
  mandatory?: boolean;
  sourcePage?: number | null;
  dueDateHint?: string | null;
};

export type DiffCandidate = {
  changeType: ChangeType;
  entityType: "requirement" | "date";
  entityKey: string;
  beforeJson: unknown;
  afterJson: unknown;
  summaryZh: string;
};

function norm(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function extractDateHints(text: string): string[] {
  const matches =
    text.match(
      /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2})\b/gi,
    ) || [];
  return [...new Set(matches.map((m) => m.trim()))];
}

/** 纯函数：对比前后要求列表，产出变更候选 */
export function diffRequirements(
  before: readonly DiffRequirement[],
  after: readonly DiffRequirement[],
): DiffCandidate[] {
  const beforeMap = new Map(before.map((r) => [r.requirementCode, r]));
  const afterMap = new Map(after.map((r) => [r.requirementCode, r]));
  const out: DiffCandidate[] = [];

  for (const [code, a] of afterMap) {
    const b = beforeMap.get(code);
    if (!b) {
      out.push({
        changeType: "ADDED",
        entityType: "requirement",
        entityKey: code,
        beforeJson: null,
        afterJson: a,
        summaryZh: `新增要求 ${code}：${a.chineseTranslation.slice(0, 80)}`,
      });
      continue;
    }

    const textChanged =
      norm(b.chineseTranslation) !== norm(a.chineseTranslation) ||
      norm(b.originalRequirement) !== norm(a.originalRequirement);
    const beforeDates = extractDateHints(
      `${b.chineseTranslation} ${b.originalRequirement || ""} ${b.dueDateHint || ""}`,
    );
    const afterDates = extractDateHints(
      `${a.chineseTranslation} ${a.originalRequirement || ""} ${a.dueDateHint || ""}`,
    );
    const datesChanged =
      beforeDates.join("|") !== afterDates.join("|") &&
      (beforeDates.length > 0 || afterDates.length > 0);

    if (datesChanged) {
      out.push({
        changeType: "DATE_CHANGED",
        entityType: "date",
        entityKey: code,
        beforeJson: { dates: beforeDates, requirement: b },
        afterJson: { dates: afterDates, requirement: a },
        summaryZh: `要求 ${code} 日期变更：${beforeDates.join("、") || "无"} → ${afterDates.join("、") || "无"}`,
      });
    } else if (textChanged) {
      out.push({
        changeType: "MODIFIED",
        entityType: "requirement",
        entityKey: code,
        beforeJson: b,
        afterJson: a,
        summaryZh: `要求 ${code} 内容变更`,
      });
    }
  }

  for (const [code, b] of beforeMap) {
    if (!afterMap.has(code)) {
      out.push({
        changeType: "REMOVED",
        entityType: "requirement",
        entityKey: code,
        beforeJson: b,
        afterJson: null,
        summaryZh: `删除要求 ${code}：${b.chineseTranslation.slice(0, 80)}`,
      });
    }
  }

  return out;
}
