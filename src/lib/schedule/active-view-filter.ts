/**
 * Schedule / 时间轴 Active View 过滤（纯函数，便于单测）
 */

import { isActionableProject } from "@/lib/projects/lifecycle";
import { isReminderReadMarkerKey } from "@/lib/reminders/canonical-key";

export type ScheduleCalendarEventInput = {
  source: string;
  projectId?: string | null;
  taskId?: string | null;
  task?: {
    status: string;
    projectId: string | null;
  } | null;
  project?: {
    status: string;
    abandonedAt?: Date | string | null;
  } | null;
};

export type ScheduleFollowupInput = {
  type?: string;
  status: string;
  sourceKey: string;
  task?: {
    status: string;
    projectId: string | null;
  } | null;
};

/**
 * Calendar Event 是否进入 Active View 时间轴。
 * - Google/个人且无 projectId/taskId → 保留
 * - 关联 done/cancelled 任务 → 隐藏
 * - 关联非 actionable 项目（含 completed/archived/abandoned）→ 隐藏
 */
export function isScheduleCalendarEventVisible(
  ev: ScheduleCalendarEventInput,
  actionableProjectIds: Set<string>
): boolean {
  if (ev.task) {
    if (ev.task.status === "done" || ev.task.status === "cancelled") {
      return false;
    }
    if (
      ev.task.projectId != null &&
      !actionableProjectIds.has(ev.task.projectId)
    ) {
      return false;
    }
  }

  if (ev.projectId) {
    if (ev.project) {
      if (!isActionableProject(ev.project)) return false;
    } else if (!actionableProjectIds.has(ev.projectId)) {
      return false;
    }
  }

  return true;
}

/**
 * Follow-up 是否进入时间轴。
 * - read marker / 非 followup / 非 pending → 隐藏
 * - 关联 done/cancelled 或非 actionable 项目 → 隐藏
 * - 无项目个人 followup → 保留
 */
export function isScheduleFollowupVisible(
  rem: ScheduleFollowupInput,
  actionableProjectIds: Set<string>
): boolean {
  if (isReminderReadMarkerKey(rem.sourceKey)) return false;
  if (rem.type != null && rem.type !== "followup") return false;
  if (rem.status !== "pending") return false;

  if (rem.task) {
    if (rem.task.status === "done" || rem.task.status === "cancelled") {
      return false;
    }
    if (
      rem.task.projectId != null &&
      !actionableProjectIds.has(rem.task.projectId)
    ) {
      return false;
    }
  }

  return true;
}
