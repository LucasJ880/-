import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getWeekRangeToronto, endOfDayToronto } from "@/lib/time";
import { getVisibleProjectIds } from "@/lib/projects/visibility";

export const GET = withAuth(async (_request, _ctx, user) => {
  const { weekStart, weekEnd } = getWeekRangeToronto();
  const now = new Date();
  const threeDaysRef = new Date(now.getTime() + 3 * 86_400_000);
  const threeDaysLater = endOfDayToronto(threeDaysRef);

  const projectIds = await getVisibleProjectIds(user.id, user.role);

  const taskScope =
    projectIds === null
      ? {}
      : {
          OR: [
            { projectId: { in: projectIds } },
            { projectId: null, creatorId: user.id },
          ],
        };

  const projectScope =
    projectIds === null ? {} : { id: { in: projectIds } };

  const [
    totalTasks,
    todoCount,
    inProgressCount,
    doneCount,
    totalProjects,
    weekCreated,
    weekCompleted,
    overdueCount,
    highPriorityTasks,
    upcomingTasks,
    projectStats,
    recentTasks,
  ] = await Promise.all([
    db.task.count({ where: taskScope }),
    db.task.count({ where: { ...taskScope, status: "todo" } }),
    db.task.count({ where: { ...taskScope, status: "in_progress" } }),
    db.task.count({ where: { ...taskScope, status: "done" } }),
    projectIds === null
      ? db.project.count()
      : Promise.resolve(projectIds.length),

    db.task.count({
      where: { ...taskScope, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    db.task.count({
      where: {
        ...taskScope,
        status: "done",
        updatedAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    db.task.count({
      where: {
        ...taskScope,
        status: { notIn: ["done", "cancelled"] },
        dueDate: { lt: now },
      },
    }),

    db.task.findMany({
      where: {
        ...taskScope,
        priority: { in: ["high", "urgent"] },
        status: { notIn: ["done", "cancelled"] },
      },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        dueDate: true,
        projectId: true,
        project: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 6,
    }),

    db.task.findMany({
      where: {
        ...taskScope,
        status: { notIn: ["done", "cancelled"] },
        dueDate: { gte: now, lte: threeDaysLater },
      },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        dueDate: true,
        projectId: true,
        project: { select: { id: true, name: true, color: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),

    db.project.findMany({
      where: { ...projectScope, status: "active" },
      select: {
        id: true,
        name: true,
        color: true,
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),

    db.task.findMany({
      where: taskScope,
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: {
        project: { select: { id: true, name: true, color: true } },
      },
    }),
  ]);

  const projectIds8 = projectStats.map((p) => p.id);

  const taskStatusCounts = projectIds8.length > 0
    ? await db.task.groupBy({
        by: ["projectId", "status"],
        where: { projectId: { in: projectIds8 } },
        _count: true,
      })
    : [];

  const statusMap = new Map<string, Record<string, number>>();
  for (const row of taskStatusCounts) {
    if (!row.projectId) continue;
    if (!statusMap.has(row.projectId)) statusMap.set(row.projectId, {});
    statusMap.get(row.projectId)![row.status] = row._count;
  }

  const projectBreakdown = projectStats.map((p) => {
    const counts = statusMap.get(p.id) ?? {};
    const done = counts["done"] ?? 0;
    const inProg = counts["in_progress"] ?? 0;
    const total = p._count.tasks;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      total,
      done,
      inProgress: inProg,
      todo: total - done - inProg,
    };
  });

  const projectProgressMap: Record<string, {
    taskProgress: number;
    completedTasks: number;
    totalTasks: number;
    timeProgress: number;
    daysRemaining: number;
    daysTotal: number;
    riskLevel: string;
    riskLabel: string | null;
    isOverdue: boolean;
    isAtRisk: boolean;
    weekDelta: number;
    currentStage: string;
    startDate: string | null;
    dueDate: string | null;
    daysElapsed: number;
    stages: { key: string; label: string; status: "done" | "current" | "pending" }[];
  }> = {};

  const projectDates = projectIds8.length > 0
    ? await db.project.findMany({
        where: { id: { in: projectIds8 } },
        select: { id: true, startDate: true, dueDate: true, closeDate: true, createdAt: true },
      })
    : [];
  const projectDateMap = new Map(projectDates.map((p) => [p.id, p]));

  for (const pb of projectBreakdown) {
    const dates = projectDateMap.get(pb.id);
    const taskPct = pb.total > 0 ? Math.round((pb.done / pb.total) * 100) : 0;

    const start = dates?.startDate ?? dates?.createdAt ?? null;
    const due = dates?.dueDate ?? dates?.closeDate ?? null;
    let timePct = 0;
    let daysTotal = 0;
    let daysElapsed = 0;
    let daysRemaining = 0;
    let isOverdue = false;

    if (start && due) {
      const startMs = new Date(start).getTime();
      const dueMs = new Date(due).getTime();
      const nowMs = now.getTime();
      daysTotal = Math.max(1, Math.round((dueMs - startMs) / 86_400_000));
      daysElapsed = Math.round((nowMs - startMs) / 86_400_000);
      daysRemaining = Math.max(0, Math.round((dueMs - nowMs) / 86_400_000));
      timePct = Math.min(100, Math.round((daysElapsed / daysTotal) * 100));
      isOverdue = nowMs > dueMs;
    }

    const gap = timePct - taskPct;
    let riskLevel = "none";
    let riskLabel: string | null = null;
    if (isOverdue && taskPct < 100) {
      riskLevel = "high";
      riskLabel = "项目已逾期";
    } else if (gap >= 30) {
      riskLevel = "high";
      riskLabel = "进度严重落后";
    } else if (gap >= 15) {
      riskLevel = "medium";
      riskLabel = "进度略有落后";
    } else if (gap >= 5) {
      riskLevel = "low";
      riskLabel = null;
    }

    projectProgressMap[pb.id] = {
      taskProgress: taskPct,
      completedTasks: pb.done,
      totalTasks: pb.total,
      timeProgress: timePct,
      daysRemaining,
      daysTotal,
      riskLevel,
      riskLabel,
      isOverdue,
      isAtRisk: riskLevel === "high" || riskLevel === "medium",
      weekDelta: 0,
      currentStage: taskPct >= 100 ? "completed" : taskPct > 0 ? "in_progress" : "planning",
      startDate: start ? new Date(start).toISOString() : null,
      dueDate: due ? new Date(due).toISOString() : null,
      daysElapsed,
      stages: [],
    };
  }

  let pendingDispatchCount = 0;
  if (isSuperAdmin(user.role)) {
    pendingDispatchCount = await db.project.count({
      where: { intakeStatus: "pending_dispatch" },
    });
  }

  return NextResponse.json({
    totalTasks,
    todoCount,
    inProgressCount,
    doneCount,
    totalProjects,
    week: {
      created: weekCreated,
      completed: weekCompleted,
      overdue: overdueCount,
      active: inProgressCount,
    },
    highPriorityTasks,
    upcomingTasks,
    projectBreakdown,
    projectProgress: projectProgressMap,
    recentTasks,
    pendingDispatchCount,
  });
});
