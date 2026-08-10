/**
 * Workforce Job Read Model — Golden Projection Scenarios（O1–O9）
 * + 内部事件泄漏防线 + legacy / Phase 2B 兼容契约
 *
 * 纯投影测试：合成快照 → 视图断言。零 DB、零 Prisma、零网络。
 * 运行：npx tsx src/lib/workforce-runtime/read-model/__tests__/projection-golden.test.ts
 */

import {
  buildWorkforceJobViewModel,
  projectJobStatus,
  projectTimeline,
} from "../projection";
import type { WorkforceJobViewModel } from "../types";
import {
  at,
  makeEvents,
  makePendingAction,
  makePlan,
  makeRun,
  makeStep,
  workingEventPrefix,
} from "./fixtures";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function section(name: string): void {
  console.log(`\n━━ ${name}`);
}

function userViewJson(view: WorkforceJobViewModel): string {
  // internalTimeline 是 Admin 面（默认不产出）；泄漏断言只针对用户面
  const rest: WorkforceJobViewModel = { ...view };
  delete rest.internalTimeline;
  return JSON.stringify(rest);
}

/* ================================================================== */
section("O1 QUEUED — 新建从未开始");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({ status: "queued" }),
    steps: [],
    events: makeEvents([
      { type: "job.created", visible: true, title: "Workforce Job 已创建" },
      { type: "job.queued", visible: true, title: "已进入 Workforce 队列" },
    ]),
    pendingActions: [],
  });
  ok(view.status === "QUEUED", "status = QUEUED", view.status);
  ok(view.progress.totalTasks === 0 && view.progress.completedTasks === 0, "progress 0/0");
  ok(view.currentTasks.length === 0, "currentTasks = []");
  ok(view.needsYou === undefined, "无 needsYou");
  ok(
    view.timeline.length === 2 &&
      view.timeline.every((t) => t.kind === "JOB_STARTED"),
    "timeline = 2 条 JOB_STARTED",
    view.timeline,
  );
  ok(view.title !== undefined && view.title.includes("销售客户"), "title 来自 goal");
  ok(view.internalTimeline === undefined, "默认无 internalTimeline");
}

/* ================================================================== */
section("O2 WORKING — 执行中（含内部事件混入）");
{
  const plan = makePlan(["s1", "s2", "s3"]);
  const run = makeRun({
    status: "executing",
    attempts: 1,
    planJson: plan,
    startedAt: at(0, 30),
    updatedAt: at(8),
  });
  const steps = [
    makeStep("s1", "completed", { startedAt: at(2), completedAt: at(3) }),
    makeStep("s2", "running", { startedAt: at(4) }),
    makeStep("s3", "pending"),
  ];
  const view = buildWorkforceJobViewModel({
    run,
    steps,
    events: makeEvents(workingEventPrefix()),
    pendingActions: [],
  });
  ok(view.status === "WORKING", "status = WORKING", view.status);
  ok(
    view.progress.totalTasks === 3 &&
      view.progress.completedTasks === 1 &&
      view.progress.activeTasks === 1 &&
      view.progress.blockedTasks === 0,
    "progress = {3,1,1,0}",
    view.progress,
  );
  ok(
    view.currentTasks.length === 1 && view.currentTasks[0].stepKey === "s2",
    "currentTasks = [s2 running]",
    view.currentTasks,
  );
  ok(view.tasks.length === 3 && view.tasks[0].stepKey === "s1", "tasks 按计划顺序");
  const kinds = view.timeline.map((t) => `${t.eventType}:${t.kind}`);
  ok(
    kinds.join(",") ===
      "job.created:JOB_STARTED,job.queued:JOB_STARTED,plan.created:JOB_STARTED,step.completed:PROGRESS",
    "timeline 只含白名单事件（sequence ASC）",
    kinds,
  );
  ok(view.title === "整理销售跟进优先级", "title 优先 planJson.objective");

  // WORKING 的 queued 变体（设计 §5：continuation / retry 不是"排队"）
  const contQueued = projectJobStatus(
    { ...run, status: "queued", attempts: 0, errorCode: null },
    steps,
  );
  ok(contQueued === "WORKING", "continuation 回队（有 plan/steps）→ WORKING", contQueued);
  const retryQueued = projectJobStatus(
    {
      status: "queued",
      attempts: 2,
      errorCode: "model_failed",
      planJson: null,
      completedAt: null,
      cancelledAt: null,
    },
    [],
  );
  ok(retryQueued === "WORKING", "retry 回队（attempts>0+errorCode）→ WORKING", retryQueued);
}

