/**
 * Workforce Job Read Model（Lane D / P1-P2）— 公共出口
 *
 * 只读投影层：AgentRun / AgentRunStep / AgentRunEvent / PendingAction
 * → WorkforceJobViewModel。零 schema 变更、零写入、零 Runtime core 依赖。
 */

export type {
  WorkforceUserJobStatus,
  WorkforceNeedsYouType,
  WorkforceNeedsYouView,
  WorkforceJobProgress,
  WorkforceTaskView,
  WorkforceTimelineKind,
  WorkforceTimelineItem,
  WorkforceInternalTimelineItem,
  WorkforceBusinessRef,
  WorkforceBusinessRefType,
  WorkforceJobViewModel,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
  WorkforceEventSnapshot,
  WorkforcePendingActionSnapshot,
} from "./types";

export {
  projectJobStatus,
  projectProgress,
  projectTaskView,
  projectCurrentTasks,
  projectNeedsYou,
  projectTimeline,
  projectInternalTimeline,
  projectBusinessRefs,
  sortStepsByPlanOrder,
  buildWorkforceJobViewModel,
} from "./projection";

export {
  getWorkforceJobView,
  type GetWorkforceJobViewInput,
  type GetWorkforceJobViewResult,
  type WorkforceReadModelReader,
} from "./service";
