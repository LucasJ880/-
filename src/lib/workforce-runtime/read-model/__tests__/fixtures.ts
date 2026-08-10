/**
 * Read Model 测试夹具（纯内存合成，零 DB、零 Prisma）
 *
 * 事件链形状对齐 2A/2C-1 真实 writer（processor.ts / job.ts / resume.ts）：
 * 同 run 内 sequence 严格递增；visibleToUser 按写侧真实值。
 */

import type {
  WorkforceEventSnapshot,
  WorkforcePendingActionSnapshot,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
} from "../types";

export const T0 = new Date("2026-08-10T09:00:00.000Z");

export function at(minutes: number, seconds = 0): Date {
  return new Date(T0.getTime() + minutes * 60_000 + seconds * 1000);
}

let stepAutoId = 0;

export function makeRun(
  overrides: Partial<WorkforceRunSnapshot> = {},
): WorkforceRunSnapshot {
  return {
    id: "run_job_1",
    orgId: "org_a",
    runType: "workforce_job",
    status: "queued",
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    planJson: null,
    metadata: {
      runtimeVersion: "v2",
      goal: "帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。",
      jobId: "run_job_1",
      initiatedByUserId: "user_owner",
    },
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makeStep(
  stepKey: string,
  status: string,
  overrides: Partial<WorkforceStepSnapshot> = {},
): WorkforceStepSnapshot {
  stepAutoId += 1;
  return {
    id: `step_${String(stepAutoId).padStart(3, "0")}`,
    stepKey,
    title: `任务 ${stepKey}`,
    status,
    inputJson: null,
    startedAt: null,
    completedAt: null,
    createdAt: at(1),
    ...overrides,
  };
}

/** planJson：steps 顺序即计划顺序（PlannerOutput 形状的最小子集） */
export function makePlan(stepKeys: string[], objective?: string): unknown {
  return {
    objective: objective ?? "整理销售跟进优先级",
    summary: "synthetic plan",
    steps: stepKeys.map((id) => ({ id, title: `任务 ${id}` })),
  };
}

export type EventSpec = {
  type: string;
  visible: boolean;
  title?: string;
  payload?: unknown;
  atMinutes?: number;
};

/** sequence 自动 1..n（与 @@unique([runId, sequence]) 语义一致） */
export function makeEvents(specs: EventSpec[]): WorkforceEventSnapshot[] {
  return specs.map((spec, index) => ({
    sequence: index + 1,
    eventType: spec.type,
    title: spec.title ?? spec.type,
    payload: spec.payload ?? null,
    visibleToUser: spec.visible,
    createdAt: at(spec.atMinutes ?? index),
  }));
}

export function makePendingAction(
  id: string,
  status: string,
  title: string,
  overrides: Partial<WorkforcePendingActionSnapshot> = {},
): WorkforcePendingActionSnapshot {
  return { id, status, title, createdAt: at(5), ...overrides };
}

/**
 * 2A 实证的"开工"事件前缀（job.created → job.queued → job.claimed →
 * plan.created + 内部执行细节）。含写侧 visibleToUser 真实值与
 * V2 默认全 true 的已知缺陷（tool.* / step.started 列值为 true——
 * 用户 timeline 必须靠白名单挡住，这正是测试要证明的）。
 */
export function workingEventPrefix(): EventSpec[] {
  return [
    { type: "job.created", visible: true, title: "Workforce Job 已创建" },
    { type: "job.queued", visible: true, title: "已进入 Workforce 队列" },
    {
      type: "job.claimed",
      visible: false,
      title: "Workforce Job 已认领",
      payload: {
        attempts: 0,
        leaseExpiresAt: "2026-08-10T09:03:00.000Z",
        correlation: { orgId: "org_a", traceId: "trace_secret_1" },
      },
    },
    { type: "plan.created", visible: true, title: "已拆解为多项任务" },
    {
      type: "job.lease_renewed",
      visible: false,
      title: "租约续期",
      payload: { leaseExpiresAt: "2026-08-10T09:06:00.000Z", round: 0 },
    },
    // V2 默认可见缺陷：列值 true，但必须被类别白名单 fail-closed 排除
    { type: "step.started", visible: true, title: "step s1 开始" },
    {
      type: "tool.started",
      visible: true,
      title: "调用 sales_get_pipeline",
      payload: { tool: "sales_get_pipeline", internalArgs: { secret: "raw" } },
    },
    { type: "tool.completed", visible: true, title: "工具完成" },
    { type: "step.completed", visible: true, title: "任务 s1 完成" },
  ];
}
