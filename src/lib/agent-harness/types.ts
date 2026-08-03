/**
 * Agent Harness Adapter — 标准输入/输出契约
 *
 * 本轮只包装现有 agent-core OpenAI 路径，不接入 Claude/Codex/本地模型。
 */

import type { ScopeContext } from "@/lib/scope";
import type {
  AgentRunOptions,
  AgentRunResult,
  CoreMessage,
  ToolRisk,
} from "@/lib/agent-core/types";

export type HarnessApprovalPolicy = {
  /** 超过该风险必须走 PendingAction（不直写） */
  maxDirectRisk: ToolRisk;
  /** 强制进入审批的工具名 */
  forceApprovalTools?: string[];
};

export type HarnessExecutionLimits = {
  maxToolRounds?: number;
  perRoundTimeoutMs?: number;
  totalTimeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
};

export type HarnessModelConfig = {
  mode?: AgentRunOptions["mode"];
  model?: string;
  reasoningEffort?: AgentRunOptions["reasoningEffort"];
  provider?: "openai";
};

export type HarnessInput = {
  scope: ScopeContext;
  messages: CoreMessage[];
  systemPrompt: string;
  /** 服务端计算的工具允许列表；空数组表示不允许任何工具 */
  allowedTools: string[];
  approvalPolicy: HarnessApprovalPolicy;
  model: HarnessModelConfig;
  limits?: HarnessExecutionLimits;
  agentRunId?: string;
  sessionId?: string;
  modulesJson?: unknown;
  /** 角色/数字员工定义摘要（仅 instruction 差异，不复制 Runtime） */
  agentRoleDefinition?: {
    key?: string;
    displayName?: string;
    instructions?: string;
  };
};

export type HarnessPendingActionProposal = {
  type: string;
  title: string;
  preview: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
};

export type HarnessErrorClass =
  | "none"
  | "scope_denied"
  | "tool_denied"
  | "provider_error"
  | "timeout"
  | "aborted"
  | "unknown";

export type HarnessOutput = {
  ok: boolean;
  structuredResult: {
    content: string;
    rounds: number;
  };
  requestedToolCalls: AgentRunResult["toolCalls"];
  deniedTools: { name: string; reason: string }[];
  pendingActionProposals: HarnessPendingActionProposal[];
  model: string;
  provider: "openai";
  tokenUsage?: { prompt?: number; completion?: number; total?: number };
  cost?: number | null;
  latencyMs: number;
  finishReason: "completed" | "timeout" | "error" | "aborted" | "flag_disabled";
  correlationId: string;
  causationId?: string;
  errorClass: HarnessErrorClass;
  errorMessage?: string;
  /** 透传底层结果（兼容旧调用方） */
  legacy?: AgentRunResult;
};
