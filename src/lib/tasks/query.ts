/**
 * Task 列表查询：可见性 + 我的/团队 + 筛选
 */

import type { Prisma } from "@prisma/client";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { endOfDayToronto, startOfDayToronto } from "@/lib/time";
import {
  CLOSED_TASK_STATUSES,
  isTaskOpen,
  normalizeTaskStatus,
  OPEN_TASK_STATUSES,
  type TaskStatusValue,
} from "./status";

export type TaskListView = "mine" | "team";

export type TaskProjectDomainFilter =
  | "delivery"
  | "tender"
  | "general"
  | "unassigned";

export type TaskListFilters = {
  view: TaskListView;
  status?: string | null;
  /** overdue | today | upcoming | none */
  due?: string | null;
  assigneeId?: string | null;
  projectId?: string | null;
  /**
   * 通过关联 Project.workDomain 筛选；无 projectId → unassigned
   * 不写入 Task 自身字段
   */
  projectDomain?: TaskProjectDomainFilter | null;
  search?: string | null;
  /** waiting | blocked | open | closed */
  bucket?: string | null;
  priority?: string | null;
  page?: number;
  pageSize?: number;
};

export const TASK_PAGE_SIZE_MAX = 50;
export const TASK_PAGE_SIZE_DEFAULT = 30;

export function clampPageSize(raw: number | undefined): number {
  if (!raw || !Number.isFinite(raw)) return TASK_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(1, Math.floor(raw)), TASK_PAGE_SIZE_MAX);
}

export async function buildTaskVisibilityWhere(
  userId: string,
  role: string,
  ownOnly: boolean,
): Promise<Prisma.TaskWhereInput> {
  const visible = await getVisibleProjectIds(userId, role);

  const baseVisibility: Prisma.TaskWhereInput =
    visible === null
      ? {}
      : {
          OR: [
            { projectId: { in: visible } },
            { projectId: null, creatorId: userId },
            { assigneeId: userId },
          ],
        };

  if (!ownOnly) return baseVisibility;

  return {
    AND: [
      baseVisibility,
      {
        OR: [
          { assigneeId: userId },
          { assigneeId: null, creatorId: userId },
        ],
      },
    ],
  };
}

export function buildTaskFilterWhere(
  filters: TaskListFilters,
  now = new Date(),
): Prisma.TaskWhereInput {
  const parts: Prisma.TaskWhereInput[] = [];
  const todayStart = startOfDayToronto(now);
  const todayEnd = endOfDayToronto(now);

  if (filters.status) {
    const statuses = filters.status
      .split(",")
      .map((s) => normalizeTaskStatus(s))
      .filter((s): s is TaskStatusValue => Boolean(s));
    if (statuses.length === 1) parts.push({ status: statuses[0] });
    else if (statuses.length > 1) parts.push({ status: { in: statuses } });
  }

  if (filters.bucket === "open") {
    parts.push({ status: { in: [...OPEN_TASK_STATUSES] } });
  } else if (filters.bucket === "closed") {
    parts.push({ status: { in: [...CLOSED_TASK_STATUSES] } });
  } else if (filters.bucket === "waiting") {
    parts.push({
      status: { in: ["waiting_external", "waiting_internal"] },
    });
  } else if (filters.bucket === "blocked") {
    parts.push({ status: "blocked" });
  }

  if (filters.due === "overdue") {
    parts.push({
      status: { in: [...OPEN_TASK_STATUSES] },
      dueDate: { lt: todayStart },
    });
  } else if (filters.due === "today") {
    parts.push({
      status: { in: [...OPEN_TASK_STATUSES] },
      dueDate: { gte: todayStart, lte: todayEnd },
    });
  } else if (filters.due === "upcoming") {
    parts.push({
      status: { in: [...OPEN_TASK_STATUSES] },
      dueDate: { gt: todayEnd },
    });
  } else if (filters.due === "none") {
    parts.push({ dueDate: null, status: { in: [...OPEN_TASK_STATUSES] } });
  }

  if (filters.assigneeId) {
    parts.push({ assigneeId: filters.assigneeId });
  }

  if (filters.projectId) {
    parts.push({ projectId: filters.projectId });
  }

  if (filters.projectDomain === "unassigned") {
    parts.push({ projectId: null });
  } else if (
    filters.projectDomain === "delivery" ||
    filters.projectDomain === "tender" ||
    filters.projectDomain === "general"
  ) {
    parts.push({
      project: { workDomain: filters.projectDomain },
    });
  }

  if (filters.priority) {
    parts.push({ priority: filters.priority });
  }

  const q = filters.search?.trim();
  if (q) {
    parts.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { waitingOn: { contains: q, mode: "insensitive" } },
        { blockedReason: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (!parts.length) return {};
  return { AND: parts };
}

export function mergeTaskWhere(
  ...parts: Prisma.TaskWhereInput[]
): Prisma.TaskWhereInput {
  const filtered = parts.filter((p) => Object.keys(p).length > 0);
  if (!filtered.length) return {};
  if (filtered.length === 1) return filtered[0]!;
  return { AND: filtered };
}

/** 最近完成窗口 */
export function recentCompletedWhere(now = new Date(), days = 7): Prisma.TaskWhereInput {
  const since = new Date(now.getTime() - days * 86_400_000);
  return {
    status: { in: [...CLOSED_TASK_STATUSES] },
    OR: [
      { completedAt: { gte: since } },
      { completedAt: null, updatedAt: { gte: since } },
    ],
  };
}

export function isOpenStatusString(status: string): boolean {
  return isTaskOpen(status);
}