/* ================================================================== */
section("O3 AWAITING APPROVAL → NEEDS_YOU");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "awaiting_approval",
      planJson: makePlan(["s1", "s2"]),
      startedAt: at(0, 30),
    }),
    steps: [
      makeStep("s1", "completed", { completedAt: at(3) }),
      makeStep("s2", "awaiting_approval", { startedAt: at(4) }),
    ],
    events: makeEvents([
      ...workingEventPrefix(),
      {
        type: "approval.required",
        visible: true,
        title: "需要审批：发送跟进邮件",
      },
      {
        type: "job.waiting_human",
        visible: true,
        title: "等待审批后继续",
        payload: {
          status: "awaiting_approval",
          humanRequirement: { type: "APPROVAL_REQUIRED" },
          correlation: { orgId: "org_a", traceId: "trace_secret_1" },
        },
      },
    ]),
    pendingActions: [makePendingAction("pa_1", "pending", "发送跟进邮件给王总")],
  });
  ok(view.status === "NEEDS_YOU", "status = NEEDS_YOU", view.status);
  ok(view.needsYou?.type === "APPROVAL_REQUIRED", "needsYou.type = APPROVAL_REQUIRED");
  ok(typeof view.needsYou?.title === "string" && view.needsYou.title.length > 0, "needsYou.title 有值");
  ok(view.needsYou?.detail === "发送跟进邮件给王总", "detail = PendingAction.title", view.needsYou);
  ok(
    JSON.stringify(view.needsYou?.pendingActionIds) === JSON.stringify(["pa_1"]),
    "pendingActionIds = [pa_1]",
  );
  ok(
    view.currentTasks.length === 1 &&
      view.currentTasks[0].status === "awaiting_approval",
    "currentTasks = [s2 awaiting_approval]",
  );
  const needsYouItems = view.timeline.filter((t) => t.kind === "NEEDS_YOU");
  ok(
    needsYouItems.length === 2 &&
      needsYouItems[1].needsYouType === "APPROVAL_REQUIRED",
    "timeline NEEDS_YOU 条目带结构化 needsYouType",
    needsYouItems,
  );
}

/* ================================================================== */
section("O4 APPROVAL REJECTED → NEEDS_YOU");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "needs_human",
      errorCode: "approval_rejected",
      errorMessage: "审批被拒绝，需要人工决定后续（重新规划或放弃）",
      planJson: makePlan(["s1", "s2"]),
    }),
    steps: [
      makeStep("s1", "completed", { completedAt: at(3) }),
      makeStep("s2", "skipped"),
    ],
    events: makeEvents([
      ...workingEventPrefix(),
      {
        type: "job.waiting_human",
        visible: true,
        title: "等待审批后继续",
        payload: { humanRequirement: { type: "APPROVAL_REQUIRED" } },
      },
      {
        type: "job.waiting_human",
        visible: true,
        title: "审批被拒绝，需要人工处理",
        payload: {
          humanRequirement: {
            type: "APPROVAL_REJECTED",
            refs: { pendingActionIds: ["pa_9"] },
          },
          trigger: "approval_decided",
        },
      },
    ]),
    pendingActions: [makePendingAction("pa_9", "rejected", "调整投标报价")],
  });
  ok(view.status === "NEEDS_YOU", "status = NEEDS_YOU");
  ok(
    view.needsYou?.type === "APPROVAL_REJECTED",
    "最新 waiting_human 事件优先 → APPROVAL_REJECTED",
    view.needsYou,
  );
  ok(
    view.needsYou?.pendingActionIds?.includes("pa_9") === true,
    "pendingActionIds 含被拒动作",
  );
}

