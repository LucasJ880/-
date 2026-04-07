/**
 * 子智能体委派系统 — 核心类型定义
 */

// ── 任务状态（12 态状态机） ──────────────────────────────────────

export type TaskStatus =
  | "draft"
  | "queued"
  | "running"
  | "waiting_for_subagent"
  | "waiting_for_tool"
  | "waiting_for_approval"
  | "approved"
  | "rejected"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

// ── 风险等级 ─────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

// ── 授权等级 ─────────────────────────────────────────────────────

export type ApprovalLevel = "auto" | "confirm" | "authorize";

// ── 触发类型 ─────────────────────────────────────────────────────

export type TriggerType = "manual" | "chat" | "event" | "cron";

// ── 业务域 ───────────────────────────────────────────────────────

export type SkillDomain =
  | "project"
  | "inquiry"
  | "quote"
  | "email"
  | "report"
  | "risk"
  | "analysis"
  | "execution";

// ── 能力层级 ─────────────────────────────────────────────────────

export type SkillTier = "foundation" | "analysis" | "execution";

// ── 技能定义 ─────────────────────────────────────────────────────

export interface SkillDefinition {
  id: string;
  name: string;
  domain: SkillDomain;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  execute: (ctx: SkillContext) => Promise<SkillResult>;

  // v2 字段
  tier?: SkillTier;
  version?: string;
  actions?: string[];
  inputSchema?: Record<string, string>;
  outputSchema?: Record<string, string>;
  dependsOn?: string[];
  expertRoleId?: string;
}

// ── 技能执行上下文 ───────────────────────────────────────────────

export interface SkillContext {
  projectId: string;
  userId: string;
  taskId: string;
  stepId: string;
  input: Record<string, unknown>;
}

// ── 技能执行结果 ─────────────────────────────────────────────────

export interface SkillResult {
  success: boolean;
  data: Record<string, unknown>;
  summary: string;
  error?: string;
  checkReport?: CheckReport;
}

// ── 审查报告 ─────────────────────────────────────────────────────

export interface CheckReport {
  passed: boolean;
  score: number;
  issues: CheckIssue[];
  blockers: CheckIssue[];
}

export interface CheckIssue {
  level: "info" | "warning" | "urgent";
  message: string;
  suggestion?: string;
}

// ── 工具网关 ─────────────────────────────────────────────────────

export interface ToolCall {
  toolName: string;
  params: Record<string, unknown>;
  taskId: string;
  stepId: string;
  userId: string;
  idempotencyKey: string;
}

export interface ToolResult {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
}

// ── 步骤模板（用于预置流程 & Orchestrator 输出） ─────────────────

export interface StepTemplate {
  skillId: string;
  title: string;
  description?: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  inputMapping?: Record<string, string>;
}

// ── 流程模板 ─────────────────────────────────────────────────────

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  taskType: string;
  matchKeywords: string[];
  steps: StepTemplate[];
}

// ── 审批决策 ─────────────────────────────────────────────────────

export type ApprovalDecision = "approved" | "rejected" | "skipped";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "escalated";

// ── 步骤状态 ─────────────────────────────────────────────────────

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed"
  | "skipped";
