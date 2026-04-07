import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getWeekRangeToronto, endOfDayToronto } from "@/lib/time";
import { getVisibleProjectIds } from "@/lib/projects/visibility";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

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

  const projectProgressMap: Record<string, unknown> = {};

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
}
