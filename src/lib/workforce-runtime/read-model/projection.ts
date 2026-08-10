/**
 * Workforce Job Read Model — 纯投影函数（零 I/O、零副作用）
 *
 * 每个函数都是 deterministic：同样的行快照 → 同样的视图。
 * 不调用 LLM、不读 DB、不写任何东西——服务层负责查询，本层只做推导。
 *
 * 设计依据（已归档，冻结）：
 * - 状态映射：Observability 设计 §5（QUEUED 只给"从未开始"的 Job；
 *   continuation/retry 回队对用户是连续的 WORKING）；
 * - Progress：§6（DB 计数，skipped 计入分子；永不 LLM 报数）；
 * - Current Task：§7（running 优先，无 running 取 awaiting_approval，数组契约）；
 * - Needs You：§9 + 2C §3（结构化 humanRequirement，fail-safe UNKNOWN）；
 * - Timeline：§3/§23（visibleToUser ∩ 事件类别白名单，未知类型 fail-closed；
 *   sequence ASC 排序，不依赖 createdAt 避免同毫秒乱序）。
 */

import type {
  WorkforceBusinessRef,
  WorkforceBusinessRefType,
  WorkforceEventSnapshot,
  WorkforceInternalTimelineItem,
  WorkforceJobProgress,
  WorkforceJobViewModel,
  WorkforceNeedsYouType,
  WorkforceNeedsYouView,
  WorkforcePendingActionSnapshot,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
  WorkforceTaskView,
  WorkforceTimelineItem,
  WorkforceTimelineKind,
  WorkforceUserJobStatus,
} from "./types";

/* ------------------------------------------------------------------ */
/* 小工具（内部）                                                       */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function iso(date: Date): string {
  return date.toISOString();
}

/* ------------------------------------------------------------------ */
/* §5 状态映射                                                          */
/* ------------------------------------------------------------------ */

const WORKING_STATUSES: ReadonlySet<string> = new Set([
  "planning",
  "planned",
  "executing",
  "verifying",
  "repairing",
  // v1 兼容词汇（workforce_job 恒为 v2，此处仅防御 legacy 数据）
  "running",
]);

const NEEDS_YOU_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_approval",
  "needs_human",
]);

/**
 * internal AgentRun.status → 用户面七态（设计 §5 完整映射）。
 *
 * `queued` 三分（全部来自现有列，deterministic）：
 * - 从未开始（无 plan、无 steps、无失败记录）→ QUEUED；
 * - retry 回队（attempts>0 ∧ errorCode≠null）→ WORKING（重试对用户静默）；
 * - continuation 回队（planJson 已存在 / 已有 steps）→ WORKING
 *   （slice 间隙不是"排队"，用户看到连续的 WORKING）。
 *
 * 未知状态 fail-safe：cancelledAt → CANCELLED；completedAt → FAILED
 * （未知终态按保守口径呈现，不谎报完成）；否则 WORKING（非终态假定）。
 */
export function projectJobStatus(
  run: Pick<
    WorkforceRunSnapshot,
    | "status"
    | "attempts"
    | "errorCode"
    | "planJson"
    | "completedAt"
    | "cancelledAt"
  >,
  steps: ReadonlyArray<Pick<WorkforceStepSnapshot, "status">>,
): WorkforceUserJobStatus {
  const status = run.status;

  if (status === "queued" || status === "acknowledged") {
    const retryRequeue = run.attempts > 0 && run.errorCode != null;
    const continuationRequeue = run.planJson != null || steps.length > 0;
    if (retryRequeue || continuationRequeue) return "WORKING";
    return "QUEUED";
  }
  if (WORKING_STATUSES.has(status)) return "WORKING";
  if (NEEDS_YOU_STATUSES.has(status)) return "NEEDS_YOU";
  if (status === "completed") return "COMPLETED";
  if (status === "partially_executed") return "PARTIAL";
  if (status === "failed") return "FAILED";
  if (status === "cancelled") return "CANCELLED";

  // 未知状态 fail-safe（文档化的保守口径）
  if (run.cancelledAt) return "CANCELLED";
  if (run.completedAt) return "FAILED";
  return "WORKING";
}

