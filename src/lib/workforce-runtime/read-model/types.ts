/**
 * Workforce Job Read Model — 契约类型（Lane D / P1-P2）
 *
 * 依据已归档设计：
 * - docs/QINGYAN_WORKFORCE_OBSERVABILITY_JOB_TIMELINE_DESIGN.md（§4/§5/§9/§23）
 * - docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md（worker/taskKind 前向兼容）
 * - docs/QINGYAN_WORKFORCE_PHASE2C_CHECKPOINT_HUMAN_RESUME_DESIGN.md（humanRequirement 词汇）
 *
 * 性质：**derived projection（只读投影）**，不是新的 source of truth。
 * 事实源只有五个现有模型：AgentRun / AgentRunStep / AgentRunEvent /
 * PendingAction（/ planJson 内嵌于 AgentRun）。零 schema 变更，零写入。
 *
 * 兼容边界：
 * - Phase 2B-1（worker/taskKind）尚未合并——`workerKey` / `taskKind` 必须
 *   允许 undefined，Read Model 不得假设它们存在；
 * - 未来 2B-2 并行——`currentTasks` 从现在起就是数组（0 / 1 / N）；
 * - legacy / 2A / 2C-1 Job——未知事件类型 fail-closed 不进用户 timeline，
 *   未知等待原因 fail-safe 显示 UNKNOWN_HUMAN_INTERVENTION。
 */

/** 用户面七态（设计 §5 冻结词汇；不暴露内部 v2 状态机） */
export type WorkforceUserJobStatus =
  | "QUEUED"
  | "WORKING"
  | "NEEDS_YOU"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

/**
 * Needs You 类型词汇（2C 设计 §3 + runtime 实际写入的
 * `job.waiting_human` payload.humanRequirement.type）。
 * 未知原因 fail-safe 落 UNKNOWN_HUMAN_INTERVENTION，绝不静默丢弃。
 */
export type WorkforceNeedsYouType =
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "PERMISSION_CHANGED"
  | "CLARIFICATION_REQUIRED"
  | "CONFLICT_REQUIRES_HUMAN"
  | "UNKNOWN_HUMAN_INTERVENTION";

export type WorkforceNeedsYouView = {
  type: WorkforceNeedsYouType;
  /** 确定性字典文案（不是 LLM/自由文本） */
  title: string;
  /**
   * 结构化补充：clarification 问题原文 / 待审批动作标题等
   * （只来自结构化字段，永不解析自由文本、永不透出内部 errorMessage 堆栈）
   */
  detail?: string;
  /** 关联的 PendingAction（审批类：pending 集合；拒绝类：rejected 集合） */
  pendingActionIds?: string[];
};

/**
 * Progress 全部来自 AgentRunStep 计数（deterministic），
 * 永不使用 LLM 估算百分比。percent 如需展示由消费方从计数推导。
 */
export type WorkforceJobProgress = {
  totalTasks: number;
  /** 终态成功集合：completed / skipped / partially_executed（设计 §6：skipped 计入分子） */
  completedTasks: number;
  /** 进行中集合：running / awaiting_approval */
  activeTasks: number;
  /** 受阻集合：blocked（依赖不可满足）/ failed（终态失败，阻塞下游） */
  blockedTasks: number;
};

/**
 * Task 视图（最小字段，设计 §7/§9）。
 * status 透传 AgentRunStep.status（v2 步骤词汇表：pending/ready/running/
 * awaiting_approval/completed/partially_executed/failed/blocked/skipped）；
 * 透传而非映射——未知/未来值不丢失、不抛错（前向兼容）。
 */
export type WorkforceTaskView = {
  stepKey: string;
  title: string;
  status: string;
  /** Phase 2B-1 前恒为 undefined（inputJson.taskKind 落地后自动出现） */
  taskKind?: string;
  /** Phase 2B-1 前恒为 undefined（inputJson.worker.id 落地后自动出现）。
   *  仅执行身份标识——权限/scope/授权永不进入 Read Model（设计 §8/§9）。 */
  workerKey?: string;
  startedAt?: string;
  completedAt?: string;
};

/** 用户 timeline 类别（设计 §23 冻结映射的输出词汇） */
export type WorkforceTimelineKind =
  | "JOB_STARTED"
  | "PROGRESS"
  | "NEEDS_YOU"
  | "RESUMED"
  | "REPLANNED"
  | "BLOCKED"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

/**
 * 用户 timeline 条目。**永不携带原始 payload**——
 * lease token / fencing / correlation / 堆栈等内部细节被结构性排除；
 * 只透出白名单派生字段（needsYouType）。
 */
