/**
 * 子智能体委派系统 — 常量定义
 */

import type {
  TaskStatus,
  RiskLevel,
  ApprovalLevel,
  StepStatus,
} from "./types";

// ── 任务状态 ─────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  color: string;
  terminal: boolean;
}

export const TASK_STATUSES: Record<TaskStatus, StatusMeta> = {
  draft:                 { label: "草稿",     color: "slate",  terminal: false },
  queued:                { label: "排队中",   color: "sky",    terminal: false },
  running:               { label: "运行中",   color: "blue",   terminal: false },
  waiting_for_subagent:  { label: "等待子智能体", color: "indigo", terminal: false },
  waiting_for_tool:      { label: "等待工具",   color: "violet", terminal: false },
  waiting_for_approval:  { label: "待审批",   color: "amber",  terminal: false },
  approved:              { label: "已批准",   color: "emerald", terminal: false },
  rejected:              { label: "已驳回",   color: "red",    terminal: false },
  paused:                { label: "已暂停",   color: "gray",   terminal: false },
  failed:                { label: "失败",     color: "red",    terminal: false },
  completed:             { label: "已完成",   color: "green",  terminal: true },
  cancelled:             { label: "已取消",   color: "gray",   terminal: true },
};

// ── 步骤状态 ─────────────────────────────────────────────────────

export const STEP_STATUSES: Record<StepStatus, StatusMeta> = {
  pending:          { label: "待执行",   color: "slate",   terminal: false },
  running:          { label: "执行中",   color: "blue",    terminal: false },
  waiting_approval: { label: "待审批",   color: "amber",   terminal: false },
  approved:         { label: "已批准",   color: "emerald", terminal: false },
  rejected:         { label: "已驳回",   color: "red",     terminal: true },
  completed:        { label: "已完成",   color: "green",   terminal: true },
  failed:           { label: "失败",     color: "red",     terminal: false },
  skipped:          { label: "已跳过",   color: "gray",    terminal: true },
};

// ── 风险等级 ─────────────────────────────────────────────────────

interface RiskMeta {
  label: string;
  color: string;
  approvalLevel: ApprovalLevel;
}

export const RISK_LEVELS: Record<RiskLevel, RiskMeta> = {
  low:    { label: "低风险", color: "green",  approvalLevel: "auto" },
  medium: { label: "中风险", color: "amber",  approvalLevel: "confirm" },
  high:   { label: "高风险", color: "red",    approvalLevel: "authorize" },
};

// ── 授权等级 ─────────────────────────────────────────────────────

interface ApprovalMeta {
  label: string;
  description: string;
}

export const APPROVAL_LEVELS: Record<ApprovalLevel, ApprovalMeta> = {
  auto:      { label: "自动执行", description: "低风险，无副作用或仅内部副作用" },
  confirm:   { label: "确认执行", description: "中风险，修改内部数据但不对外" },
  authorize: { label: "人工授权", description: "高风险，对外副作用或不可逆" },
};

// ── 工具名称 ─────────────────────────────────────────────────────

export const TOOL_NAMES = {
  WRITE_QUOTE: "write_quote",
  CREATE_TASK: "create_task",
  CREATE_NOTIFICATION: "create_notification",
  LOG_AUDIT: "log_audit",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ── 任务类型 ─────────────────────────────────────────────────────

export const TASK_TYPES = {
  BID_PREPARATION: "bid_preparation",
  PROJECT_INSPECTION: "project_inspection",
  INQUIRY_CYCLE: "inquiry_cycle",
  CUSTOM: "custom",
} as const;

export type TaskType = (typeof TASK_TYPES)[keyof typeof TASK_TYPES];
