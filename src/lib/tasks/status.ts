/**
 * Task 状态领域层（统一 normalization）
 * DB 存储小写蛇形；业务侧用 TASK_STATUS_* 常量。
 */

export const TASK_STATUS_VALUES = [
  "todo",
  "in_progress",
  "waiting_external",
  "waiting_internal",
  "blocked",
  "needs_approval",
  "done",
  "cancelled",
] as const;

export type TaskStatusValue = (typeof TASK_STATUS_VALUES)[number];

/** 兼容旧别名 → 规范存储值 */
const ALIASES: Record<string, TaskStatusValue> = {
  todo: "todo",
  TODO: "todo",
  in_progress: "in_progress",
  IN_PROGRESS: "in_progress",
  "in-progress": "in_progress",
  waiting_external: "waiting_external",
  WAITING_EXTERNAL: "waiting_external",
  waiting_internal: "waiting_internal",
  WAITING_INTERNAL: "waiting_internal",
  blocked: "blocked",
  BLOCKED: "blocked",
  needs_approval: "needs_approval",
  NEEDS_APPROVAL: "needs_approval",
  done: "done",
  DONE: "done",
  completed: "done",
  COMPLETED: "done",
  cancelled: "cancelled",
  CANCELLED: "cancelled",
  canceled: "cancelled",
  archived: "cancelled",
};

export const TASK_STATUS_META: Record<
  TaskStatusValue,
  { label: string; color: string }
> = {
  todo: { label: "待办", color: "bg-muted/15 text-muted" },
  in_progress: { label: "进行中", color: "bg-accent-soft text-accent" },
  waiting_external: {
    label: "等待外部",
    color: "bg-warning-bg text-warning",
  },
  waiting_internal: {
    label: "等待内部",
    color: "bg-warning-bg text-warning",
  },
  blocked: { label: "阻塞", color: "bg-danger-bg text-danger" },
  needs_approval: {
    label: "待审批",
    color: "bg-warning-bg text-warning",
  },
  done: { label: "已完成", color: "bg-success-bg text-success" },
  cancelled: { label: "已取消", color: "bg-danger-bg text-danger" },
};

export function normalizeTaskStatus(
  value: string | null | undefined,
): TaskStatusValue | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ALIASES[trimmed]) return ALIASES[trimmed];
  const lower = trimmed.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  return null;
}

export function assertTaskStatus(value: string): TaskStatusValue {
  const n = normalizeTaskStatus(value);
  if (!n) throw new Error(`无效任务状态: ${value}`);
  return n;
}

export function isTaskOpen(status: string | null | undefined): boolean {
  const n = normalizeTaskStatus(status);
  return n != null && n !== "done" && n !== "cancelled";
}

export function isTaskCompleted(status: string | null | undefined): boolean {
  const n = normalizeTaskStatus(status);
  return n === "done" || n === "cancelled";
}

export function isTaskWaiting(status: string | null | undefined): boolean {
  const n = normalizeTaskStatus(status);
  return n === "waiting_external" || n === "waiting_internal";
}

export function isTaskBlocked(status: string | null | undefined): boolean {
  return normalizeTaskStatus(status) === "blocked";
}

export function isTaskActiveWork(status: string | null | undefined): boolean {
  const n = normalizeTaskStatus(status);
  return n === "todo" || n === "in_progress";
}

/** Prisma `status: { notIn }` 用开放状态过滤 */
export const CLOSED_TASK_STATUSES: TaskStatusValue[] = ["done", "cancelled"];

export const OPEN_TASK_STATUSES: TaskStatusValue[] = TASK_STATUS_VALUES.filter(
  (s) => !CLOSED_TASK_STATUSES.includes(s),
);

export function taskStatusLabel(status: string | null | undefined): string {
  const n = normalizeTaskStatus(status);
  if (!n) return status || "未知";
  return TASK_STATUS_META[n].label;
}
