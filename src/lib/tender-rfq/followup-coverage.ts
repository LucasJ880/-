/**
 * RFQ-AUTO-1 跟进授权：构造、解析与覆盖判定（纯函数，零 DB、零 AI）
 *
 * 发询价的审批卡可以带一份跟进授权（TenderSendRfqPayload.followUpPolicy）。
 * 之后扫描要发催单 / 追问时，用 decideFollowUpCoverage 逐条检查这封邮件是否在授权之内：
 * 全部满足才自动执行；任何一条不满足都退回逐张人工批，并给出原因。
 * 输入全部由调用方查好传入，这里不读库。
 */
import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
import { CHASE_MAX, deadlinePassed, renderChaseTemplatePreviews } from "./chase-pure";
import type { RfqFollowUpPolicy, TenderSendChasePayload } from "./types";

export const FOLLOWUP_POLICY_VERSION = 1 as const;
/** 停止一轮自动跟进的审计动作（记录即状态） */
export const FOLLOWUP_STOP_AUDIT_ACTION = "tender.rfq_followup.stop" as const;
/** 每封自动发出的跟进的审计动作 */
export const FOLLOWUP_AUTO_SEND_AUDIT_ACTION = "tender.rfq_followup.auto_send" as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 建轮次时生成授权：次数与追问取允许的最大值；间隔与截止在此定格。 */
export function buildFollowUpPolicy(input: { chaseAfterDays: number; replyBy: string | null; templateHash: string; maxReminders?: number; allowMissingFieldQuestion?: boolean }): RfqFollowUpPolicy | null {
  return parseFollowUpPolicy({
    version: FOLLOWUP_POLICY_VERSION,
    maxReminders: input.maxReminders ?? CHASE_MAX,
    chaseAfterDays: input.chaseAfterDays,
    replyBy: input.replyBy,
    allowMissingFieldQuestion: input.allowMissingFieldQuestion ?? true,
    templateHash: input.templateHash,
  });
}

/** 严格解析：任何一项不合规 → null（当作没有授权）。 */
export function parseFollowUpPolicy(raw: unknown): RfqFollowUpPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.version !== FOLLOWUP_POLICY_VERSION) return null;
  if (p.maxReminders !== 0 && p.maxReminders !== 1 && p.maxReminders !== 2) return null;
  if (typeof p.chaseAfterDays !== "number" || !Number.isInteger(p.chaseAfterDays) || p.chaseAfterDays < 1 || p.chaseAfterDays > 60) return null;
  if (p.replyBy !== null && (typeof p.replyBy !== "string" || !YMD.test(p.replyBy) || Number.isNaN(new Date(`${p.replyBy}T00:00:00Z`).getTime()))) return null;
  if (typeof p.allowMissingFieldQuestion !== "boolean") return null;
  if (typeof p.templateHash !== "string" || !/^[0-9a-f]{16}$/.test(p.templateHash)) return null;
  return {
    version: FOLLOWUP_POLICY_VERSION,
    maxReminders: p.maxReminders,
    chaseAfterDays: p.chaseAfterDays,
    replyBy: p.replyBy as string | null,
    allowMissingFieldQuestion: p.allowMissingFieldQuestion,
    templateHash: p.templateHash,
  };
}

/** 卡片摘要里的一行，所有展示这张卡的界面共用。 */
export function followUpPolicySummaryZh(policy: RfqFollowUpPolicy): string {
  const scope = followUpPolicyScopeZh(policy);
  return scope ? `含自动跟进：${scope}。批准这张卡即一并批准这些后续邮件，可随时停止。` : "不含自动跟进。";
}

/** 只有范围（批准之后在轮次页上显示用，不带「批准这张卡」的说法）。 */
export function followUpPolicyScopeZh(policy: RfqFollowUpPolicy): string {
  const parts: string[] = [];
  if (policy.maxReminders > 0) parts.push(`催单最多 ${policy.maxReminders} 次（每隔 ${policy.chaseAfterDays} 天${policy.replyBy ? `，${policy.replyBy} 之后不再催` : ""}）`);
  if (policy.allowMissingFieldQuestion) parts.push("缺字段追问 1 次");
  return parts.join("、");
}

export const COVERAGE_REASONS = [
  "FLAG_OFF", "NO_ROUND_CARD", "NO_POLICY", "ROUND_CARD_NOT_EXECUTED", "NOT_HUMAN_APPROVED", "APPROVER_INACTIVE", "ROUND_NOT_IN_PROGRESS", "STOPPED",
  "PRIOR_ATTEMPT", "KIND_NOT_ALLOWED", "OVER_LIMIT", "DEADLINE_PASSED", "TEMPLATE_CHANGED", "RECIPIENT_CHANGED", "THREAD_MISSING", "SENSITIVE_TEXT",
] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

