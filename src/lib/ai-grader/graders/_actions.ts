/**
 * AI Grader 共享：suggestedActions 排序 / 去重 / internal note 构造。
 *
 * 统一排序优先级（避免微信端动作过多，可执行动作优先）：
 *   1. SUGGEST_STATUS_UPDATE
 *   2. CREATE_CALENDAR_REMINDER
 *   3. CREATE_PROJECT_TASK（已接入真实执行器）
 *   4. ADD_INTERNAL_NOTE
 *   5. 占位（CREATE_EMAIL_DRAFT）
 *
 * 约束：Top N 内最多 1 个 ADD_INTERNAL_NOTE。
 * 说明：calendar reminder / project task 都先于 internal note，
 *       因此「calendar + project task」都存在时，internal note 落到第 3 位或被截断。
 */

import type { GraderAction, RiskLevel } from "../types";

const ACTION_PRIORITY: Record<GraderAction["actionType"], number> = {
  SUGGEST_STATUS_UPDATE: 0,
  CREATE_CALENDAR_REMINDER: 1,
  CREATE_PROJECT_TASK: 2,
  ADD_INTERNAL_NOTE: 3,
  CREATE_EMAIL_DRAFT: 4,
};

/**
 * 按优先级稳定排序并截断到 max；保证最多 1 个 ADD_INTERNAL_NOTE。
 * - 无可执行 follow-up / reminder 时，internal note 自然排到前面
 * - 已有 follow-up + reminder 时，internal note 落到第 3 位（或被截断）
 */
export function orderAndCapActions(
  actions: GraderAction[],
  max: number,
): GraderAction[] {
  const sorted = [...actions].sort(
    (a, b) => (ACTION_PRIORITY[a.actionType] ?? 9) - (ACTION_PRIORITY[b.actionType] ?? 9),
  );
  const out: GraderAction[] = [];
  let noteUsed = false;
  for (const a of sorted) {
    if (out.length >= max) break;
    if (a.actionType === "ADD_INTERNAL_NOTE") {
      if (noteUsed) continue;
      noteUsed = true;
    }
    out.push(a);
  }
  return out;
}

/**
 * 构造一个 ADD_INTERNAL_NOTE GraderAction（payload 为扁平结构，供适配器读取）。
 * 必须有 opportunityId 或 customerId，否则返回 null（不生成）。
 * 优先 targetType=OPPORTUNITY，其次 CUSTOMER。
 */
export function buildInternalNoteAction(params: {
  graderType: "DAILY_BRIEF" | "CUSTOMER_FOLLOWUP" | "QUOTE_RISK" | "PROJECT_HEALTH";
  label: string;
  noteText: string;
  reason: string;
  issueCategory: string;
  issueSeverity: RiskLevel;
  opportunityId?: string | null;
  customerId?: string | null;
}): GraderAction | null {
  const targetType = params.opportunityId
    ? "OPPORTUNITY"
    : params.customerId
      ? "CUSTOMER"
      : null;
  const targetId = params.opportunityId ?? params.customerId ?? null;
  if (!targetType || !targetId) return null;

  return {
    actionType: "ADD_INTERNAL_NOTE",
    label: params.label,
    description: params.noteText,
    requiresApproval: true,
    payload: {
      targetType,
      targetId,
      note: params.noteText,
      reason: params.reason,
      source: "GRADER",
      graderType: params.graderType,
      issueCategory: params.issueCategory,
      issueSeverity: params.issueSeverity,
      opportunityId: params.opportunityId ?? undefined,
      customerId: params.customerId ?? undefined,
    },
  };
}

/**
 * 构造一个 PROJECT 维度的 ADD_INTERNAL_NOTE GraderAction（targetType=PROJECT）。
 * 用于把项目高风险沉淀到项目讨论流 / timeline。
 */
export function buildProjectInternalNoteAction(params: {
  projectId: string;
  projectName: string;
  noteText: string;
  reason: string;
  issueCategory: string;
  issueSeverity: RiskLevel;
}): GraderAction {
  return {
    actionType: "ADD_INTERNAL_NOTE",
    label: `记录 ${params.projectName} 项目风险`,
    description: params.noteText,
    requiresApproval: true,
    payload: {
      targetType: "PROJECT",
      targetId: params.projectId,
      note: params.noteText,
      reason: params.reason,
      source: "GRADER",
      graderType: "PROJECT_HEALTH",
      issueCategory: params.issueCategory,
      issueSeverity: params.issueSeverity,
      projectId: params.projectId,
    },
  };
}

/** 从 scanSalesDomain 风格标题中提取客户名（形如「跟进逾期 2 天：Lucas」取末段） */
export function extractNameFromTitle(title: string): string {
  if (!title.includes("：")) return "";
  return title.split("：").pop()?.trim() ?? "";
}
