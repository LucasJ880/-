/**
 * Qingyan Autopilot A0 — canonical types.
 *
 * A0 只建立标准与观察基础设施，不引入 Evaluator / Monitor / Optimizer，
 * 也不自动判断 Failure Type（确定性系统错误除外）。
 */

export const AUTOPILOT_PHASE = "A0_FOUNDATION" as const;
export const AUTOPILOT_MODE = "OBSERVE_INFRASTRUCTURE_ONLY" as const;

export const AUTOPILOT_DISABLED_CAPABILITIES = {
  autoOptimization: "DISABLED",
  autoDeployment: "DISABLED",
  aiEvaluator: "DISABLED",
  monitorAgent: "DISABLED",
} as const;

/**
 * A0 不改 telemetry 持久化模型：写入保持 fire-and-forget。
 * A1 开始 Observe 完整性之前，必须先解决 serverless freeze 丢事件问题。
 */
export const AUTOPILOT_A1_MANDATORY_BLOCKERS = [
  {
    id: "TELEMETRY_DURABILITY",
    phase: "A1",
    status: "BLOCKER",
    reason:
      "A0 persist is fire-and-forget; serverless freeze can drop Observe events. A1 must add a durable outbox/queue before Observe completeness.",
  },
] as const;

/** A0 开放页面；其余仅类型预留，不实现功能 */
export const AUTOPILOT_A0_PATHS = {
  overview: "/ai/autopilot",
  runs: "/ai/autopilot/runs",
} as const;

export const AUTOPILOT_RESERVED_PATHS = {
  evaluations: "/ai/autopilot/evaluations",
  issues: "/ai/autopilot/issues",
  optimizations: "/ai/autopilot/optimizations",
  experiments: "/ai/autopilot/experiments",
  releases: "/ai/autopilot/releases",
  policies: "/ai/autopilot/policies",
} as const;

export type AutopilotCapability =
  | "autopilot.view"
  | "autopilot.runs.read"
  | "autopilot.admin";

export const AUTOPILOT_CAPABILITIES: readonly AutopilotCapability[] = [
  "autopilot.view",
  "autopilot.runs.read",
  "autopilot.admin",
] as const;

export type AutopilotOutcome =
  | "TASK_SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILURE"
  | "ABANDONED"
  | "HUMAN_OVERRIDE"
  | "UNKNOWN";

export const AUTOPILOT_OUTCOMES: readonly AutopilotOutcome[] = [
  "TASK_SUCCESS",
  "PARTIAL_SUCCESS",
  "FAILURE",
  "ABANDONED",
  "HUMAN_OVERRIDE",
  "UNKNOWN",
] as const;

export type AutopilotFailureType =
  | "INTENT_ERROR"
  | "CONTEXT_MISSING"
  | "RETRIEVAL_FAILURE"
  | "WRONG_TOOL"
  | "TOOL_FAILURE"
  | "REASONING_ERROR"
  | "HALLUCINATION"
  | "PERMISSION_ERROR"
  | "WORKFLOW_ERROR"
  | "LATENCY_ERROR"
  | "USER_INPUT_AMBIGUOUS"
  | "EXTERNAL_SERVICE_FAILURE"
  | "UNKNOWN";

export const AUTOPILOT_FAILURE_TYPES: readonly AutopilotFailureType[] = [
  "INTENT_ERROR",
  "CONTEXT_MISSING",
  "RETRIEVAL_FAILURE",
  "WRONG_TOOL",
  "TOOL_FAILURE",
  "REASONING_ERROR",
  "HALLUCINATION",
  "PERMISSION_ERROR",
  "WORKFLOW_ERROR",
  "LATENCY_ERROR",
  "USER_INPUT_AMBIGUOUS",
  "EXTERNAL_SERVICE_FAILURE",
  "UNKNOWN",
] as const;

/**
 * A0 只允许确定性系统错误写入 failureType。
 * INTENT / HALLUCINATION / WRONG_TOOL 等需 A2 Evaluator，禁止本阶段猜测。
 */
export type AutopilotFailureSource = "system" | null;

export type AutopilotTraceEventType =
  | "USER_INPUT"
  | "INTENT_RESOLVED"
  | "CONTEXT_LOADED"
  | "RETRIEVAL_STARTED"
  | "RETRIEVAL_COMPLETED"
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_COMPLETED"
  | "TOOL_CALL_FAILED"
  | "MODEL_STARTED"
  | "MODEL_COMPLETED"
  | "AGENT_OUTPUT"
  | "HUMAN_EDIT"
  | "HUMAN_OVERRIDE"
  | "HUMAN_ACTION"
  | "RE_ASK_SIGNAL"
  | "TASK_COMPLETED"
  | "TASK_FAILED";

export const AUTOPILOT_TRACE_EVENT_TYPES: readonly AutopilotTraceEventType[] = [
  "USER_INPUT",
  "INTENT_RESOLVED",
  "CONTEXT_LOADED",
  "RETRIEVAL_STARTED",
  "RETRIEVAL_COMPLETED",
  "TOOL_CALL_STARTED",
  "TOOL_CALL_COMPLETED",
  "TOOL_CALL_FAILED",
  "MODEL_STARTED",
  "MODEL_COMPLETED",
  "AGENT_OUTPUT",
  "HUMAN_EDIT",
  "HUMAN_OVERRIDE",
  "HUMAN_ACTION",
  "RE_ASK_SIGNAL",
  "TASK_COMPLETED",
  "TASK_FAILED",
] as const;

/** A0 不跑语义 Re-Ask Detector，只保留接口 */
export type AutopilotReAskStatus =
  | "NOT_EVALUATED"
  | "CANDIDATE"
  | "CONFIRMED"
  | "REJECTED";

export type AutopilotContentRef = {
  kind: "reference";
  id?: string;
  hash?: string;
  summary?: string;
  bytes?: number;
};

export type AutopilotTokenUsage = {
  prompt?: number;
  completion?: number;
  total?: number;
};

export type AutopilotHumanEdit = {
  originalOutputRef: AutopilotContentRef | null;
  humanEditedOutputRef: AutopilotContentRef | null;
  diffMeta: {
    changed: boolean;
    changeCount?: number;
    sourceVersionId?: string;
  } | null;
};

export type AutopilotHumanOverride = {
  override: boolean;
  agentRecommendation: unknown;
  humanDecision: unknown;
};

export type AutopilotMetricKey =
  | "runCount"
  | "taskSuccessRate"
  | "partialSuccessRate"
  | "failureRate"
  | "humanOverrideRate"
  | "humanEditRate"
  | "reAskRate"
  | "toolFailureRate"
  | "retrievalFailureRate"
  | "avgLatency"
  | "p50Latency"
  | "p95Latency"
  | "tokenUsage"
  | "estimatedCost";

export type AutopilotMetricAvailability =
  | { available: true; value: number }
  | { available: false; reason: "DATA NOT AVAILABLE YET" };

export type AutopilotAccessDecision = {
  allowed: boolean;
  reason:
    | "OK"
    | "FLAG_DISABLED"
    | "NOT_OWNER"
    | "UNKNOWN_CAPABILITY"
    | "UNAUTHENTICATED";
  capability: AutopilotCapability | null;
};

export type AutopilotAccessContext = {
  userId: string;
  role: string;
  orgId: string;
  capability: AutopilotCapability;
};
