/**
 * PROC-1 「下一步」：把申请状态 / 文件状态 / 分析状态折算成用户现在该做的一件事（纯函数、客户端安全）。
 * 只用于界面引导，不改变任何状态；详细的状态机、证据等级与重复检查仍在详情的「详细信息」里。
 */

export type DetailTab = "content" | "progress" | "analysis" | "details";

export interface NextStepInput {
  status: string;
  filesStatus: string | null;
  analysisStatus: string | null;
  archived?: boolean;
  /** READY 闸阻塞项数量（只有草稿阶段有意义；未知传 null） */
  blockers?: number | null;
  pendingTasks?: number | null;
}

export interface NextStep {
  key:
    | "ARCHIVED"
    | "FIX_DRAFT"
    | "MARK_READY"
    | "START_SUBMIT"
    | "SUBMIT_AND_REPORT"
    | "VERIFY_RECEIPT"
    | "RESOLVE_UNKNOWN"
    | "WAIT_REPLY"
    | "REVIEW_FILES"
    | "VIEW_ANALYSIS"
    | "DONE";
  titleZh: string;
  hintZh: string;
  /** 详情页默认打开的页签 */
  tab: DetailTab;
  tone: "info" | "warn" | "good" | "neutral";
}

const SUBMITTED_LIKE = new Set(["SUBMITTED", "ACKNOWLEDGED", "PROCESSING"]);

export function nextStepFor(i: NextStepInput): NextStep {
  if (i.archived) return { key: "ARCHIVED", titleZh: "已归档", hintZh: "本地归档的草稿，未向政府提交。", tab: "content", tone: "neutral" };
  const files = i.filesStatus ?? "NONE";
  const analysis = i.analysisStatus ?? "NOT_STARTED";
  const hasFiles = files === "PARTIAL_FILES_RECEIVED" || files === "FILES_RECEIVED";
  switch (i.status) {
    case "DRAFT":
      if (i.blockers === null || i.blockers === undefined)
        return { key: "FIX_DRAFT", titleZh: "完善申请卡，然后标记就绪", hintZh: "补齐后才能提交。", tab: "content", tone: "warn" };
      return i.blockers > 0
        ? { key: "FIX_DRAFT", titleZh: `完善申请卡（还差 ${i.blockers} 项）`, hintZh: "补齐后才能提交。", tab: "content", tone: "warn" }
        : { key: "MARK_READY", titleZh: "检查无误后标记就绪", hintZh: "就绪后即可去官方渠道提交。", tab: "content", tone: "info" };
    case "READY":
      return { key: "START_SUBMIT", titleZh: "可以提交了", hintZh: "点「开始提交」，按步骤在官方渠道自己提交。", tab: "content", tone: "good" };
    case "HANDOFF_PENDING":
      return { key: "SUBMIT_AND_REPORT", titleZh: "去官方渠道提交，然后回来登记", hintZh: "复制正文、打开入口都不算提交；提交后登记并上传回执。", tab: "content", tone: "info" };
    case "USER_REPORTED_SUBMISSION":
      return { key: "VERIFY_RECEIPT", titleZh: "上传回执并核对", hintZh: "核对通过后才算「已提交」。", tab: "progress", tone: "warn" };
    case "SUBMISSION_UNKNOWN":
      return { key: "RESOLVE_UNKNOWN", titleZh: "核查是否已提交", hintZh: "先查确认邮件或官方账户；不要换渠道重复提交。", tab: "progress", tone: "warn" };
    default:
      break;
  }
  if (hasFiles && (analysis === "NOT_STARTED" || analysis === "NEEDS_REVIEW" || analysis === "FAILED")) {
    return { key: "REVIEW_FILES", titleZh: "复核披露明细", hintZh: "确认抽取出的明细后再看分析结果。", tab: "analysis", tone: "warn" };
  }
  if (analysis === "COMPLETED") {
    return { key: "VIEW_ANALYSIS", titleZh: "查看分析结果", hintZh: "合计只覆盖已取得的记录，缺口见分析页。", tab: "analysis", tone: "good" };
  }
  if (SUBMITTED_LIKE.has(i.status)) {
    return { key: "WAIT_REPLY", titleZh: "等待机关回复", hintZh: "收到来信或文件时在「进度」登记、上传。", tab: "progress", tone: "neutral" };
  }
  return { key: "DONE", titleZh: "已结束", hintZh: "政府处理已结束；记录与文件保留。", tab: "progress", tone: "neutral" };
}

/** 需要到「设置」处理的就绪阻塞（申请人、机关规则、历史台账）——其余在申请卡本身补齐 */
export const SETUP_BLOCKER_CODES = new Set([
  "APPLICANT_MISSING",
  "APPLICANT_UNCONFIRMED",
  "APPLICANT_FIELD_MISSING",
  "RULE_MISSING",
  "RULE_UNVERIFIED",
  "FEE_UNKNOWN",
  "PORTAL_UNVERIFIED",
  "SELF_SERVE_NOT_SUPPORTED",
  "LEDGER_UNVERIFIED",
]);
