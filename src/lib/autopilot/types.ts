/**
 * Qingyan Autopilot A0 — canonical types.
 *
 * A0 只建立标准与观察基础设施，不引入 Evaluator / Monitor / Optimizer，
 * 也不自动判断 Failure Type（确定性系统错误除外）。
 */

export const AUTOPILOT_PHASE = "A0_FOUNDATION" as const;
export const AUTOPILOT_MODE = "OBSERVE_INFRASTRUCTURE_ONLY" as const;

/**
 * A1-P3 read-only Observe surface. Does not replace AUTOPILOT_PHASE history.
 * Observe still answers WHAT HAPPENED? only.
 */
export const AUTOPILOT_OBSERVE_SURFACE = "A1_P3_OBSERVE_DASHBOARD" as const;

/**
 * A2-P0 deterministic Evaluate surface.
 * Answers WAS IT GOOD? only with rule-based outcomes.
 * Does not authorize LLM Judge, Monitor Agent, Optimizer, Issues, or Production activation.
 */
export const AUTOPILOT_EVALUATE_SURFACE = "A2_P0_DETERMINISTIC_EVALUATE" as const;

export const AUTOPILOT_DISABLED_CAPABILITIES = {
  autoOptimization: "DISABLED",
  autoDeployment: "DISABLED",
  /** LLM / AI Judge — still off in A2-P0. Deterministic rules are not this flag. */
  aiEvaluator: "DISABLED",
  monitorAgent: "DISABLED",
} as const;

/**
 * A1 mandatory gate history / closure state.
 * CLOSED 不授权 Production capture、processor 或 migration。
 *
 * A1-P1 Coverage 关闭 TELEMETRY_DURABILITY 后仍不授权 Production activation。
 * A1_FUTURE_RETENTION_WORK：Outbox / AutopilotRunEvent 留存策略延后，本阶段不自动删数据。
 *
 * Canonical Production Activation Order（只记录，本文件不执行）：
 * 1. Production migration
 * 2. Verify AutopilotTelemetryOutbox exists
 * 3. Enable AUTOPILOT_PROCESSOR_ENABLED
 * 4. Verify processor health
 * 5. Enable AUTOPILOT_TELEMETRY_CAPTURE_ENABLED
 *
 * NEVER ENABLE CAPTURE BEFORE OUTBOX MIGRATION EXISTS.
 * Capture=ON 且 Outbox 表不存在时，同事务 Outbox insert 失败会回滚 canonical AgentRunEvent。
 */
export const AUTOPILOT_PRODUCTION_ACTIVATION_ORDER = [
  "MIGRATE",
  "VERIFY_TABLE",
  "PROCESSOR_ON",
  "VERIFY_HEALTH",
  "CAPTURE_ON",
] as const;

export const AUTOPILOT_A1_MANDATORY_BLOCKERS = [
  {
    id: "TELEMETRY_DURABILITY",
    phase: "A1",
    status: "CLOSED",
    reason:
      "A1-P0 durable telemetry passed Lucas Final Review 2: transactional canonical-event + outbox capture, whole-transaction sequence retry, at-least-once idempotent projection, retry/backoff/dead-letter, lease reclaim with max-attempt recovery, cross-org isolation, persisted-error redaction, and isolated PostgreSQL E2E verified.",
  },
] as const;

/** A0 开放页面；其余仅类型预留，不实现功能 */
export const AUTOPILOT_A0_PATHS = {
  overview: "/ai/autopilot",
  runs: "/ai/autopilot/runs",
} as const;

export const AUTOPILOT_A2_PATHS = {
  evaluations: "/ai/autopilot/evaluations",
} as const;

export const AUTOPILOT_RESERVED_PATHS = {
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
 * A0/A2-P0 只允许确定性系统错误写入 failureType。
 * INTENT / HALLUCINATION / WRONG_TOOL 仍禁止猜测（留给未来 LLM Judge，本轮不做）。
 */
export type AutopilotFailureSource = "system" | "human_signal" | null;

export const AUTOPILOT_EVALUATOR_KIND = "deterministic" as const;
export const AUTOPILOT_EVALUATOR_VERSION = "a2p0-deterministic-v1" as const;

export type AutopilotEvaluateRuleId =
  | "HUMAN_OVERRIDE_PRESENT"
  | "RUNTIME_FAILED"
  | "RUNTIME_CANCELLED"
  | "NOT_JUDGED";

export type AutopilotTraceEventType =
  | "USER_INPUT"
  | "INTENT_RESOLVED"
  | "CONTEXT_LOAD_STARTED"
  | "CONTEXT_LOADED"
  | "CONTEXT_LOAD_FAILED"
  | "RETRIEVAL_STARTED"
  | "RETRIEVAL_COMPLETED"
  | "RETRIEVAL_FAILED"
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_COMPLETED"
  /** T5-P1.1：工具正常让出（预算用尽、已 checkpoint）——既非完成也非失败 */
  | "TOOL_CALL_YIELDED"
  | "TOOL_CALL_FAILED"
  | "MODEL_STARTED"
  | "MODEL_COMPLETED"
  | "MODEL_FAILED"
  | "AGENT_OUTPUT"
  | "HUMAN_EDIT"
  | "HUMAN_OVERRIDE"
  | "HUMAN_ACTION"
  | "HUMAN_ACTION_REQUESTED"
  | "RE_ASK_SIGNAL"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCELLED"
  | "UNKNOWN_EVENT";

export const AUTOPILOT_TRACE_EVENT_TYPES: readonly AutopilotTraceEventType[] = [
  "USER_INPUT",
  "INTENT_RESOLVED",
  "CONTEXT_LOAD_STARTED",
  "CONTEXT_LOADED",
  "CONTEXT_LOAD_FAILED",
  "RETRIEVAL_STARTED",
  "RETRIEVAL_COMPLETED",
  "RETRIEVAL_FAILED",
  "TOOL_CALL_STARTED",
  "TOOL_CALL_COMPLETED",
  "TOOL_CALL_YIELDED",
  "TOOL_CALL_FAILED",
  "MODEL_STARTED",
  "MODEL_COMPLETED",
  "MODEL_FAILED",
  "AGENT_OUTPUT",
  "HUMAN_EDIT",
  "HUMAN_OVERRIDE",
  "HUMAN_ACTION",
  "HUMAN_ACTION_REQUESTED",
  "RE_ASK_SIGNAL",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "UNKNOWN_EVENT",
] as const;

/** A1 future work: AutopilotRunEvent / Outbox retention. Do not auto-delete in A1-P1. */
export const A1_FUTURE_RETENTION_WORK =
  "Retention/sampling deferred until Production volume is observed. No cleanup job in A1-P1.";

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
