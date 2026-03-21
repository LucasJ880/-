import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";

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

async function getVisibleProjectIds(userId: string, role: string) {
  if (isSuperAdmin(role)) return null;

  const orgMemberships = await db.organizationMember.findMany({
    where: { userId, status: "active" },
    select: { orgId: true },
  });
  const orgIds = orgMemberships.map((m) => m.orgId);

  const projects = await db.project.findMany({
    where: {
      OR: [
        { ownerId: userId, orgId: null },
        ...(orgIds.length ? [{ orgId: { in: orgIds } }] : []),
        { members: { some: { userId, status: "active" } } },
      ],
    },
    select: { id: true },
  });

  return projects.map((p) => p.id);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { weekStart, weekEnd } = getWeekRange();
  const now = new Date();
  const threeDaysLater = new Date(now);
  threeDaysLater.setDate(now.getDate() + 3);
  threeDaysLater.setHours(23, 59, 59, 999);

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
