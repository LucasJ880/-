/**
 * FLOW-H4a 投标提交记录——类型、输入校验、三种情形的判定（纯函数，零 DB / 网络 / 模型）
 *
 * 青砚不代为提交。这里只记录人已经做完的事：什么时候交的、怎么交的、回执编号。
 * 记录只追加：每一次记录与更正存成一条审计行，读最新的一条。
 */
import type { TenderStage } from "@/lib/tender/types";
import { withoutMoney } from "@/lib/tender-next-step/targets";

export const SUBMISSION_AUDIT_ACTION = "tender.submission.record";
export const SUBMISSION_AUDIT_TARGET = "project";

export const SUBMISSION_CHANNELS = ["portal", "email", "hand_delivery", "mail", "other"] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];
export const SUBMISSION_CHANNEL_ZH: Record<SubmissionChannel, string> = {
  portal: "采购门户",
  email: "电子邮件",
  hand_delivery: "当面递交",
  mail: "邮寄 / 快递",
  other: "其它方式",
};

/**
 * first = 项目此前没到提交阶段、也没有投标结果：进入提交阶段；
 * correction = 已有提交时间，改它；
 * backfill = 没有提交时间，但项目已经有投标结果（已中标、未中标、不投标……）或已算作提交阶段：只补上提交时间。
 */
export const SUBMISSION_KINDS = ["first", "correction", "backfill"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];
export const SUBMISSION_KIND_ZH: Record<SubmissionKind, string> = { first: "记录提交", correction: "更正", backfill: "补记提交时间" };

export const RECEIPT_REF_MAX = 120;
export const SUBMISSION_NOTE_MAX = 500;
/** 提交时间不能晚于现在；允许这么多的时钟误差 */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** 明显填错的年份（比如 2006）挡在外面 */
export const OLDEST_YEARS = 10;

export type SubmissionInput = { submittedAt: Date; channel: SubmissionChannel; receiptRef: string | null; note: string | null };

const hasControlChars = (s: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
const hasMoney = (s: string) => withoutMoney(s, "") !== s;

function text(value: unknown, labelZh: string, max: number, errors: string[], opts: { singleLine: boolean }): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") { errors.push(`${labelZh}须为文字`); return null; }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (hasControlChars(trimmed) || (opts.singleLine && /[\r\n]/.test(trimmed))) { errors.push(`${labelZh}里有不能保存的字符`); return null; }
  if (trimmed.length > max) { errors.push(`${labelZh}最多 ${max} 个字`); return null; }
  if (hasMoney(trimmed)) { errors.push(`${labelZh}里不要写金额、百分比或利润——这里只记提交的事实，所有能看项目的人都看得到`); return null; }
  return trimmed;
}

/** 校验接口收到的内容。任何一项不对都不保存，并把每一条原因说出来。 */
export function parseSubmissionInput(body: unknown, now: Date): { ok: true; value: SubmissionInput } | { ok: false; errors: string[] } {
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!o) return { ok: false, errors: ["请求内容须为一个对象"] };
  const errors: string[] = [];

  let submittedAt: Date | null = null;
  if (typeof o.submittedAt !== "string" || !o.submittedAt.trim()) errors.push("请填实际提交的时间");
  else {
    const d = new Date(o.submittedAt);
    if (Number.isNaN(d.getTime())) errors.push("提交时间不是有效的时刻");
    else if (d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) errors.push("提交时间不能晚于现在——这里记的是已经交完的标");
    else if (d.getTime() < now.getTime() - OLDEST_YEARS * 366 * 86_400_000) errors.push(`提交时间早于 ${OLDEST_YEARS} 年前，请核对年份`);
    else submittedAt = d;
  }

  let channel: SubmissionChannel | null = null;
  if (typeof o.channel === "string" && (SUBMISSION_CHANNELS as readonly string[]).includes(o.channel)) channel = o.channel as SubmissionChannel;
  else errors.push("请选择提交方式");

  const receiptRef = text(o.receiptRef, "回执编号", RECEIPT_REF_MAX, errors, { singleLine: true });
  const note = text(o.note, "备注", SUBMISSION_NOTE_MAX, errors, { singleLine: false });

  if (errors.length > 0 || !submittedAt || !channel) return { ok: false, errors };
  return { ok: true, value: { submittedAt, channel, receiptRef, note } };
}