/* ------------------------------------------------------------------ */
/* §6 Progress（deterministic 计数）                                    */
/* ------------------------------------------------------------------ */

const COMPLETED_STEP_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "skipped",
  "partially_executed",
]);
const ACTIVE_STEP_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "awaiting_approval",
]);
const BLOCKED_STEP_STATUSES: ReadonlySet<string> = new Set([
  "blocked",
  "failed",
]);

export function projectProgress(
  steps: ReadonlyArray<Pick<WorkforceStepSnapshot, "status">>,
): WorkforceJobProgress {
  let completedTasks = 0;
  let activeTasks = 0;
  let blockedTasks = 0;
  for (const step of steps) {
    if (COMPLETED_STEP_STATUSES.has(step.status)) completedTasks++;
    else if (ACTIVE_STEP_STATUSES.has(step.status)) activeTasks++;
    else if (BLOCKED_STEP_STATUSES.has(step.status)) blockedTasks++;
  }
  return {
    totalTasks: steps.length,
    completedTasks,
    activeTasks,
    blockedTasks,
  };
}

/* ------------------------------------------------------------------ */
/* §7/§9 Task 视图                                                      */
/* ------------------------------------------------------------------ */

/**
 * 单步投影。workerKey / taskKind 来自 inputJson（2B-1 落地后自动出现），
 * 缺失即 undefined——Lane D 不阻塞、不假设 Lane A 已合并。
 * 只透出执行身份标识；权限/scope/白名单等授权语义结构性排除。
 */
export function projectTaskView(
  step: Pick<
    WorkforceStepSnapshot,
    "stepKey" | "title" | "status" | "inputJson" | "startedAt" | "completedAt"
  >,
): WorkforceTaskView {
  const input = asRecord(step.inputJson);
  const worker = asRecord(input.worker);
  const view: WorkforceTaskView = {
    stepKey: step.stepKey,
    title: step.title,
    status: step.status,
  };
  const taskKind = asString(input.taskKind) ?? asString(input.kind);
  if (taskKind) view.taskKind = taskKind;
  const workerKey = asString(worker.id) ?? asString(input.workerKey);
  if (workerKey) view.workerKey = workerKey;
  if (step.startedAt) view.startedAt = iso(step.startedAt);
  if (step.completedAt) view.completedAt = iso(step.completedAt);
  return view;
}

/** planJson.steps[].id 的顺序即计划顺序；不在计划中的步骤按 createdAt/id 追加尾部 */
export function sortStepsByPlanOrder<
  T extends Pick<WorkforceStepSnapshot, "stepKey" | "createdAt" | "id">,
