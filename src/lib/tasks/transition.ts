/**
 * Task 状态转换（服务端唯一入口）
 */

import {
  assertTaskStatus,
  isTaskCompleted,
  normalizeTaskStatus,
  type TaskStatusValue,
} from "./status";

export type TaskTransitionInput = {
  currentStatus: string;
  nextStatus: string;
  blockedReason?: string | null;
  waitingOn?: string | null;
  waitingUntil?: Date | string | null;
  /** 当前任务已有字段，用于未传时保留 */
  existing?: {
    blockedReason?: string | null;
    waitingOn?: string | null;
    waitingUntil?: Date | null;
  };
};

export type TaskTransitionResult =
  | {
      ok: true;
      status: TaskStatusValue;
      completedAt: Date | null;
      blockedReason: string | null;
      waitingOn: string | null;
      waitingUntil: Date | null;
    }
  | { ok: false; error: string; code: string };

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value === undefined) return null;
  if (value === null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function transitionTaskStatus(
  input: TaskTransitionInput,
): TaskTransitionResult {
  const next = normalizeTaskStatus(input.nextStatus);
  if (!next) {
    return { ok: false, error: "无效的任务状态", code: "INVALID_STATUS" };
  }

  const current = normalizeTaskStatus(input.currentStatus) ?? "todo";
  void current; // 允许任意→任意（权限层另控），校验侧车字段

  let blockedReason =
    input.blockedReason !== undefined
      ? (input.blockedReason?.trim() || null)
      : (input.existing?.blockedReason ?? null);
  let waitingOn =
    input.waitingOn !== undefined
      ? (input.waitingOn?.trim() || null)
      : (input.existing?.waitingOn ?? null);
  let waitingUntil =
    input.waitingUntil !== undefined
      ? parseDate(input.waitingUntil)
      : (input.existing?.waitingUntil ?? null);

  if (next === "blocked") {
    if (!blockedReason) {
      return {
        ok: false,
        error: "切换为阻塞时必须填写阻塞原因",
        code: "BLOCKED_REASON_REQUIRED",
      };
    }
    waitingOn = null;
    waitingUntil = null;
  } else if (next === "waiting_external" || next === "waiting_internal") {
    if (!waitingOn) {
      return {
        ok: false,
        error: "切换为等待状态时必须填写等待对象",
        code: "WAITING_ON_REQUIRED",
      };
    }
    blockedReason = null;
  } else {
    // 离开阻塞/等待：清理当前界面原因，避免过期展示
    blockedReason = null;
    waitingOn = null;
    waitingUntil = null;
  }

  const completedAt = next === "done" ? new Date() : null;

  return {
    ok: true,
    status: next,
    completedAt,
    blockedReason,
    waitingOn,
    waitingUntil,
  };
}

export function validateStoredStatus(value: string): TaskStatusValue {
  return assertTaskStatus(value);
}

export function wasCompleted(status: string): boolean {
  return isTaskCompleted(status);
}
