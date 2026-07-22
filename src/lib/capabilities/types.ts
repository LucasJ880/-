/**
 * Phase 3A-1：统一执行投影类型（Read Model，非超级宽表）
 */

export type ExecutionType =
  | "AGENT"
  | "SUPERVISOR"
  | "WORKFLOW"
  | "SKILL"
  | "TOOL"
  | "MODEL"
  | "APPROVAL";

export type ExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "PARTIAL";

/** Org Admin 对企业运行明细的可见性（默认 AGGREGATE_ONLY） */
export type RunVisibilityPolicy =
  | "AGGREGATE_ONLY"
  | "METADATA_ONLY"
  | "FULL";

export type ExecutionProjection = {
  id: string;
  executionType: ExecutionType;
  status: ExecutionStatus;
  capabilityKey: string | null;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
  userId: string | null;
  traceId: string | null;
  runId: string | null;
  parentRunId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  modelProvider: string | null;
  modelName: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  costAmount: number | null;
  currency: string | null;
  riskLevel: string | null;
  approvalRequired: boolean | null;
  errorCode: string | null;
  errorSummary: string | null;
  /** 是否含业务正文（受可见性策略裁剪） */
  hasBusinessPayload: boolean;
  inputSummary: string | null;
  outputSummary: string | null;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown> | null;
};

export type TraceTimelineItem = ExecutionProjection & {
  sequence: number | null;
  title: string | null;
  eventType: string | null;
};

export type TraceBundle = {
  orgId: string;
  traceId: string | null;
  rootRunId: string;
  visibility: RunVisibilityPolicy;
  items: TraceTimelineItem[];
  aggregate: {
    itemCount: number;
    succeeded: number;
    failed: number;
    waitingApproval: number;
    totalDurationMs: number | null;
  };
};

export type CapabilitiesAccessContext = {
  userId: string;
  orgId: string;
  orgRole: string;
  isPlatformAdmin: boolean;
  /** 当前用户在本 org 下的 Workspace 成员 id */
  workspaceIds: string[];
  /** 企业级运行可见性；默认 AGGREGATE_ONLY */
  runVisibility: RunVisibilityPolicy;
  /** 是否具备 OrganizationMember（平台 admin 无 membership 时为 false） */
  hasMembership: boolean;
};
