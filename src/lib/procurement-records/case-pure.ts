/**
 * PROC-1 案件纯函数（design D9）：状态转换表、事件类型、期限、回执比对、旧状态映射、站内待办种类。
 */

import { foldText, institutionAliases } from "./identity";
import type { GovernmentOutcome, RequestStatus } from "./duplicate-check";
import { GOVERNMENT_OUTCOMES } from "./duplicate-check";
import type { CaseEventType } from "./labels";

export { CASE_EVENT_TYPES, EVENT_LABELS, OUTCOME_LABELS } from "./labels";
export type { CaseEventType } from "./labels";

// ─────────────────────────── 状态转换 ───────────────────────────

export const REQUEST_ACTIONS = [
  "MARK_READY",
  "REVERT_TO_DRAFT",
  "START_HANDOFF",
  "CANCEL_HANDOFF",
  "REPORT_SUBMITTED",
  "REPORT_UNKNOWN",
  "VERIFY_RECEIPT",
  "RESOLVE_UNKNOWN_NOT_SUBMITTED",
  "ACKNOWLEDGE",
  "PROCESSING_EVENT",
  "FINAL_RESPONSE",
] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

const SUBMITTED_LIKE: RequestStatus[] = ["USER_REPORTED_SUBMISSION", "SUBMITTED", "ACKNOWLEDGED", "PROCESSING"];

export const TRANSITIONS: Record<RequestAction, { from: RequestStatus[]; to: RequestStatus | "SAME" }> = {
  MARK_READY: { from: ["DRAFT"], to: "READY" },
  REVERT_TO_DRAFT: { from: ["READY"], to: "DRAFT" },
  START_HANDOFF: { from: ["READY"], to: "HANDOFF_PENDING" },
  CANCEL_HANDOFF: { from: ["HANDOFF_PENDING"], to: "READY" },
  REPORT_SUBMITTED: { from: ["HANDOFF_PENDING", "SUBMISSION_UNKNOWN"], to: "USER_REPORTED_SUBMISSION" },
  REPORT_UNKNOWN: { from: ["HANDOFF_PENDING"], to: "SUBMISSION_UNKNOWN" },
  VERIFY_RECEIPT: { from: ["USER_REPORTED_SUBMISSION", "SUBMISSION_UNKNOWN"], to: "SUBMITTED" },
  RESOLVE_UNKNOWN_NOT_SUBMITTED: { from: ["SUBMISSION_UNKNOWN"], to: "READY" },
  ACKNOWLEDGE: { from: ["USER_REPORTED_SUBMISSION", "SUBMITTED", "ACKNOWLEDGED", "PROCESSING"], to: "ACKNOWLEDGED" },
  PROCESSING_EVENT: { from: SUBMITTED_LIKE, to: "PROCESSING" },
  FINAL_RESPONSE: { from: SUBMITTED_LIKE, to: "CLOSED" },
};

export type TransitionResult = { ok: true; to: RequestStatus } | { ok: false; code: "INVALID_TRANSITION"; messageZh: string };

export function transition(from: string, action: RequestAction): TransitionResult {
  const t = TRANSITIONS[action];
  if (!(t.from as string[]).includes(from)) {
    return { ok: false, code: "INVALID_TRANSITION", messageZh: `状态 ${from} 不能执行 ${action}` };
  }
  // 已受理后再登记受理（补录 / 更正编号）不回退处理中状态
  if (action === "ACKNOWLEDGE" && from === "PROCESSING") return { ok: true, to: "PROCESSING" };
  return { ok: true, to: t.to === "SAME" ? (from as RequestStatus) : t.to };
}

export function isSubmittedLike(status: string): boolean {
  return ["USER_REPORTED_SUBMISSION", "SUBMISSION_UNKNOWN", "SUBMITTED", "ACKNOWLEDGED", "PROCESSING", "CLOSED"].includes(status);
}

// ─────────────────────────── 案件事件 ───────────────────────────



/** 事件 → 状态动作（null = 不改申请状态） */
export function actionForEvent(type: CaseEventType): RequestAction | null {
  switch (type) {
    case "ACKNOWLEDGED":
      return "ACKNOWLEDGE";
    case "CLARIFICATION_REQUEST":
    case "CLARIFICATION_SENT":
    case "FEE_NOTICE":
    case "EXTENSION":
    case "TRANSFER_ADVISED":
    case "TRANSFERRED":
    case "PARTIAL_RELEASE":
    case "RESPONSE_LETTER":
      return "PROCESSING_EVENT";
    case "FINAL_RESPONSE":
    case "WITHDRAWAL_CONFIRMED":
      return "FINAL_RESPONSE";
    default:
      return null;
  }
}