export const COVERAGE_REASON_ZH: Record<CoverageReason, string> = {
  FLAG_OFF: "自动跟进未开启",
  NO_ROUND_CARD: "找不到这一轮的发询价审批卡",
  NO_POLICY: "这一轮批准时没有带跟进授权",
  ROUND_CARD_NOT_EXECUTED: "这一轮的发询价卡还没有批准并发出",
  NOT_HUMAN_APPROVED: "这一轮的发询价卡不是由人批准的",
  APPROVER_INACTIVE: "批准这一轮的人已不是本组织的在职成员",
  ROUND_NOT_IN_PROGRESS: "轮次已取消或已完成",
  STOPPED: "这一轮已停止自动跟进",
  PRIOR_ATTEMPT: "这封邮件此前起草过（已过期或发送失败），需要人工确认",
  KIND_NOT_ALLOWED: "授权不包含这种邮件",
  OVER_LIMIT: "超过授权的催单次数",
  DEADLINE_PASSED: "回复截止已过",
  TEMPLATE_CHANGED: "催单模板在批准之后改过",
  RECIPIENT_CHANGED: "收件人与原询价邮件不一致",
  THREAD_MISSING: "原询价邮件线程缺失",
  SENSITIVE_TEXT: "正文含内部敏感字样",
};

export type CoverageRoundCard = {
  /** PendingAction.status */
  status: string;
  /** 批准人（PendingAction.decidedById）；系统批准或未批准 = null */
  decidedById: string | null;
  /** 载荷里的 followUpPolicy，原样传入（这里严格解析） */
  policy: unknown;
  /** 原询价邮件：每个询价项的收件人 */
  items: ReadonlyArray<{ inquiryItemId: string; to: string }>;
};

export type CoverageInput = {
  flagEnabled: boolean;
  roundCard: CoverageRoundCard | null;
  /** 批准人现在是否仍是本组织的在职成员 */
  approverActive: boolean;
  /** ProjectInquiry.status */
  inquiryStatus: string;
  /** 这一轮是否已停止自动跟进 */
  stopped: boolean;
  now: Date;
  /** 当前代码里的模板指纹 */
  currentTemplateHash: string;
  /** 这封邮件（同一家、同一序号）此前是否已经起草过——过期或失败后重起草的不自动发，免得发送失败时每次扫描都重试 */
  priorAttempt: boolean;
  chase: Pick<TenderSendChasePayload, "inquiryItemId" | "kind" | "chaseIndex" | "to" | "threadId" | "body">;
};

export type CoverageDecision =
  | { covered: true; approverUserId: string; policy: RfqFollowUpPolicy }
  | { covered: false; reason: CoverageReason; reasonZh: string };

const no = (reason: CoverageReason): CoverageDecision => ({ covered: false, reason, reasonZh: COVERAGE_REASON_ZH[reason] });
const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 这封催单 / 追问是否在该轮的跟进授权之内。确定性；检查顺序固定，返回第一条不满足的原因。 */
export function decideFollowUpCoverage(input: CoverageInput): CoverageDecision {
  if (!input.flagEnabled) return no("FLAG_OFF");
  const card = input.roundCard;
  if (!card) return no("NO_ROUND_CARD");
  const policy = parseFollowUpPolicy(card.policy);
  if (!policy) return no("NO_POLICY");
  if (card.status !== "executed") return no("ROUND_CARD_NOT_EXECUTED");
  if (!card.decidedById) return no("NOT_HUMAN_APPROVED");
  if (!input.approverActive) return no("APPROVER_INACTIVE");
  if (input.inquiryStatus !== "in_progress") return no("ROUND_NOT_IN_PROGRESS");
  if (input.stopped) return no("STOPPED");
  if (input.priorAttempt) return no("PRIOR_ATTEMPT");

  const { chase } = input;
  if (chase.kind === "no_reply") {
    if (policy.maxReminders === 0) return no("KIND_NOT_ALLOWED");
    if (chase.chaseIndex > policy.maxReminders) return no("OVER_LIMIT");
    if (policy.replyBy && deadlinePassed(new Date(`${policy.replyBy}T00:00:00Z`), input.now)) return no("DEADLINE_PASSED");
  } else if (chase.kind === "missing_fields") {
    if (!policy.allowMissingFieldQuestion) return no("KIND_NOT_ALLOWED");
    if (chase.chaseIndex !== 1) return no("OVER_LIMIT");
  } else {
    return no("KIND_NOT_ALLOWED");
  }

  if (policy.templateHash !== input.currentTemplateHash) return no("TEMPLATE_CHANGED");
  const original = card.items.find((i) => i.inquiryItemId === chase.inquiryItemId);
  if (!original || !original.to || !sameAddress(original.to, chase.to)) return no("RECIPIENT_CHANGED");
  if (!chase.threadId) return no("THREAD_MISSING");
  if (containsSensitiveSupplierBriefText(chase.body)) return no("SENSITIVE_TEXT");

  return { covered: true, approverUserId: card.decidedById, policy };
}