/* ================================================================== */
section("O5 COMPLETED（skipped 计入分子）");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "completed",
      planJson: makePlan(["s1", "s2", "s3"]),
      startedAt: at(0, 30),
      completedAt: at(20),
    }),
    steps: [
      makeStep("s1", "completed", { completedAt: at(3) }),
      makeStep("s2", "completed", { completedAt: at(6) }),
      makeStep("s3", "skipped"),
    ],
    events: makeEvents([
      ...workingEventPrefix(),
      { type: "verification.started", visible: false },
      { type: "verification.passed", visible: true, title: "结果已核验" },
      {
        type: "job.completed",
        visible: true,
        title: "Workforce Job 已完成",
        payload: { status: "completed" },
      },
    ]),
    pendingActions: [],
  });
  ok(view.status === "COMPLETED", "status = COMPLETED");
  ok(
    view.progress.completedTasks === 3 && view.progress.totalTasks === 3,
    "progress 3/3（skipped 计入分子）",
    view.progress,
  );
  ok(view.currentTasks.length === 0, "currentTasks = []");
  ok(view.needsYou === undefined, "终态无 needsYou");
  const last = view.timeline[view.timeline.length - 1];
  ok(last.kind === "COMPLETED" && last.eventType === "job.completed", "timeline 末条 COMPLETED");
  ok(view.completedAt !== undefined, "completedAt 有值");
}

/* ================================================================== */
section("O6 PARTIAL（partially_executed）");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "partially_executed",
      planJson: makePlan(["s1", "s2"]),
      completedAt: at(30),
    }),
    steps: [
      makeStep("s1", "completed", { completedAt: at(3) }),
      makeStep("s2", "failed"),
    ],
    events: makeEvents([
      ...workingEventPrefix(),
      {
        type: "job.completed",
        visible: true,
        title: "Workforce Job 已完成（部分）",
        payload: { status: "partially_executed" },
      },
    ]),
    pendingActions: [],
  });
  ok(view.status === "PARTIAL", "status = PARTIAL", view.status);
  ok(
    view.progress.completedTasks === 1 && view.progress.blockedTasks === 1,
    "progress：failed 计入 blockedTasks 而非分子",
    view.progress,
  );
  const last = view.timeline[view.timeline.length - 1];
  ok(
    last.kind === "PARTIAL" && last.eventType === "job.completed",
    "同一 job.completed 事件按 payload.status 分流为 PARTIAL",
    last,
  );
}

/* ================================================================== */
section("O7 FAILED（错误详情不泄漏）");
{
  const stackLeak = "TypeError: boom at executor.ts:123 STACK_SENTINEL";
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "failed",
      errorCode: "model_failed",
      errorMessage: stackLeak,
      attempts: 5,
      planJson: makePlan(["s1"]),
      completedAt: at(40),
    }),
    steps: [makeStep("s1", "failed")],
    events: makeEvents([
      ...workingEventPrefix(),
      {
        type: "job.failed",
        visible: true,
        title: "Workforce Job 失败（重试次数耗尽）",
        payload: { attempts: 5, exhausted: true },
      },
    ]),
    pendingActions: [],
  });
  ok(view.status === "FAILED", "status = FAILED");
  ok(view.needsYou === undefined, "FAILED 无 needsYou");
  const last = view.timeline[view.timeline.length - 1];
  ok(last.kind === "FAILED", "timeline 末条 FAILED");
  ok(
    !userViewJson(view).includes("STACK_SENTINEL"),
    "内部 errorMessage/堆栈不进入用户视图",
  );
}

/* ================================================================== */
section("O8 CANCELLED");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "cancelled",
      cancelledAt: at(12),
      planJson: makePlan(["s1", "s2"]),
    }),
    steps: [
      makeStep("s1", "completed", { completedAt: at(3) }),
      makeStep("s2", "pending"),
    ],
    events: makeEvents([
      ...workingEventPrefix(),
      { type: "run.cancelled", visible: true, title: "任务已取消" },
    ]),
    pendingActions: [],
  });
  ok(view.status === "CANCELLED", "status = CANCELLED");
  const last = view.timeline[view.timeline.length - 1];
  ok(last.kind === "CANCELLED" && last.eventType === "run.cancelled", "timeline 末条 CANCELLED");
  ok(view.needsYou === undefined, "CANCELLED 无 needsYou");
}

