/**
 * TI-1 截标时间校验与状态推导（纯函数）
 *
 * 截标时间必须带时区：不带时区的写法在不同机器上会被解释成不同时刻。
 * 本模块是招标截标专用的严格校验；src/lib/time 的 parseBusinessDateTime
 *（无时区按多伦多时间）服务于其它场景，这里不复用也不改它。
 */

export type ClosingTimeResult =
  | { ok: true; closingAt: Date }
  | { ok: false; code: "MISSING" | "NO_TIMEZONE" | "INVALID"; messageZh: string };

const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const NAIVE = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

export function parseClosingTime(input: unknown): ClosingTimeResult {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, code: "MISSING", messageZh: "缺少截标时间" };
  }
  const s = input.trim();
  if (NAIVE.test(s)) {
    return { ok: false, code: "NO_TIMEZONE", messageZh: "截标时间缺少时区（应形如 2026-11-10T15:00:00-05:00）" };
  }
  if (!WITH_ZONE.test(s)) {
    return { ok: false, code: "INVALID", messageZh: "截标时间格式无法识别" };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { ok: false, code: "INVALID", messageZh: "截标时间不是有效时刻" };
  return { ok: true, closingAt: d };
}

/** 提交记录：只有带平台回执的才算数（点击记录、口头确认都不算）。 */
export type SubmissionRecord = { submittedAt?: Date | string | null; receiptRef?: string | null };

export const TENDER_WINDOW_STATES = ["OPEN", "SUBMITTED", "EXPIRED"] as const;
export type TenderWindowState = (typeof TENDER_WINDOW_STATES)[number];

export function hasReceiptBackedSubmission(submission: SubmissionRecord | null | undefined): boolean {
  return typeof submission?.receiptRef === "string" && submission.receiptRef.trim().length > 0;
}

/**
 * 未过截标 → OPEN；已过且有回执支撑的提交 → SUBMITTED；已过且没有 → EXPIRED。
 * 这是推导出的判定，不是新的流程状态，不落库。
 */
export function deriveTenderWindowState(input: {
  closingAt: Date;
  now: Date;
  submission?: SubmissionRecord | null;
}): TenderWindowState {
  if (input.now.getTime() < input.closingAt.getTime()) return "OPEN";
  return hasReceiptBackedSubmission(input.submission) ? "SUBMITTED" : "EXPIRED";
}