/* ---------------------------------- 轮次页的状态 ---------------------------------- */

/** 轮次层面的状态（不针对某一封）：给轮次页显示「生效中 / 已停止 / 未生效：原因」 */
export type RoundFollowUpDisplay =
  | { state: "none" }
  | { state: "active"; policy: RfqFollowUpPolicy; summaryZh: string }
  | { state: "stopped"; policy: RfqFollowUpPolicy; summaryZh: string }
  | { state: "inactive"; policy: RfqFollowUpPolicy; summaryZh: string; reason: CoverageReason; reasonZh: string };

/** 开关关闭或这一轮没带授权 → none（界面不显示任何自动跟进的内容）。 */
export function describeRoundFollowUp(input: Pick<CoverageInput, "flagEnabled" | "roundCard" | "approverActive" | "inquiryStatus" | "stopped">): RoundFollowUpDisplay {
  if (!input.flagEnabled || !input.roundCard) return { state: "none" };
  const policy = parseFollowUpPolicy(input.roundCard.policy);
  if (!policy) return { state: "none" };
  const summaryZh = `批准这一轮时授权的范围：${followUpPolicyScopeZh(policy)}。`;
  if (input.stopped) return { state: "stopped", policy, summaryZh };
  const inactive = (reason: CoverageReason): RoundFollowUpDisplay => ({ state: "inactive", policy, summaryZh, reason, reasonZh: COVERAGE_REASON_ZH[reason] });
  if (input.roundCard.status !== "executed") return inactive("ROUND_CARD_NOT_EXECUTED");
  if (!input.roundCard.decidedById) return inactive("NOT_HUMAN_APPROVED");
  if (!input.approverActive) return inactive("APPROVER_INACTIVE");
  if (input.inquiryStatus !== "in_progress") return inactive("ROUND_NOT_IN_PROGRESS");
  return { state: "active", policy, summaryZh };
}

/* ---------------------------------- 审批卡上展示的授权 ---------------------------------- */

/** 审批卡 / 建轮次表单上展示的授权：一行范围说明 + 授权之内的模板预览（只列授权包含的那几段）。 */
export type FollowUpCardView = {
  summaryZh: string;
  templates: Array<{ key: "reminder1" | "reminder2" | "missingFields"; labelZh: string; subject: string; body: string }>;
};

export const FOLLOWUP_PLACEHOLDER_SUPPLIER = "〔供应商名称〕";
export const FOLLOWUP_PLACEHOLDER_SUBJECT = "〔原询价主题〕";

export function followUpCardView(policy: RfqFollowUpPolicy, input: { fromName: string; now: Date }): FollowUpCardView {
  const p = renderChaseTemplatePreviews({ supplierName: FOLLOWUP_PLACEHOLDER_SUPPLIER, originalSubject: FOLLOWUP_PLACEHOLDER_SUBJECT, sentAt: input.now, replyBy: policy.replyBy, fromName: input.fromName });
  const templates: FollowUpCardView["templates"] = [];
  if (policy.maxReminders >= 1) templates.push({ key: "reminder1", labelZh: `第 1 次催单（发出 ${policy.chaseAfterDays} 天后仍未回复时）`, ...p.reminder1 });
  if (policy.maxReminders >= 2) templates.push({ key: "reminder2", labelZh: `第 2 次催单（再过 ${policy.chaseAfterDays} 天仍未回复时）`, ...p.reminder2 });
  if (policy.allowMissingFieldQuestion) templates.push({ key: "missingFields", labelZh: "缺字段追问（报价缺哪项问哪项，只在这六项里）", ...p.missingFields });
  return { summaryZh: followUpPolicySummaryZh(policy), templates };
}