/* ================================================================== */
section("O9 多 current tasks（2B-2 并行前向契约，synthetic）");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({
      status: "executing",
      planJson: makePlan(["a", "b", "c", "d"]),
    }),
    steps: [
      makeStep("a", "running", {
        startedAt: at(5),
        inputJson: { worker: { id: "sales" }, taskKind: "read" },
      }),
      makeStep("b", "running", {
        startedAt: at(4),
        inputJson: { worker: { id: "tender" }, taskKind: "read" },
      }),
      makeStep("c", "awaiting_approval"),
      makeStep("d", "pending"),
    ],
    events: makeEvents(workingEventPrefix()),
    pendingActions: [],
  });
  ok(view.status === "WORKING", "status = WORKING");
  ok(view.currentTasks.length === 2, "currentTasks = 2 个（并行）", view.currentTasks.length);
  ok(
    view.currentTasks[0].stepKey === "b" && view.currentTasks[1].stepKey === "a",
    "running 按 startedAt 升序（最早开始在前）",
    view.currentTasks.map((t) => t.stepKey),
  );
  ok(
    view.currentTasks[0].workerKey === "tender" &&
      view.currentTasks[0].taskKind === "read",
    "workerKey / taskKind 从 inputJson 透出（2B-1 落地即生效）",
  );
  ok(
    view.progress.activeTasks === 3,
    "activeTasks = running×2 + awaiting_approval×1",
    view.progress,
  );
}

/* ================================================================== */
section("内部事件泄漏防线（INTERNAL_EVENT_LEAK = BLOCKED）");
{
  const view = buildWorkforceJobViewModel({
    run: makeRun({ status: "executing", planJson: makePlan(["s1"]) }),
    steps: [makeStep("s1", "running", { startedAt: at(2) })],
    events: makeEvents([
      ...workingEventPrefix(),
      // 未知/安全类事件：即使列值可见也必须被白名单挡住
      {
        type: "security.tool_denied",
        visible: true,
        title: "SECURITY_SENTINEL",
        payload: { reason: "scope denied" },
      },
      {
        type: "job.resume_blocked",
        visible: true, // 故意写错列值（写侧实际 false）——读侧不得信任列值
        title: "恢复被拦截 RESUME_BLOCKED_SENTINEL",
        payload: { blockedBy: "principal" },
      },
    ]),
    pendingActions: [],
  });
  const json = userViewJson(view);
  ok(!json.includes("tool.started"), "tool.* 不进用户 timeline");
  ok(!json.includes("step.started"), "step.started 不进用户 timeline");
  ok(!json.includes("job.claimed"), "job.claimed 不进用户 timeline");
  ok(!json.includes("job.lease_renewed"), "lease 续期不进用户 timeline");
  ok(!json.includes("leaseExpiresAt"), "lease 内部字段零出现");
  ok(!json.includes("trace_secret_1"), "correlation/traceId 零出现");
  ok(!json.includes("internalArgs"), "工具内部参数零出现");
  ok(!json.includes("SECURITY_SENTINEL"), "未知安全事件 fail-closed 排除");
  ok(!json.includes("RESUME_BLOCKED_SENTINEL"), "resume_blocked 不进用户 timeline（列值不可信）");

  // includeInternal=true：Admin 面才可见全量
  const adminView = buildWorkforceJobViewModel({
    run: makeRun({ status: "executing", planJson: makePlan(["s1"]) }),
    steps: [],
    events: makeEvents(workingEventPrefix()),
    pendingActions: [],
    includeInternal: true,
  });
  ok(
    Array.isArray(adminView.internalTimeline) &&
      adminView.internalTimeline.length === workingEventPrefix().length &&
      adminView.internalTimeline.some((e) => e.eventType === "job.claimed"),
    "includeInternal=true → internalTimeline 全量（含内部事件）",
  );
}

