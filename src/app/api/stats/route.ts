import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { myTasksWhere } from "@/lib/tasks/access";
import { visibleProjectsWhere } from "@/lib/projects/visibility";

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);

  return { weekStart: monday, weekEnd: sunday };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const mine = myTasksWhere(user.id);
  const visibleProjects = await visibleProjectsWhere(user);

  const { weekStart, weekEnd } = getWeekRange();

  const now = new Date();
  const threeDaysLater = new Date(now);
  threeDaysLater.setDate(now.getDate() + 3);
  threeDaysLater.setHours(23, 59, 59, 999);

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
    db.task.count({ where: mine }),
    db.task.count({ where: { ...mine, status: "todo" } }),
    db.task.count({ where: { ...mine, status: "in_progress" } }),
    db.task.count({ where: { ...mine, status: "done" } }),
    db.project.count({ where: visibleProjects }),

    db.task.count({
      where: { ...mine, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    db.task.count({
      where: {
        ...mine,
        status: "done",
        updatedAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    db.task.count({
      where: {
        ...mine,
        status: { notIn: ["done", "cancelled"] },
        dueDate: { lt: now },
      },
    }),

    db.task.findMany({
      where: {
        ...mine,
        priority: { in: ["high", "urgent"] },
        status: { notIn: ["done", "cancelled"] },
      },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        dueDate: true,
        project: { select: { name: true, color: true } },
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 6,
    }),

    db.task.findMany({
      where: {
        ...mine,
        status: { notIn: ["done", "cancelled"] },
        dueDate: { gte: now, lte: threeDaysLater },
      },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        dueDate: true,
        project: { select: { name: true, color: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),

    db.project.findMany({
      where: { ...visibleProjects, status: "active" },
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
      where: mine,
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: {
        project: { select: { name: true, color: true } },
      },
    }),
  ]);

  const projectBreakdown = projectStats.map((p) => {
    const total = p._count.tasks;
    const done = p.tasks.filter((t) => t.status === "done").length;
    const inProgress = p.tasks.filter((t) => t.status === "in_progress").length;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      total,
      done,
      inProgress,
      todo: total - done - inProgress,
    };
  });

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
    recentTasks,
  });
}
