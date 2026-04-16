/**
 * Agent Core — 统一类型定义
 *
 * 这是整个平台的 AI 工具和 Agent 统一类型系统。
 * 兼容 OpenAI function calling 格式，同时支持现有的伪协议。
 */

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
  /** 风险等级 — high 需用户确认 */
  riskLevel?: "low" | "medium" | "high";
  /** 需要的权限 */
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