>(planJson: unknown, steps: ReadonlyArray<T>): T[] {
  const plan = asRecord(planJson);
  const planSteps = Array.isArray(plan.steps) ? plan.steps : [];
  const orderByKey = new Map<string, number>();
  planSteps.forEach((s, index) => {
    const id = asString(asRecord(s).id);
    if (id && !orderByKey.has(id)) orderByKey.set(id, index);
  });
  return [...steps].sort((a, b) => {
    const ai = orderByKey.get(a.stepKey);
    const bi = orderByKey.get(b.stepKey);
    if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi;
    if (ai !== undefined && bi === undefined) return -1;
    if (ai === undefined && bi !== undefined) return 1;
    const at = a.createdAt.getTime();
    const bt = b.createdAt.getTime();
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Current tasks（设计 §7）：0 / 1 / N 个（2B-2 并行契约从现在生效）。
 * 1. 全部 running（startedAt 升序，最早开始的排前）；
 * 2. 无 running 时取 awaiting_approval（"卡在哪一步等你"）；
 * 3. 否则空数组（planning/verifying 等 run 级阶段不伪造 currentTask）。
 */
export function projectCurrentTasks(
  orderedSteps: ReadonlyArray<
    Pick<
      WorkforceStepSnapshot,
      "stepKey" | "title" | "status" | "inputJson" | "startedAt" | "completedAt"
    >
  >,
): WorkforceTaskView[] {
  const pick = (status: string) =>
    orderedSteps
      .filter((s) => s.status === status)
      .sort((a, b) => {
        const at = a.startedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bt = b.startedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return at - bt;
      })
      .map(projectTaskView);
  const running = pick("running");
  if (running.length > 0) return running;
  return pick("awaiting_approval");
}

/* ------------------------------------------------------------------ */
/* §9 Needs You                                                         */
/* ------------------------------------------------------------------ */

const KNOWN_NEEDS_YOU_TYPES: ReadonlySet<string> = new Set([
  "APPROVAL_REQUIRED",
  "APPROVAL_REJECTED",
  "PERMISSION_CHANGED",
  "CLARIFICATION_REQUIRED",
  "CONFLICT_REQUIRES_HUMAN",
]);

/** 确定性文案字典（不是 LLM；detail 只来自结构化字段） */
const NEEDS_YOU_TITLES: Record<WorkforceNeedsYouType, string> = {
  APPROVAL_REQUIRED: "等待你审批",
  APPROVAL_REJECTED: "审批被拒绝，需要你决定后续",
  PERMISSION_CHANGED: "权限或账号状态发生变化，需要确认",
  CLARIFICATION_REQUIRED: "需要补充信息后继续",
  CONFLICT_REQUIRES_HUMAN: "需要你裁决后继续",
  UNKNOWN_HUMAN_INTERVENTION: "需要人工处理",
};

/** run.errorCode → Needs You 类型（现有 errorCode 词汇，见 2C-1 实现与 AgentErrorCode） */
const ERROR_CODE_NEEDS_YOU: Record<string, WorkforceNeedsYouType> = {
  clarification_required: "CLARIFICATION_REQUIRED",
  approval_rejected: "APPROVAL_REJECTED",
  approval_expired: "APPROVAL_REQUIRED",
  // principal 失效码（resolveRuntimeV2Principal）
  INITIATOR_MISSING: "PERMISSION_CHANGED",
  USER_INACTIVE: "PERMISSION_CHANGED",
  NO_MEMBERSHIP: "PERMISSION_CHANGED",
  MEMBERSHIP_INACTIVE: "PERMISSION_CHANGED",
  // executor 鉴权类 AgentErrorCode
  org_forbidden: "PERMISSION_CHANGED",
  pending_forbidden: "PERMISSION_CHANGED",
  user_unbound: "PERMISSION_CHANGED",
};

type HumanRequirement = {
  type?: string;
  detail?: string;
  refs?: { pendingActionIds?: unknown };
};

function readHumanRequirement(payload: unknown): HumanRequirement | null {
  const p = asRecord(payload);
  const hr = asRecord(p.humanRequirement);
  if (Object.keys(hr).length === 0) return null;
  return {
    type: asString(hr.type),
    detail: asString(hr.detail),
    refs: asRecord(hr.refs) as { pendingActionIds?: unknown },
  };
}

function refActionIds(refs: { pendingActionIds?: unknown } | undefined): string[] {
  const ids = refs?.pendingActionIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Needs You 投影（设计 §9 + 2C §3）。仅在用户态为 NEEDS_YOU 时返回。
 *
 * 优先级（全部结构化，不解析自由文本）：
 * 1. 最新 user-visible `job.waiting_human` 事件的 payload.humanRequirement.type；
 * 2. run.errorCode 映射（clarification_required / approval_rejected /
 *    approval_expired / principal 失效码 / 鉴权类码）；
 * 3. open PendingAction 存在 → APPROVAL_REQUIRED；
 * 4. run.status=awaiting_approval → APPROVAL_REQUIRED（状态本身即语义）；
 * 5. fail-safe → UNKNOWN_HUMAN_INTERVENTION（未知原因也要显示，绝不静默）。
 */
export function projectNeedsYou(
  run: Pick<WorkforceRunSnapshot, "status" | "errorCode">,
  events: ReadonlyArray<WorkforceEventSnapshot>,
  pendingActions: ReadonlyArray<WorkforcePendingActionSnapshot>,
): WorkforceNeedsYouView | undefined {
  if (!NEEDS_YOU_STATUSES.has(run.status)) return undefined;

  const openActions = pendingActions.filter((a) => a.status === "pending");
  const rejectedActions = pendingActions.filter((a) => a.status === "rejected");

  // 1. 最新可见 waiting_human 事件（sequence 最大者）
  let latestWaiting: WorkforceEventSnapshot | undefined;
  for (const event of events) {
    if (event.eventType !== "job.waiting_human" || !event.visibleToUser) continue;
    if (!latestWaiting || event.sequence > latestWaiting.sequence) {
      latestWaiting = event;
    }
  }
  const requirement = latestWaiting
    ? readHumanRequirement(latestWaiting.payload)
    : null;

  let type: WorkforceNeedsYouType | undefined;
  let requirementDetail: string | undefined;
  let eventActionIds: string[] = [];
  if (requirement) {
    if (requirement.type && KNOWN_NEEDS_YOU_TYPES.has(requirement.type)) {
      type = requirement.type as WorkforceNeedsYouType;
    } else if (requirement.type) {
      // 事件明确声明了等待，但类型未知——fail-safe 显示，不猜测
      type = "UNKNOWN_HUMAN_INTERVENTION";
    }
    requirementDetail = requirement.detail;
    eventActionIds = refActionIds(requirement.refs);
  }

  // 2. errorCode 映射
  if (!type && run.errorCode) {
    type = ERROR_CODE_NEEDS_YOU[run.errorCode];
  }
  // 3/4. PendingAction / run 状态兜底
  if (!type && (openActions.length > 0 || run.status === "awaiting_approval")) {
    type = "APPROVAL_REQUIRED";
  }
  // 5. fail-safe
  if (!type) type = "UNKNOWN_HUMAN_INTERVENTION";

  const view: WorkforceNeedsYouView = {
    type,
    title: NEEDS_YOU_TITLES[type],
  };

  // detail：只取结构化来源，按类型收敛（不透出内部码/堆栈）。
  // Final Review FIX B：clarification detail 只允许
  // humanRequirement.detail / payload.clarification 两个结构化来源；
  // 结构化来源缺失时 detail=undefined——绝不回退 run 行上的错误原文
  //（该列属内部诊断面，可能含堆栈/英文原文；本文件对其零引用，
  // 由源码审计测试强制）。
  if (type === "CLARIFICATION_REQUIRED") {
    const clarification =
      requirementDetail ??
      asString(asRecord(latestWaiting?.payload).clarification);
    if (clarification) view.detail = clarification.slice(0, 500);
  } else if (type === "APPROVAL_REQUIRED") {
    if (requirementDetail === "expired" || run.errorCode === "approval_expired") {
      view.detail = "审批已过期，需要重新发起或放弃";
    } else if (openActions.length > 0) {
      view.detail = openActions[0].title;
    }
  }

  // pendingActionIds：审批类 = 当前 open 集合；拒绝类 = rejected 集合；
  // 事件 refs 里的 id 并入去重（结构化引用优先保留）
  if (type === "APPROVAL_REQUIRED" || type === "APPROVAL_REJECTED") {
    const base = type === "APPROVAL_REJECTED" ? rejectedActions : openActions;
    const ids = new Set<string>([...base.map((a) => a.id), ...eventActionIds]);
    if (ids.size > 0) view.pendingActionIds = [...ids];
  } else if (eventActionIds.length > 0) {
    view.pendingActionIds = eventActionIds;
  }

  return view;
}

/* ------------------------------------------------------------------ */
/* §3/§23 Timeline                                                      */
/* ------------------------------------------------------------------ */

type CategoryResolver =
  | WorkforceTimelineKind
  | ((payload: Record<string, unknown>) => WorkforceTimelineKind | null);

/**
 * 用户可见事件类别白名单（设计 §23 冻结映射 + 2C §18 前向事件）。
 * 不在表中的 eventType（tool.* / step.started / job.claimed /
 * job.lease_renewed / supervisor.* / grader.* / job.resume_blocked …）
 * 一律 fail-closed 排除——即使 DB 列 visibleToUser=true（V2 默认全 true
 * 是已知缺陷，读侧不信任存量列值，双重闸门）。
 */
const USER_TIMELINE_CATEGORY: Record<string, CategoryResolver> = {
  "job.created": "JOB_STARTED",
  // retry/continuation 回队是内部机制（payload 标记分流；写侧本就 visibleToUser=false）
  "job.queued": (payload) =>
    payload.retry === true || payload.continuation === true
      ? null
      : "JOB_STARTED",
  "plan.created": "JOB_STARTED",
  "step.completed": "PROGRESS",
  "verification.passed": "PROGRESS",
  // 2B/2C 设计的前向事件（writer 落地后自动进入用户 timeline）
  "job.progress": "PROGRESS",
  "job.retrying": "PROGRESS",
  "job.replanned": "REPLANNED",
  "job.waiting_human": "NEEDS_YOU",
  "approval.required": "NEEDS_YOU",
  "verification.needs_human": "NEEDS_YOU",
  "run.needs_human": "NEEDS_YOU",
  "job.resumed": "RESUMED",
  "approval.resolved": "RESUMED",
  "job.clarification_answered": "RESUMED",
  "job.human_action_completed": "RESUMED",
  "job.human_edited": "RESUMED",
  "job.completed": (payload) =>
    payload.status === "partially_executed" ? "PARTIAL" : "COMPLETED",
  "job.failed": "FAILED",
  "job.cancelled": "CANCELLED",
  "run.cancelled": "CANCELLED",
};

/**
 * 用户 timeline（设计 §11）：visibleToUser=true ∩ 类别白名单，sequence ASC。
 * 条目不携带原始 payload——只透出白名单派生字段。
 */
export function projectTimeline(
  events: ReadonlyArray<WorkforceEventSnapshot>,
): WorkforceTimelineItem[] {
  const items: WorkforceTimelineItem[] = [];
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (!event.visibleToUser) continue;
    const resolver = USER_TIMELINE_CATEGORY[event.eventType];
    if (!resolver) continue;
    const payload = asRecord(event.payload);
    const kind = typeof resolver === "function" ? resolver(payload) : resolver;
    if (!kind) continue;

    const item: WorkforceTimelineItem = {
      at: iso(event.createdAt),
      sequence: event.sequence,
      kind,
      eventType: event.eventType,
      title: event.title,
    };
    if (kind === "NEEDS_YOU") {
      const requirement = readHumanRequirement(event.payload);
      item.needsYouType =
        requirement?.type && KNOWN_NEEDS_YOU_TYPES.has(requirement.type)
          ? (requirement.type as WorkforceNeedsYouType)
          : "UNKNOWN_HUMAN_INTERVENTION";
    }
    items.push(item);
  }
  return items;
}

/**
 * 最终结果摘要（2D-1，设计 §10/§19：deliverable = job.completed payload 摘要）。
 *
 * 唯一来源 = 最新 user-visible `job.completed` 事件的 payload.summary
 * （字符串）。2B `aggregateJobResult` 落地前该字段不存在 → undefined，
 * UI 按"尚未生成最终结果"呈现——绝不由前端拼装 LLM 摘要。
 *
 * 结构性排除：`job.failed` 的 payload.report 可能承载内部错误原文
 * （process 失败分支把 round.error 塞进 report），永不透出用户面。
 */
export function projectFinalSummary(
  events: ReadonlyArray<WorkforceEventSnapshot>,
): string | undefined {
  let latest: WorkforceEventSnapshot | undefined;
  for (const event of events) {
    if (event.eventType !== "job.completed" || !event.visibleToUser) continue;
    if (!latest || event.sequence > latest.sequence) latest = event;
  }
  if (!latest) return undefined;
  const summary = asString(asRecord(latest.payload).summary);
  return summary ? summary.slice(0, 4000) : undefined;
}

/** 内部 timeline（Admin/Operator）：全量事件原样，sequence ASC */
export function projectInternalTimeline(
  events: ReadonlyArray<WorkforceEventSnapshot>,
): WorkforceInternalTimelineItem[] {
  return [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => ({
      at: iso(event.createdAt),
      sequence: event.sequence,
      eventType: event.eventType,
      title: event.title,
      visibleToUser: event.visibleToUser,
      payload: event.payload,
    }));
}

/* ------------------------------------------------------------------ */
/* §17 businessRefs（metadata 来源，零 JOIN）                            */
/* ------------------------------------------------------------------ */

const METADATA_REF_KEYS: ReadonlyArray<{
  key: string;
  type: WorkforceBusinessRefType;
}> = [
  { key: "workspaceId", type: "workspace" },
  { key: "projectId", type: "project" },
  { key: "customerId", type: "customer" },
  { key: "vendorId", type: "supplier" },
  { key: "tenderId", type: "tender" },
  { key: "orderId", type: "order" },
];

export function projectBusinessRefs(
  metadata: unknown,
): WorkforceBusinessRef[] | undefined {
  const meta = asRecord(metadata);
  const refs: WorkforceBusinessRef[] = [];
  for (const { key, type } of METADATA_REF_KEYS) {
    const id = asString(meta[key]);
    if (id) refs.push({ type, id });
  }
  return refs.length > 0 ? refs : undefined;
}

/* ------------------------------------------------------------------ */
/* §4 汇总                                                              */
/* ------------------------------------------------------------------ */

function projectTitle(
  run: Pick<WorkforceRunSnapshot, "planJson" | "metadata">,
): string | undefined {
  const objective = asString(asRecord(run.planJson).objective);
  if (objective) return objective.slice(0, 120);
  const goal = asString(asRecord(run.metadata).goal);
  if (goal) return goal.length > 80 ? `${goal.slice(0, 80)}…` : goal;
  return undefined;
}

export function buildWorkforceJobViewModel(input: {
  run: WorkforceRunSnapshot;
  steps: ReadonlyArray<WorkforceStepSnapshot>;
  events: ReadonlyArray<WorkforceEventSnapshot>;
  pendingActions: ReadonlyArray<WorkforcePendingActionSnapshot>;
  includeInternal?: boolean;
}): WorkforceJobViewModel {
  const { run, events, pendingActions } = input;
  const orderedSteps = sortStepsByPlanOrder(run.planJson, input.steps);

  const view: WorkforceJobViewModel = {
    jobId: run.id,
    status: projectJobStatus(run, orderedSteps),
    progress: projectProgress(orderedSteps),
    currentTasks: projectCurrentTasks(orderedSteps),
    tasks: orderedSteps.map(projectTaskView),
    timeline: projectTimeline(events),
    createdAt: iso(run.createdAt),
    lastActivityAt: iso(run.updatedAt),
  };

  const title = projectTitle(run);
  if (title) view.title = title;
  if (run.startedAt) view.startedAt = iso(run.startedAt);
  if (run.completedAt) view.completedAt = iso(run.completedAt);

  const needsYou = projectNeedsYou(run, events, pendingActions);
  if (needsYou) view.needsYou = needsYou;

  const finalSummary = projectFinalSummary(events);
  if (finalSummary) view.finalSummary = finalSummary;

  const businessRefs = projectBusinessRefs(run.metadata);
  if (businessRefs) view.businessRefs = businessRefs;

  if (input.includeInternal === true) {
    view.internalTimeline = projectInternalTimeline(events);
  }

  return view;
}