export type WorkforceTimelineItem = {
  /** AgentRunEvent.createdAt ISO */
  at: string;
  /** 同 run 内严格有序（@@unique([runId, sequence])），排序唯一依据 */
  sequence: number;
  kind: WorkforceTimelineKind;
  /** 原始 eventType（已过白名单，不含内部机制事件） */
  eventType: string;
  title: string | null;
  /** 仅 NEEDS_YOU 条目：结构化等待原因 */
  needsYouType?: WorkforceNeedsYouType;
};

/** 内部/Admin timeline 条目（includeInternal=true 才产出；API 本阶段不透出） */
export type WorkforceInternalTimelineItem = {
  at: string;
  sequence: number;
  eventType: string;
  title: string | null;
  visibleToUser: boolean;
  payload: unknown;
};

export type WorkforceBusinessRefType =
  | "workspace"
  | "project"
  | "customer"
  | "supplier"
  | "tender"
  | "order";

/** 业务归属引用（label JOIN 属 2D，本阶段只出 type+id） */
export type WorkforceBusinessRef = {
  type: WorkforceBusinessRefType;
  id: string;
};

/** 产品层稳定消费的 Job 视图（设计 §4 的 Lane D 最小化实例） */
export type WorkforceJobViewModel = {
  /** = root AgentRun.id = rootRunId = metadata.jobId（2A 冻结等式） */
  jobId: string;
  status: WorkforceUserJobStatus;
  /** planJson.objective 优先，否则 metadata.goal 截断（~80 字符） */
  title?: string;
  progress: WorkforceJobProgress;
  /** 0 / 1 / N 个进行中任务（2B-2 并行前向兼容：契约即数组） */
  currentTasks: WorkforceTaskView[];
  /** 全部任务（plan 顺序） */
  tasks: WorkforceTaskView[];
  needsYou?: WorkforceNeedsYouView;
  /** 用户层 timeline（visibleToUser ∩ 事件白名单，sequence ASC） */
  timeline: WorkforceTimelineItem[];
  businessRefs?: WorkforceBusinessRef[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** AgentRun.updatedAt（任何状态/租约写入都会推进） */
  lastActivityAt: string;
  /**
   * 最终结果摘要（2D-1）。唯一结构化来源 = 最新 user-visible
   * `job.completed` 事件 payload.summary（2B `aggregateJobResult` 落地后
   * 自动出现）。缺失即 undefined——UI 显示"尚未生成最终结果"。
   * `job.failed` 的 payload.report 结构性排除（可能承载内部错误原文）。
   */
  finalSummary?: string;
  /** 仅 includeInternal=true（Admin/Operator 层；默认绝不产出） */
  internalTimeline?: WorkforceInternalTimelineItem[];
};

/* ------------------------------------------------------------------ */
/* Job Center 列表（2D-1）——列表卡片的轻量投影                          */
/* ------------------------------------------------------------------ */

/**
 * 列表状态筛选（用户面词汇，设计 §18/§24）。
 * DB 层按 internal status 集合过滤（deterministic、分页安全），
 * 不做"先投影再过滤"（会破坏游标语义）。
 */
export type WorkforceJobStatusFilter =
  | "all"
  | "working"
  | "needs_you"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Job Card 所需字段的子集（设计 §24 Lite 投影）：
 * Title / Status / Progress / Current Task(s) / Last Activity / Needs You。
 * 不含 tasks 全量与 timeline（详情页专属），永不含 internalTimeline。
 */
export type WorkforceJobListItem = {
  jobId: string;
  status: WorkforceUserJobStatus;
  title?: string;
  progress: WorkforceJobProgress;
  currentTasks: WorkforceTaskView[];
  needsYou?: WorkforceNeedsYouView;
  businessRefs?: WorkforceBusinessRef[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt: string;
};

/* ------------------------------------------------------------------ */
/* 投影输入快照（Read Model 消费的最小行形状；由服务层查询或测试注入）   */
/* ------------------------------------------------------------------ */

export type WorkforceRunSnapshot = {
  id: string;
  orgId: string;
  runType: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  planJson: unknown;
  metadata: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkforceStepSnapshot = {
  id: string;
  stepKey: string;
  title: string;
  status: string;
  inputJson: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type WorkforceEventSnapshot = {
  sequence: number;
  eventType: string;
  title: string | null;
  payload: unknown;
  visibleToUser: boolean;
  createdAt: Date;
};

export type WorkforcePendingActionSnapshot = {
  id: string;
  status: string;
  title: string;
  createdAt: Date;
};