/* ================================================================== */
section("Legacy 兼容（2A 早期 Job：无 humanRequirement / 无事件）");
{
  // needs_human 但 waiting_human payload 无 humanRequirement（2C-1 之前的写侧）
  const legacyNeedsHuman = buildWorkforceJobViewModel({
    run: makeRun({ status: "needs_human", errorCode: null }),
    steps: [],
    events: makeEvents([
      { type: "job.created", visible: true },
      {
        type: "job.waiting_human",
        visible: true,
        title: "需要人工处理",
        payload: { status: "needs_human" },
      },
    ]),
    pendingActions: [],
  });
  ok(
    legacyNeedsHuman.needsYou?.type === "UNKNOWN_HUMAN_INTERVENTION",
    "legacy 无结构化原因 → fail-safe UNKNOWN_HUMAN_INTERVENTION",
    legacyNeedsHuman.needsYou,
  );
  ok(
    typeof legacyNeedsHuman.needsYou?.title === "string",
    "UNKNOWN 也有确定性标题（fail-safe 显示）",
  );

  // awaiting_approval 且完全无事件/无 action（极端 legacy）→ 状态本身即语义
  const legacyAwaiting = buildWorkforceJobViewModel({
    run: makeRun({ status: "awaiting_approval" }),
    steps: [],
    events: [],
    pendingActions: [],
  });
  ok(
    legacyAwaiting.needsYou?.type === "APPROVAL_REQUIRED",
    "无事件的 awaiting_approval → APPROVAL_REQUIRED（状态兜底）",
  );

  // clarification park（processor 真实形状：errorCode + errorMessage 存问题原文）
  const clarification = buildWorkforceJobViewModel({
    run: makeRun({
      status: "needs_human",
      errorCode: "clarification_required",
      errorMessage: "请确认要分析的客户范围：全部还是仅本季度新增？",
    }),
    steps: [],
    events: makeEvents([
      { type: "job.created", visible: true },
      {
        type: "job.waiting_human",
        visible: true,
        title: "需要补充信息后继续",
        payload: {
          clarification: "请确认要分析的客户范围：全部还是仅本季度新增？",
          humanRequirement: {
            type: "CLARIFICATION_REQUIRED",
            detail: "请确认要分析的客户范围：全部还是仅本季度新增？",
          },
        },
      },
    ]),
    pendingActions: [],
  });
  ok(
    clarification.needsYou?.type === "CLARIFICATION_REQUIRED" &&
      clarification.needsYou.detail?.includes("客户范围") === true,
    "clarification 问题原文进入 detail（结构化来源）",
    clarification.needsYou,
  );

  // FIX B — errorMessage 结构性不泄漏：errorCode=clarification_required
  // 但 waiting_human 无任何结构化 detail（humanRequirement.detail /
  // payload.clarification 均缺失）→ 类型仍正确、detail=undefined、
  // run 行错误原文（可能是堆栈）零出现
  const stackSentinel = "STACK_SECRET_SENTINEL at planner.ts:42";
  const bareClarification = buildWorkforceJobViewModel({
    run: makeRun({
      status: "needs_human",
      errorCode: "clarification_required",
      errorMessage: stackSentinel,
    }),
    steps: [],
    events: makeEvents([
      {
        type: "job.waiting_human",
        visible: true,
        title: "需要补充信息后继续",
        payload: { status: "needs_human" },
      },
    ]),
    pendingActions: [],
  });
  ok(
    bareClarification.needsYou?.type === "CLARIFICATION_REQUIRED",
    "FIX B：无结构化 detail 仍映射 CLARIFICATION_REQUIRED",
    bareClarification.needsYou,
  );
  ok(
    bareClarification.needsYou?.detail === undefined,
    "FIX B：结构化来源缺失 → detail=undefined（不回退 errorMessage）",
  );
  ok(
    typeof bareClarification.needsYou?.title === "string" &&
      bareClarification.needsYou.title.length > 0,
    "FIX B：确定性 title 仍在",
  );
  ok(
    !userViewJson(bareClarification).includes("STACK_SECRET_SENTINEL"),
    "FIX B：errorMessage 原文（堆栈）在用户视图零出现",
  );

  // PERMISSION_CHANGED（principal 失效）：detail 不透出内部码
  const permission = buildWorkforceJobViewModel({
    run: makeRun({
      status: "needs_human",
      errorCode: "MEMBERSHIP_INACTIVE",
      errorMessage: "membership inactive for user user_owner",
    }),
    steps: [],
    events: makeEvents([
      {
        type: "job.waiting_human",
        visible: true,
        title: "执行主体身份失效，需要人工处理",
        payload: {
          humanRequirement: { type: "PERMISSION_CHANGED", detail: "MEMBERSHIP_INACTIVE" },
        },
      },
    ]),
    pendingActions: [],
  });
  ok(
    permission.needsYou?.type === "PERMISSION_CHANGED" &&
      permission.needsYou.detail === undefined,
    "PERMISSION_CHANGED：类型透出、内部码不透出",
    permission.needsYou,
  );

  // 审批过期（2C-1 expiry reconcile 真实形状）
  const expired = buildWorkforceJobViewModel({
    run: makeRun({
      status: "needs_human",
      errorCode: "approval_expired",
      errorMessage: "审批已过期，需要人工决定重新发起或放弃",
    }),
    steps: [],
    events: makeEvents([
      {
        type: "job.waiting_human",
        visible: true,
        title: "审批已过期，需要人工处理",
        payload: {
          humanRequirement: {
            type: "APPROVAL_REQUIRED",
            detail: "expired",
            refs: { pendingActionIds: ["pa_exp"] },
          },
        },
      },
    ]),
    pendingActions: [makePendingAction("pa_exp", "failed", "过期的审批")],
  });
  ok(
    expired.needsYou?.type === "APPROVAL_REQUIRED" &&
      expired.needsYou.detail === "审批已过期，需要重新发起或放弃" &&
      expired.needsYou.pendingActionIds?.includes("pa_exp") === true,
    "approval expired → APPROVAL_REQUIRED + 过期语义 detail + refs 透出",
    expired.needsYou,
  );
}

