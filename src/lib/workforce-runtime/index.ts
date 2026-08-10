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