/**
 * 招投标状态已经是「之后的事」：已提交，或已经有结果。这时再走阶段推进会把它改写成「已提交」——
 * 一个已中标的项目补记提交时间，不能把「已中标」冲掉。
 */
export const AFTER_SUBMISSION_STATUSES: readonly string[] = ["bid_submitted", "won", "lost", "passed", "no_bid", "cancelled", "archived", "completed", "terminated"];

/**
 * 这一次记录属于哪种情形。
 * recordedStage：阶段记录说的阶段；tenderStatus：招投标状态。
 */
export function classifySubmission(input: { recordedStage: TenderStage; submittedAt: Date | string | null | undefined; tenderStatus: string | null | undefined }): SubmissionKind {
  if (input.submittedAt) return "correction";
  if (input.recordedStage === "submission") return "backfill";
  return AFTER_SUBMISSION_STATUSES.includes((input.tenderStatus ?? "").toLowerCase()) ? "backfill" : "first";
}

/** 存进审计行 afterData 的内容。没有金额字段。 */
export type StoredSubmissionRecord = { v: 1; kind: SubmissionKind; submittedAt: string; channel: SubmissionChannel; receiptRef: string | null; note: string | null };

export function toStoredRecord(input: SubmissionInput, kind: SubmissionKind): StoredSubmissionRecord {
  return { v: 1, kind, submittedAt: input.submittedAt.toISOString(), channel: input.channel, receiptRef: input.receiptRef, note: input.note };
}

/** 读审计行里的内容；不是这个版本的形状、或缺东西 → null（当作没有记录，不猜） */
export function parseStoredRecord(afterData: unknown): StoredSubmissionRecord | null {
  let raw: unknown = afterData;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || o.v !== 1) return null;
  if (typeof o.submittedAt !== "string" || Number.isNaN(new Date(o.submittedAt).getTime())) return null;
  if (typeof o.channel !== "string" || !(SUBMISSION_CHANNELS as readonly string[]).includes(o.channel)) return null;
  if (typeof o.kind !== "string" || !(SUBMISSION_KINDS as readonly string[]).includes(o.kind)) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return { v: 1, kind: o.kind as SubmissionKind, submittedAt: o.submittedAt, channel: o.channel as SubmissionChannel, receiptRef: str(o.receiptRef), note: str(o.note) };
}

/** 接口返回给页面的内容 */
export type SubmissionRecordView = {
  /** 项目上的提交时间（没有 = 还没提交） */
  submittedAt: string | null;
  /** 下一次记录会是哪种情形；null = 现在不能记录（见 blockedZh） */
  nextKind: SubmissionKind | null;
  /** 不能记录的原因（项目已放弃、已归档）；能记录时为 null */
  blockedZh: string | null;
  /** 这个人有没有写权限 */
  canRecord: boolean;
  /** 最新的一条记录；没有记录为 null（项目可能已有提交时间而没有记录：是在对话里推进阶段写入的） */
  record: (StoredSubmissionRecord & { recordedAt: string; recordedByName: string | null }) | null;
  /** 历次记录的条数 */
  count: number;
};

/** 保存前确认框里的话：照实说这一下会发生什么 */
export function confirmTextZh(kind: SubmissionKind): string {
  if (kind === "first") return "保存后项目会被标为「已提交」，项目成员会收到通知。之后可以更正提交时间与回执，但不能撤销「已提交」。确认这个标已经交了吗？";
  if (kind === "backfill") return "这个项目已经有投标结果，但没有提交时间。保存后只补上提交时间与回执，不改投标结果。";
  return "保存后提交时间会改成这次填的值，并留下一条更正记录。之前的记录不会被删除。";
}
