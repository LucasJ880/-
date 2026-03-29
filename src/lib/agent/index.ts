/**
 * 子智能体委派系统 — 统一入口
 */

// 类型
export type {
  TaskStatus,
  RiskLevel,
  ApprovalLevel,
  TriggerType,
  SkillDomain,
  SkillDefinition,
  SkillContext,
  SkillResult,
  CheckReport,
  CheckIssue,
  ToolCall,
  ToolResult,
  StepTemplate,
  FlowTemplate,
  ApprovalDecision,
  ApprovalStatus,
  StepStatus,
} from "./types";

// 常量
export {
  TASK_STATUSES,
  STEP_STATUSES,
  RISK_LEVELS,
  APPROVAL_LEVELS,
  TOOL_NAMES,
  TASK_TYPES,
} from "./constants";
export type { ToolName, TaskType } from "./constants";

// 技能注册表
export {
  getSkill,
  listSkills,
  getSkillsForOrchestrator,
  getSkillCount,
} from "./skills";
