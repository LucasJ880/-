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

/** 控制字符、行分隔符、改变文字方向的不可见字符（会让显示出来的内容与存的不一样） */
const hasControlChars = (s: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(s);
/** 带时区的 ISO 时刻（页面发的就是这种）。「2026-11-08」「11/08/2026」这类写法会被按服务器所在的时区猜，不收 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const hasMoney = (s: string) => withoutMoney(s, "") !== s;

function text(value: unknown, labelZh: string, max: number, errors: string[], opts: { singleLine: boolean; noMoney: boolean }): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") { errors.push(`${labelZh}须为文字`); return null; }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (hasControlChars(trimmed) || (opts.singleLine && /[\r\n]/.test(trimmed))) { errors.push(`${labelZh}里有不能保存的字符`); return null; }
  if (opts.singleLine && /\t/.test(trimmed)) { errors.push(`${labelZh}里有不能保存的字符`); return null; }
  if (trimmed.length > max) { errors.push(`${labelZh}最多 ${max} 个字`); return null; }
  if (opts.noMoney && hasMoney(trimmed)) { errors.push(`${labelZh}里不要写金额、百分比或利润——这里只记提交的事实，所有能看项目的人都看得到`); return null; }
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
    const d = ISO_INSTANT.test(o.submittedAt.trim()) ? new Date(o.submittedAt.trim()) : new Date(NaN);
    if (Number.isNaN(d.getTime())) errors.push("提交时间不是有效的时刻");
    else if (d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) errors.push("提交时间不能晚于现在——这里记的是已经交完的标");
    else if (d.getTime() < now.getTime() - OLDEST_YEARS * 366 * 86_400_000) errors.push(`提交时间早于 ${OLDEST_YEARS} 年前，请核对年份`);
    else submittedAt = d;
  }

  let channel: SubmissionChannel | null = null;
  if (typeof o.channel === "string" && (SUBMISSION_CHANNELS as readonly string[]).includes(o.channel)) channel = o.channel as SubmissionChannel;
  else errors.push("请选择提交方式");

  // 回执编号是门户给的一串标识（可能长得像 CAD-2026-00123），不按金额拦；备注是自由文字，拦常见的金额写法
  const receiptRef = text(o.receiptRef, "回执编号", RECEIPT_REF_MAX, errors, { singleLine: true, noMoney: false });
  const note = text(o.note, "备注", SUBMISSION_NOTE_MAX, errors, { singleLine: false, noMoney: true });

  if (errors.length > 0 || !submittedAt || !channel) return { ok: false, errors };
  return { ok: true, value: { submittedAt, channel, receiptRef, note } };
}

/**
 * 招投标状态已经是「之后的事」：已提交，或已经有结果。这时再走阶段推进会把它改写成「已提交」——
 * 一个已中标的项目补记提交时间，不能把「已中标」冲掉。
 */
export const AFTER_SUBMISSION_STATUSES: readonly string[] = ["bid_submitted", "won", "lost", "archived", "completed", "terminated"];

/** 招投标状态说明这个标没有投（或招标取消了）：没有提交可记 */
export const NO_SUBMISSION_STATUS_ZH: Readonly<Record<string, string>> = { no_bid: "不投标", passed: "已放弃投标", cancelled: "已取消" };

/**
 * 现在不能记录的原因；能记录时为 null。
 *   - 项目已放弃 / 已归档；
 *   - 招投标状态是不投标、已放弃投标、已取消，而且没有提交时间（有提交时间的——比如交了之后招标取消——仍可更正）。
 */
export function blockedReasonZh(project: { status: string | null; tenderStatus: string | null | undefined; submittedAt: Date | string | null | undefined }): string | null {
  if (project.status === "abandoned") return "项目已放弃，不能再记录提交";
  if (project.status === "archived") return "项目已归档，不能再记录提交";
  const label = NO_SUBMISSION_STATUS_ZH[(project.tenderStatus ?? "").toLowerCase()];
  if (label && !project.submittedAt) return `这个项目的投标结果是「${label}」，没有提交可记；如果其实投了，请先改投标结果`;
  return null;
}

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
  /** 项目来自外部来源系统（BidToGo）：第一次记录会把「已提交」的状态同步回去 */
  syncsToSource: boolean;
  /** 最新的一条记录；没有记录为 null（项目可能已有提交时间而没有记录：是在对话里推进阶段写入的） */
  record: (StoredSubmissionRecord & { recordedAt: string; recordedByName: string | null }) | null;
  /** 历次记录的条数 */
  count: number;
};

/** 保存前确认框里的话：照实说这一下会发生什么 */
export function confirmTextZh(kind: SubmissionKind, opts: { syncsToSource?: boolean } = {}): string {
  if (kind === "first") return `保存后项目会被标为「已提交」，项目成员会收到通知${opts.syncsToSource ? "，「已提交」的状态也会同步回这个项目的来源系统" : ""}。之后可以更正提交时间与回执，但不能撤销「已提交」。确认这个标已经交了吗？`;
  if (kind === "backfill") return "这个项目已经有投标结果，但没有提交时间。保存后只补上提交时间与回执，不改投标结果。";
  return "保存后提交时间会改成这次填的值，并留下一条更正记录。之前的记录不会被删除。";
}

/* ---------- 页面用的小工具（纯函数） ---------- */

/**
 * 时刻 → `<input type="datetime-local">` 要的本地时间写法（到分钟）。
 * 用这个时刻自己那一天的时区偏移（Date 的本地取值）——不能拿「今天」的偏移去换算别的日子：
 * 夏令时前后差一小时，补记上个月的提交会整整错一小时。
 */
export function toDatetimeLocal(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`;
}

/** `<input type="datetime-local">` 的值 → 时刻（ISO）；空或不是时刻 → null。按填的那一天的本地时间解释。 */
export function fromDatetimeLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(`${value.slice(0, 16)}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 表单要提交的时间。人没动过时间那一栏、而项目已有提交时间 → 原样用已有的那个时刻（表单只精确到分钟，
 * 不能因为只补了个回执编号就把秒数抹掉、还多出一条「提交时间变了」的消息）。
 */
export function submittedAtToSend(input: { fieldValue: string; touched: boolean; existing: string | null | undefined }): string | null {
  if (!input.touched && input.existing) return input.existing;
  return fromDatetimeLocal(input.fieldValue);
}

/** 这一块最上面的一句话：现在是什么状态。只说事实，回执编号是人填的，不说「已核实」。 */
export function statusLineZh(view: Pick<SubmissionRecordView, "submittedAt" | "record" | "count">): string {
  if (!view.submittedAt) return "还没有提交记录";
  if (!view.record) return "项目已标为已提交，但没有回执记录（提交时间是在别处推进阶段时写入的）";
  const receipt = view.record.receiptRef ? `回执编号 ${view.record.receiptRef}（由记录人填写）` : "没有填回执编号";
  return `已提交 · ${SUBMISSION_CHANNEL_ZH[view.record.channel]} · ${receipt}${view.count > 1 ? ` · 共记录 ${view.count} 次，显示的是最新一次` : ""}`;
}

/** 打开表单的按钮上写什么 */
export function openButtonZh(kind: SubmissionKind): string {
  return kind === "first" ? "记录已提交" : kind === "backfill" ? "补记提交时间" : "更正";
}
