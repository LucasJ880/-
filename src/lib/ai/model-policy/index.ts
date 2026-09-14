export {
  isGpt6AstraEnabled,
  isGpt6AstraEnabledWithEnv,
  isGpt6WorkflowEnabledWithEnv,
  explainGpt6FlagWithEnv,
  describeGpt6Flag,
  gpt6WorkflowAllowlist,
  GPT6_PHASE1_WORKFLOWS,
  GPT6_QUALITY_FIRST_WORKFLOWS,
} from "./flags";
export type { Gpt6FlagInput, Gpt6FlagEnv, Gpt6FlagDecision } from "./flags";

export { MODEL_ROLES, ROLE_ENV_KEYS, GPT6_DEFAULT_ROLES, LOWER_COST_ROLES, QUALITY_FIRST_ROLES } from "./roles";
export type { ModelRole } from "./roles";

export {
  isGpt6Astra,
  isReasoningFamily,
  requiresResponsesApi,
  sanitizeReasoningEffort,
  gpt6UnsupportedChatParams,
} from "./compat";

export {
  reasoningBandForRole,
  reasoningBandForTenderStage,
  effortForBand,
  resolveReasoningPolicy,
  asLegacyReasoningEffort,
} from "./reasoning";
export type {
  ReasoningBand,
  ExtendedReasoningEffort,
  ReasoningPolicyInput,
  QualityMode,
  TenderStage,
} from "./reasoning";

export { classifyModelError, isRetryableModelError } from "./retry";
export type { ModelErrorClass } from "./retry";

export {
  MODEL_GUARDRAILS,
  capToolResultPayload,
  assertFiniteLoop,
} from "./guardrails";

export { resolveModelPolicy, getModelPolicySnapshot } from "./resolve";
export type { ResolveModelPolicyInput, ModelPolicyResolution } from "./resolve";

export {
  createTenderCompletion,
  createPinnedTenderInvoker,
  resolveTenderModelPolicy,
  isTenderFallbackAllowed,
  isTenderCostDowngradeReason,
  decideTenderRecovery,
  TENDER_WORKFLOW,
  TENDER_SUPERVISOR_STAGES,
  ANALYZED_WITH_FALLBACK_MODEL,
  TENDER_PRIMARY_WHEN_ENABLED,
  TENDER_FALLBACK_MODEL,
  tenderEntitlementLogFields,
} from "./tender";
export type {
  TenderCompletionResult,
  TenderModelPin,
  PinnedTenderInvoker,
  TenderSupervisorStage,
} from "./tender";