/* ================================================================== */
section("前向兼容（未知状态 / 未知事件 / 未来事件 / 乱序输入）");
{
  // 未知 run 状态 fail-safe
  ok(
    projectJobStatus(
      { status: "paused_v9", attempts: 0, errorCode: null, planJson: null, completedAt: null, cancelledAt: null },
      [],
    ) === "WORKING",
    "未知非终态状态 → WORKING（保守）",
  );
  ok(
    projectJobStatus(
      { status: "archived_v9", attempts: 0, errorCode: null, planJson: null, completedAt: at(1), cancelledAt: null },
      [],
    ) === "FAILED",
    "未知状态 + completedAt → FAILED（不谎报完成）",
  );
  ok(
    projectJobStatus(
      { status: "gone_v9", attempts: 0, errorCode: null, planJson: null, completedAt: null, cancelledAt: at(1) },
      [],
    ) === "CANCELLED",
    "未知状态 + cancelledAt → CANCELLED",
  );

  // 未来 USER_VISIBLE 事件（writer 落地后自动出现）；未知事件排除
  const timeline = projectTimeline(
    makeEvents([
      { type: "job.progress", visible: true, payload: { completed: 3, total: 7 } },
      { type: "job.replanned", visible: true, payload: { reason: "approval_rejected" } },
      { type: "job.retrying", visible: true },
      { type: "job.some_future_internal", visible: true, title: "FUTURE_SENTINEL" },
    ]),
  );
  ok(
    timeline.map((t) => t.kind).join(",") === "PROGRESS,REPLANNED,PROGRESS",
    "job.progress/replanned/retrying 前向进入；未知事件 fail-closed",
    timeline,
  );

  // 乱序输入 → sequence ASC 输出（不依赖 createdAt）
  const shuffled = projectTimeline([
    { sequence: 3, eventType: "job.completed", title: null, payload: { status: "completed" }, visibleToUser: true, createdAt: at(1) },
    { sequence: 1, eventType: "job.created", title: null, payload: null, visibleToUser: true, createdAt: at(9) },
    { sequence: 2, eventType: "step.completed", title: null, payload: null, visibleToUser: true, createdAt: at(0) },
  ]);
  ok(
    shuffled.map((t) => t.sequence).join(",") === "1,2,3",
    "timeline 按 sequence ASC（同毫秒/乱序输入 deterministic）",
  );

  // Worker 投影边界：权限词汇零出现（即使未来有人把它塞进 inputJson）
  const withWorker = buildWorkforceJobViewModel({
    run: makeRun({ status: "executing", planJson: makePlan(["w1"]) }),
    steps: [
      makeStep("w1", "running", {
        inputJson: {
          worker: { id: "sales", allowedSkills: ["sales-x"], scope: "org", authorized: true },
        },
      }),
    ],
    events: [],
    pendingActions: [],
  });
  const wjson = userViewJson(withWorker);
  ok(withWorker.tasks[0].workerKey === "sales", "workerKey 透出");
  ok(
    !wjson.includes("allowedSkills") && !wjson.includes("authorized"),
    "权限/scope/authorized 语义零出现（角色 ≠ 权限）",
  );

  // 无 plan 的步骤排序兜底（createdAt/id）不抛错
  const noPlan = buildWorkforceJobViewModel({
    run: makeRun({ status: "executing" }),
    steps: [
      makeStep("z2", "completed", { createdAt: at(2) }),
      makeStep("z1", "running", { createdAt: at(1) }),
    ],
    events: [],
    pendingActions: [],
  });
  ok(
    noPlan.tasks.map((t) => t.stepKey).join(",") === "z1,z2",
    "无 planJson 时按 createdAt 排序（legacy 容错）",
  );
}

/* ================================================================== */
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
