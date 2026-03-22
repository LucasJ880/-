import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getMultiProjectProgress } from "@/lib/progress/query";
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
        tasks: {
          select: { status: true },
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

  const projectBreakdown = projectStats.map((p) => {
    const total = p._count.tasks;
    const done = p.tasks.filter((t) => t.status === "done").length;
    const inProg = p.tasks.filter((t) => t.status === "in_progress").length;
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

  const progressIds = projectBreakdown.map((p) => p.id);
  const projectProgressMap = progressIds.length > 0
    ? await getMultiProjectProgress(progressIds)
    : {};

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
