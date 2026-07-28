/**
 * 工作队列分组（/tasks 与 /ops 共用）
 */

import { endOfDayToronto, startOfDayToronto } from "@/lib/time";
import {
  isTaskActiveWork,
  isTaskBlocked,
  isTaskCompleted,
  isTaskOpen,
  isTaskWaiting,
  normalizeTaskStatus,
} from "./status";

export type WorkQueueGroupKey =
  | "urgent"
  | "active"
  | "waiting"
  | "blocked"
  | "recent_done";

export type GroupableTask = {
  id: string;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  waitingUntil?: Date | string | null;
  updatedAt: Date | string;
  completedAt?: Date | string | null;
};

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function priorityWeight(p: string): number {
  const w: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return w[p] ?? 2;
}

function overdueDays(due: Date, todayStart: Date): number {
  return Math.max(
    0,
    Math.floor((todayStart.getTime() - due.getTime()) / 86_400_000),
  );
}

export function isWaitingUntilDue(
  waitingUntil: Date | string | null | undefined,
  now: Date,
): boolean {
  const d = asDate(waitingUntil);
  if (!d) return false;
  return d.getTime() <= now.getTime();
}

export function isUrgentTask(task: GroupableTask, now = new Date()): boolean {
  if (!isTaskOpen(task.status)) return false;
  const todayStart = startOfDayToronto(now);
  const todayEnd = endOfDayToronto(now);
  const due = asDate(task.dueDate);

  if (isTaskBlocked(task.status)) return true;
  if (normalizeTaskStatus(task.status) === "needs_approval") return true;
  if (due && due.getTime() < todayStart.getTime()) return true;
  if (due && due.getTime() >= todayStart.getTime() && due.getTime() <= todayEnd.getTime()) {
    return true;
  }
  if (isTaskWaiting(task.status) && isWaitingUntilDue(task.waitingUntil, now)) {
    return true;
  }
  return false;
}

export function classifyWorkQueueGroup(
  task: GroupableTask,
  now = new Date(),
): WorkQueueGroupKey | null {
  if (isTaskCompleted(task.status)) return "recent_done";
  if (isUrgentTask(task, now)) return "urgent";
  if (isTaskBlocked(task.status)) return "blocked";
  if (isTaskWaiting(task.status)) return "waiting";
  if (isTaskActiveWork(task.status)) return "active";
  return "active";
}

export function sortUrgentTasks<T extends GroupableTask>(
  tasks: T[],
  now = new Date(),
): T[] {
  const todayStart = startOfDayToronto(now);
  return [...tasks].sort((a, b) => {
    const aDue = asDate(a.dueDate);
    const bDue = asDate(b.dueDate);
    const aOver =
      aDue && aDue < todayStart ? overdueDays(aDue, todayStart) : -1;
    const bOver =
      bDue && bDue < todayStart ? overdueDays(bDue, todayStart) : -1;
    if (aOver !== bOver) return bOver - aOver;

    const aBlocked = isTaskBlocked(a.status) ? 1 : 0;
    const bBlocked = isTaskBlocked(b.status) ? 1 : 0;
    if (aBlocked !== bBlocked) return bBlocked - aBlocked;

    const aToday =
      aDue &&
      aDue >= todayStart &&
      aDue <= endOfDayToronto(now)
        ? 1
        : 0;
    const bToday =
      bDue &&
      bDue >= todayStart &&
      bDue <= endOfDayToronto(now)
        ? 1
        : 0;
    if (aToday !== bToday) return bToday - aToday;

    const aAppr =
      normalizeTaskStatus(a.status) === "needs_approval" ? 1 : 0;
    const bAppr =
      normalizeTaskStatus(b.status) === "needs_approval" ? 1 : 0;
    if (aAppr !== bAppr) return bAppr - aAppr;

    const pw = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (pw !== 0) return pw;

    return (
      (asDate(b.updatedAt)?.getTime() ?? 0) -
      (asDate(a.updatedAt)?.getTime() ?? 0)
    );
  });
}

export function partitionWorkQueue<T extends GroupableTask>(
  tasks: T[],
  now = new Date(),
): Record<WorkQueueGroupKey, T[]> {
  const out: Record<WorkQueueGroupKey, T[]> = {
    urgent: [],
    active: [],
    waiting: [],
    blocked: [],
    recent_done: [],
  };

  for (const t of tasks) {
    const g = classifyWorkQueueGroup(t, now);
    if (!g) continue;
    // urgent 优先；blocked/waiting 若已进 urgent 不再重复
    if (g === "urgent") {
      out.urgent.push(t);
      continue;
    }
    if (g === "blocked" && isUrgentTask(t, now)) {
      out.urgent.push(t);
      continue;
    }
    out[g].push(t);
  }

  out.urgent = sortUrgentTasks(out.urgent, now);
  out.active.sort(
    (a, b) =>
      priorityWeight(a.priority) - priorityWeight(b.priority) ||
      (asDate(b.updatedAt)?.getTime() ?? 0) -
        (asDate(a.updatedAt)?.getTime() ?? 0),
  );
  out.waiting.sort(
    (a, b) =>
      (asDate(a.waitingUntil)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (asDate(b.waitingUntil)?.getTime() ?? Number.MAX_SAFE_INTEGER),
  );
  out.blocked.sort(
    (a, b) =>
      (asDate(b.updatedAt)?.getTime() ?? 0) -
      (asDate(a.updatedAt)?.getTime() ?? 0),
  );
  out.recent_done.sort(
    (a, b) =>
      (asDate(b.completedAt)?.getTime() ??
        asDate(b.updatedAt)?.getTime() ??
        0) -
      (asDate(a.completedAt)?.getTime() ??
        asDate(a.updatedAt)?.getTime() ??
        0),
  );

  return out;
}
