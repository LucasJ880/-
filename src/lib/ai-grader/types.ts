/**
 * 轻量 Grader 统一输出结构（微信 AI 分身优化阶段 · 第一阶段）
 *
 * 目标：让微信 AI 不只是聊天，而是能主动「诊断业务风险 → 给出建议动作 → 在用户确认后执行低风险动作」。
 *
 * 设计约束（第一阶段）：
 * - 只定义类型，不引入任何数据库表 / 重型 workflow 框架。
 * - GraderResult 是「诊断结果」的统一载体，可由不同 grader（销售/项目/外贸…）产出。
 * - suggestedActions 仅为「建议」，真正落库执行仍走现有 PendingAction 审批链路
 *   （见 src/lib/pending-actions/*）。本文件不负责执行副作用。
 */

/** 风险等级（从低到高） */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** 诊断出的单条问题 / 风险点 */
export type GraderIssue = {
  severity: RiskLevel;
  /** 问题分类，如 "followup_overdue" / "quote_no_response" / "stage_stuck" */
  category: string;
  /** 一句话标题（用户可读） */
  title: string;
  /** 详细说明 */
  description: string;
  /** 可选：支撑该问题的证据原文 / 数据片段 */
  evidence?: string;
};

/** 建议动作 —— 仅为建议，执行需经现有审批链路 */
export type GraderAction = {
  actionType:
    | "CREATE_EMAIL_DRAFT"
    | "CREATE_CALENDAR_REMINDER"
    | "CREATE_PROJECT_TASK"
    | "ADD_INTERNAL_NOTE"
    | "SUGGEST_STATUS_UPDATE";
  /** 按钮 / 选项文案（用户可读） */
  label: string;
  /** 动作详细说明 */
  description: string;
  /** 是否需要用户确认后才能执行（低风险动作可为 false，但默认建议 true） */
  requiresApproval: boolean;
  /** 执行该动作所需的结构化参数（透传给 PendingAction.payload 等） */
  payload?: Record<string, unknown>;
};

/** 诊断依据的证据 —— 指向某条业务数据 */
export type GraderEvidence = {
  sourceType: "CUSTOMER" | "PROJECT" | "QUOTE" | "EMAIL" | "CALENDAR" | "TASK";
  /** 对应业务实体 ID（如 SalesCustomer.id / SalesQuote.id），可为空 */
  sourceId?: string;
  /** 证据文本说明 */
  text: string;
};

/** Grader 统一输出 */
export type GraderResult = {
  /** 综合健康度评分（0-100，越高越健康） */
  score: number;
  /** 综合风险等级 */
  riskLevel: RiskLevel;
  /** 一句话总结 */
  summary: string;
  /** 诊断出的问题列表 */
  issues: GraderIssue[];
  /** 建议动作列表 */
  suggestedActions: GraderAction[];
  /** 支撑诊断的证据列表 */
  evidence: GraderEvidence[];
};
