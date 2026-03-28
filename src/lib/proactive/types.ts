/**
 * 主动触发系统 — 类型定义
 *
 * 青砚 AI 智能体第一步：让 AI 主动「看见」项目状态并给出建议。
 */

export type TriggerKind =
  | "deadline_approaching"    // 截止日逼近（7/3/1 天）
  | "stage_stalled"           // 项目阶段卡顿
  | "supplier_no_response"    // 供应商未回复
  | "tasks_overdue"           // 任务逾期
  | "missing_documents"       // 关键文档缺失
  | "risk_alert";             // 综合风险预警

export type TriggerSeverity = "info" | "warning" | "urgent";

export interface ProactiveSuggestion {
  id: string;
  projectId: string;
  projectName: string;
  kind: TriggerKind;
  severity: TriggerSeverity;
  title: string;
  description: string;
  /** 建议的动作 — 对应前端可一键执行的操作 */
  suggestedAction: SuggestedAction | null;
  /** 用于去重的唯一键 */
  dedupeKey: string;
  createdAt: string;
}

export type SuggestedActionType =
  | "send_followup_email"
  | "advance_stage"
  | "view_project"
  | "create_task"
  | "generate_summary";

export interface SuggestedAction {
  type: SuggestedActionType;
  label: string;
  /** 额外参数（如收件人、供应商 ID 等） */
  params?: Record<string, string>;
}

export interface ScanResult {
  scannedAt: string;
  projectCount: number;
  suggestions: ProactiveSuggestion[];
  autoActions?: AutoActionSummary[];
}

export interface AutoActionSummary {
  actionType: string;
  success: boolean;
  message: string;
  projectId?: string;
  createdEntityId?: string;
}

/**
 * 项目级自动化偏好 — 存储在 Project.metadata JSON 中
 * key: "automationPrefs"
 */
export interface ProjectAutomationPrefs {
  autoCreateTasks: boolean;
  autoGenerateSummary: boolean;
  autoFollowupDraft: boolean;
}
