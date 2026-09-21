export const SEQUENCE_DAY_OFFSETS = [0, 3, 7] as const;
export type SequenceDayOffset = (typeof SEQUENCE_DAY_OFFSETS)[number];

export type SequenceCategory = "first" | "follow_up_d3" | "follow_up_d7";
export type SequenceStepStatus = "pending" | "drafted" | "sent" | "skipped";

export const SEQUENCE_CATEGORY_BY_OFFSET: Record<SequenceDayOffset, SequenceCategory> = {
  0: "first",
  3: "follow_up_d3",
  7: "follow_up_d7",
};

export const SEQUENCE_LABEL_BY_OFFSET: Record<SequenceDayOffset, string> = {
  0: "第 1 天 · 首封",
  3: "第 3 天 · 跟进",
  7: "第 7 天 · 收口",
};

export function isSequenceDayOffset(n: number): n is SequenceDayOffset {
  return n === 0 || n === 3 || n === 7;
}

export function addUtcDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function nextFollowUpAfterSend(sentAt: Date, sentOffset: SequenceDayOffset): Date | null {
  if (sentOffset === 0) return addUtcDays(sentAt, 3);
  if (sentOffset === 3) return addUtcDays(sentAt, 4);
  return null;
}