/** 事件 → 站内待办种类 */
export type TaskKind = "SUPPLY_INFO" | "USER_DECISION" | "UPLOAD_DISCLOSURE" | "REVIEW_ANALYSIS" | "FOLLOW_UP_DUE" | "RESOLVE_UNKNOWN";

export const TASK_TITLES: Record<TaskKind, string> = {
  SUPPLY_INFO: "资料申请：机关要求补充 / 澄清",
  USER_DECISION: "资料申请：需要你决定下一步",
  UPLOAD_DISCLOSURE: "资料申请：披露附件待上传",
  REVIEW_ANALYSIS: "资料申请：分析明细待复核",
  FOLLOW_UP_DUE: "资料申请：内部跟进到期",
  RESOLVE_UNKNOWN: "资料申请：核查提交结果（官方账户 / 回执 / 付款证据）",
};

export function taskKindForEvent(type: string, ctx: { hasDisclosureFiles: boolean }): TaskKind | null {
  switch (type) {
    case "CLARIFICATION_REQUEST":
      return "SUPPLY_INFO";
    case "FEE_NOTICE":
    case "EXTENSION":
    case "TRANSFER_ADVISED":
    case "TRANSFERRED":
      return "USER_DECISION";
    case "FINAL_RESPONSE":
    case "PARTIAL_RELEASE":
    case "RESPONSE_LETTER":
      return ctx.hasDisclosureFiles ? null : "UPLOAD_DISCLOSURE";
    case "SUBMISSION_UNKNOWN":
      return "RESOLVE_UNKNOWN";
    default:
      return null;
  }
}

export function isGovernmentOutcome(v: unknown): v is GovernmentOutcome {
  return typeof v === "string" && (GOVERNMENT_OUTCOMES as readonly string[]).includes(v);
}


// ─────────────────────────── 文件状态 ───────────────────────────

export type FilesStatus = "NONE" | "NOTICE_RECEIVED" | "PARTIAL_FILES_RECEIVED" | "FILES_RECEIVED";

/** 文件状态只由证据决定：只有来信 → NOTICE_RECEIVED；有披露文件 → PARTIAL；用户确认全部取得 → FILES_RECEIVED */
export function deriveFilesStatus(input: { hasLetter: boolean; disclosureFileCount: number; userConfirmedAllFiles: boolean }): FilesStatus {
  if (input.disclosureFileCount > 0 && input.userConfirmedAllFiles) return "FILES_RECEIVED";
  if (input.disclosureFileCount > 0) return "PARTIAL_FILES_RECEIVED";
  if (input.hasLetter) return "NOTICE_RECEIVED";
  return "NONE";
}

// ─────────────────────────── 期限 ───────────────────────────

export interface DeadlineEstimate {
  estimatedDueAt: string | null;
  basisZh: string;
}

/**
 * 估算期限（只对日历日规则估算；工作日 / 未知不估算）。起算日 = 机关收到 / 登记申请的日期。
 * 结果永远标「估算」，不计延期、补件、节假日；不显示精确法律倒计时。
 */
