/**
 * Agent Core — 统一类型定义
 *
 * 这是整个平台的 AI 工具和 Agent 统一类型系统。
 * 兼容 OpenAI function calling 格式，同时支持现有的伪协议。
 */

import type { PlatformRole } from "@/lib/rbac/roles";

// ── 工具风险分级 & 角色授权 ──────────────────────────────────────

/**
 * 工具风险分级（RBAC / 审批依据）
 * - l0_read           只读，无副作用
 * - l1_internal_write 内部写（对用户无感知，如写索引、写内部日志）
 * - l2_soft           软写（可撤回；草稿、状态推进等）
 * - l3_strong         强写（不可撤回；对外发邮件、支付等）
 */
export type ToolRisk = "l0_read" | "l1_internal_write" | "l2_soft" | "l3_strong";

/**
 * 允许调用该工具的平台角色列表，"*" 表示所有已认证用户。
 * 未声明 allowRoles 的工具在 registry 层默认视为 admin-only（安全默认）。
 */
export type ToolAllowRoles = readonly PlatformRole[] | "*";

// ── 工具定义 ─────────────────────────────────────────────────────

export interface ToolDefinition {
  /** 工具唯一 ID，如 "trade_list_campaigns" */
  name: string;
  /** 中文描述，供 LLM 理解 */
  description: string;
  /** 所属域 */
  domain: ToolDomain;
  /** JSON Schema 格式的参数定义 */
  parameters: ToolParameterSchema;
  /** 执行函数 */
  execute: (ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;

  // —— RBAC 扩展（PR1）——
  /** 风险等级（写工具 / 审批判定依据） */
  risk?: ToolRisk;
  /** 允许调用该工具的角色白名单；未声明视为 admin-only */
  allowRoles?: ToolAllowRoles;

  // —— 遗留字段（已废弃，保留兼容，不再被 registry 读取）——
  /** @deprecated 使用 risk 字段 */
  riskLevel?: "low" | "medium" | "high";
  /** @deprecated 使用 allowRoles 字段 */
  requiredRole?: string[];
}

export type ToolDomain =
  | "trade"
  | "sales"
  | "project"
  | "secretary"
  | "knowledge"
  | "cockpit"
  | "system";

export interface ToolPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

// ── 工具执行 ─────────────────────────────────────────────────────

export interface ToolExecutionContext {
  /** 工具参数（LLM 传入） */
  args: Record<string, unknown>;
  /** 当前用户 */
  userId: string;
  /** 组织 ID */
  orgId: string;
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 当前用户的平台角色（PR1：用于数据隔离 + 防御性权限校验） */
  role?: PlatformRole | string;
}

export interface ToolExecutionResult {
  success: boolean;
  data: unknown;
  error?: string;
}

// ── OpenAI function calling 兼容格式 ─────────────────────────────

export interface OpenAIToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

// ── Agent Core 消息格式 ──────────────────────────────────────────

export interface CoreMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** function calling 时的工具调用 */
  tool_calls?: CoreToolCall[];
  /** 工具结果回填时的 tool_call_id */
  tool_call_id?: string;
  name?: string;
}

export interface CoreToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ── Agent 运行选项 ───────────────────────────────────────────────

export interface AgentRunOptions {
  /** 可用工具集（按名称过滤，空则全部可用） */
  tools?: string[];
  /** 按域过滤可用工具 */
  domains?: ToolDomain[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 对话历史 */
  messages: CoreMessage[];
  /** 最大工具调用轮数（防无限循环） */
  maxToolRounds?: number;
  /** AI 模型模式 */
  mode?: "chat" | "normal" | "deep" | "fast";
  /** 温度 */
  temperature?: number;
  /** 运行上下文 */
  userId: string;
  orgId: string;
  sessionId?: string;
  /**
   * 当前用户平台角色（PR1 新增）
   * - 决定工具可见性（ToolRegistry.list 过滤）
   * - 决定数据可见范围（透传至 ToolExecutionContext）
   * - 未提供时默认按 "user" 处理（最低权限）
   */
  role?: PlatformRole | string;
  /**
   * 外部 AbortSignal（通常传入 NextRequest.signal）
   * 客户端断开时，正在进行的 OpenAI 调用会被立即中止，避免继续扣费。
   */
  abortSignal?: AbortSignal;
}

export interface AgentRunResult {
  /** 最终回复内容 */
  content: string;
  /** 执行过的工具调用记录 */
  toolCalls: {
    name: string;
    args: Record<string, unknown>;
    result: ToolExecutionResult;
  }[];
  /** 使用的模型 */
  model: string;
  /** 总轮数 */
  rounds: number;
}
