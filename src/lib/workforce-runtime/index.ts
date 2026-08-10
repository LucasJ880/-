/**
 * Workforce Runtime Phase 2A — Job Lifecycle Foundation
 *
 * Job = root AgentRun（runType="workforce_job"）；Task = AgentRunStep；
 * Verification = AgentRunVerification；Human Intervention = PendingAction。
 * 不新增表 / 不新增第二套 queue、approval、RBAC、Runtime。
 */

export {
  WORKFORCE_JOB_RUN_TYPE,
  WORKFORCE_ACTIVE_STATUSES,
} from "./constants";
export {
  isWorkforceRuntimeEnabled,
  isWorkforceRuntimeEnabledWithEnv,
  isWorkforceProcessingEnabled,
  isWorkforceProcessingEnabledWithEnv,
  describeWorkforceFlag,
} from "./flags";
export { createWorkforceJob } from "./job";
export {
  processQueuedWorkforceJobs,
  processWorkforceJobSlice,
  WORKFORCE_LEASE_MS,
  WORKFORCE_MAX_ATTEMPTS,
  WORKFORCE_SLICE_BUDGET_MS,
} from "./processor";
export {
  resumeWorkforceJob,
  reconcileWorkforceRunsAfterApprovalExpiry,
  WORKFORCE_RESUMABLE_STATUSES,
  type WorkforceResumeTrigger,
  type WorkforceResumeResult,
} from "./resume";
// Phase 2B-1 — Task + Worker + Structured Handoff Foundation
export {
  WORKFORCE_WORKER_REGISTRY,
  listWorkforceWorkers,
  getWorkforceWorker,
  isKnownWorkforceWorker,
  defaultWorkerKeyForTaskKind,
  workerSupportsTaskKind,
  workforceWorkerRosterForPlanner,
  type WorkforceTaskKind,
  type WorkforceWorkerDefinition,
} from "./workers";
export {
  WORKFORCE_TASK_CONTRACT_VERSION,
  WorkforceTaskSpecV1Schema,
  applyWorkforceTaskSpecs,
  readWorkforceTaskSpec,
  type WorkforceTaskSpecV1,
  type WorkforcePlannedStep,
} from "./task-contract";
// P0 — Native Synthesis（Runtime 一等执行语义，非业务工具）
export {
  WORKFORCE_SYNTHESIS_EXECUTION_LABEL,
  WORKFORCE_SYNTHESIS_LIMITS,
  WorkforceSynthesisResultV1Schema,
  executeWorkforceSynthesisTask,
  buildBoundedSynthesisInput,
  type WorkforceSynthesisResultV1,
} from "./synthesis";
export {
  WORKFORCE_HANDOFF_CONTRACT_VERSION,
  WORKFORCE_HANDOFF_LIMITS,
  FORBIDDEN_HANDOFF_AUTH_FIELDS,
  HANDOFF_INTERNAL_CONTEXT_FIELDS,
  HANDOFF_TERMINAL_STEP_STATUSES,
  WorkforceHandoffPayloadV1Schema,
  parseWorkforceHandoff,
  extractHandoffFromStepOutput,
  buildWorkforceHandoffV1,
  collectUpstreamHandoffs,
  extractSynthesisHandoffSummary,
  type WorkforceHandoffPayloadV1,
  type WorkforceExecutionContext,
  type UpstreamHandoff,
  type HandoffFailureCode,
} from "./handoff";