export function estimateDueDate(input: { receivedDate: string | null; deadlineValue: number | null; deadlineUnit: string | null; channel: string }): DeadlineEstimate {
  if (input.channel === "INFORMAL") return { estimatedDueAt: null, basisZh: "非正式副本请求不适用正式申请的法定时限，不估算" };
  if (!input.receivedDate) return { estimatedDueAt: null, basisZh: "起算日未知，不估算" };
  if (!input.deadlineValue || input.deadlineUnit !== "CALENDAR_DAYS") return { estimatedDueAt: null, basisZh: "时限规则未核实或按工作日计算，不估算" };
  const d = new Date(`${input.receivedDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + input.deadlineValue);
  return {
    estimatedDueAt: d.toISOString().slice(0, 10),
    basisZh: `估算：自 ${input.receivedDate} 起 ${input.deadlineValue} 个日历日（未计延期、补件与节假日；以机关来信为准）`,
  };
}

// ─────────────────────────── 回执比对 ───────────────────────────

export interface ReceiptMatch {
  referenceFound: boolean;
  institutionFound: boolean;
  textAvailable: boolean;
}

/** 确定性比对：提交编号与接收机关名称是否出现在回执文本中（辅助；最终由真实用户确认） */
export function matchReceipt(input: { receiptText: string | null; submissionReference: string | null; institutionKey: string | null; institutionName: string | null }): ReceiptMatch {
  const text = input.receiptText ?? "";
  if (!text.trim()) return { referenceFound: false, institutionFound: false, textAvailable: false };
  const compact = text.toUpperCase().replace(/[\s\-_./#]+/g, "");
  const ref = (input.submissionReference ?? "").toUpperCase().replace(/[\s\-_./#]+/g, "");
  const folded = ` ${foldText(text)} `;
  const names = [
    ...(input.institutionKey ? institutionAliases(input.institutionKey) : []),
    ...(input.institutionName ? [input.institutionName] : []),
  ]
    .map((n) => foldText(n))
    .filter((n) => n.length >= 3);
  return {
    referenceFound: ref.length >= 4 && compact.includes(ref),
    institutionFound: names.some((n) => folded.includes(` ${n} `)),
    textAvailable: true,
  };
}

/** 能作为提交证据的附件类别（付款凭证 / 截图不能单独证明提交） */
export function isSufficientReceiptKind(kind: string): boolean {
  return kind === "RECEIPT" || kind === "GOVERNMENT_LETTER";
}

// ─────────────────────────── 旧状态映射 ───────────────────────────

export interface LegacyMapping {
  status: RequestStatus;
  filesStatus: FilesStatus;
  governmentOutcome: GovernmentOutcome | null;
  /** 映射结果要求最终回应证据（无证据导入时降为 PROCESSING） */
  requiresFinalEvidence: boolean;
}

const LEGACY_TABLE: Record<string, LegacyMapping> = {
  DRAFT: { status: "DRAFT", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  READY: { status: "READY", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  SUBMITTED: { status: "USER_REPORTED_SUBMISSION", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  SUBMISSION_UNKNOWN: { status: "SUBMISSION_UNKNOWN", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  ACKNOWLEDGED: { status: "ACKNOWLEDGED", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  IN_PROGRESS: { status: "PROCESSING", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  PROCESSING: { status: "PROCESSING", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  EXTENDED: { status: "PROCESSING", filesStatus: "NONE", governmentOutcome: null, requiresFinalEvidence: false },
  RELEASE_NOTICE_RECEIVED: { status: "PROCESSING", filesStatus: "NOTICE_RECEIVED", governmentOutcome: null, requiresFinalEvidence: false },
  PARTIAL_RELEASE: { status: "CLOSED", filesStatus: "PARTIAL_FILES_RECEIVED", governmentOutcome: "PARTIAL_DISCLOSURE", requiresFinalEvidence: true },
  FULL_RELEASE: { status: "CLOSED", filesStatus: "FILES_RECEIVED", governmentOutcome: "FULL_DISCLOSURE", requiresFinalEvidence: true },
  NO_RECORDS: { status: "CLOSED", filesStatus: "NOTICE_RECEIVED", governmentOutcome: "NO_RECORDS", requiresFinalEvidence: true },
  ALL_WITHHELD: { status: "CLOSED", filesStatus: "NOTICE_RECEIVED", governmentOutcome: "ALL_WITHHELD", requiresFinalEvidence: true },
  TRANSFERRED: { status: "PROCESSING", filesStatus: "NONE", governmentOutcome: "TRANSFERRED", requiresFinalEvidence: false },
  WITHDRAWN: { status: "CLOSED", filesStatus: "NONE", governmentOutcome: "WITHDRAWN", requiresFinalEvidence: true },
  CANCELLED: { status: "CLOSED", filesStatus: "NONE", governmentOutcome: "CANCELLED", requiresFinalEvidence: true },
};

export function mapLegacyStatus(value: string): { ok: true; mapping: LegacyMapping } | { ok: false; code: "UNMAPPED_LEGACY_STATUS"; value: string } {
  const key = value.trim().toUpperCase();
  const m = LEGACY_TABLE[key];
  return m ? { ok: true, mapping: m } : { ok: false, code: "UNMAPPED_LEGACY_STATUS", value };
}

/**
 * 历史导入降级：没有最终回应证据（来信附件）时不 CLOSED；没有披露文件时文件状态最多 NOTICE_RECEIVED。
 */
export function applyImportEvidence(m: LegacyMapping, evidence: { hasFinalLetter: boolean; hasDisclosureFiles: boolean; hasLetterReported: boolean }): LegacyMapping & { noteZh: string[] } {
  const notes: string[] = [];
  let status = m.status;
  let files = m.filesStatus;
  let outcome = m.governmentOutcome;
  if (m.requiresFinalEvidence && !evidence.hasFinalLetter) {
    status = "PROCESSING";
    outcome = null;
    notes.push("最终回应来信未导入，不标 CLOSED，政府处理结果暂不记录");
  }
  if ((files === "FILES_RECEIVED" || files === "PARTIAL_FILES_RECEIVED") && !evidence.hasDisclosureFiles) {
    files = evidence.hasLetterReported || m.filesStatus !== "NONE" ? "NOTICE_RECEIVED" : "NONE";
    notes.push("披露文件未导入，文件状态不标已取得");
  }
  return { ...m, status, filesStatus: files, governmentOutcome: outcome, noteZh: notes };
}
