import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { startOfDayToronto, endOfDayToronto } from "@/lib/time";

interface ScheduleEventOut {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  type: "calendar" | "task_due" | "reminder" | "followup";
  source: "local" | "google" | "task" | "system";
  priority: "low" | "medium" | "high" | "urgent";
  status: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  entityType: string | null;
  entityId: string | null;
  taskId: string | null;
  description: string | null;
  location: string | null;
  isEditable: boolean;
  isDeletable: boolean;
}

function mapPriority(p?: string | null): ScheduleEventOut["priority"] {
  if (p === "urgent") return "urgent";
  if (p === "high") return "high";
  if (p === "low") return "low";
  return "medium";
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const dateStr = request.nextUrl.searchParams.get("date");
  const ref = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const dayStart = startOfDayToronto(ref);
  const dayEnd = endOfDayToronto(ref);

  const projectIds = await getVisibleProjectIds(user.id, user.role);

  const [calendarEvents, dueTasks, followupReminders] = await Promise.all([
    db.calendarEvent.findMany({
      where: {
        userId: user.id,
        OR: [
          { startTime: { gte: dayStart, lt: dayEnd } },
          { endTime: { gt: dayStart, lte: dayEnd } },
          { startTime: { lt: dayStart }, endTime: { gt: dayEnd } },
        ],
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            projectId: true,
            project: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: [{ allDay: "desc" }, { startTime: "asc" }],
    }),

    db.task.findMany({
      where: {
        ...(projectIds === null
          ? {}
          : {
              OR: [
                { projectId: { in: projectIds } },
                { projectId: null, creatorId: user.id },
              ],
            }),
        status: { notIn: ["done", "cancelled"] },
        dueDate: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        projectId: true,
        project: { select: { id: true, name: true, color: true } },
      },
      orderBy: { dueDate: "asc" },
    }),

    db.reminder.findMany({
      where: {
        userId: user.id,
        triggerAt: { gte: dayStart, lt: dayEnd },
        status: { not: "dismissed" },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            projectId: true,
            project: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: { triggerAt: "asc" },
    }),
  ]);

  const results: ScheduleEventOut[] = [];

  for (const ev of calendarEvents) {
    const isGoogle = ev.source === "google";
    results.push({
      id: `cal_${ev.id}`,
      title: ev.title,
      startAt: ev.startTime.toISOString(),
      endAt: ev.endTime.toISOString(),
      allDay: ev.allDay,
      type: "calendar",
      source: isGoogle ? "google" : "local",
      priority: ev.task ? mapPriority(ev.task.priority) : "medium",
      status: ev.task?.status ?? null,
      projectId: ev.task?.projectId ?? null,
      projectName: ev.task?.project?.name ?? null,
      projectColor: ev.task?.project?.color ?? null,
      entityType: "calendar_event",
      entityId: ev.id,
      taskId: ev.task?.id ?? null,
      description: ev.description,
      location: ev.location,
      isEditable: !isGoogle,
      isDeletable: !isGoogle,
    });
  }

  const calTaskIds = new Set(
    calendarEvents.filter((e) => e.taskId).map((e) => e.taskId)
  );
  for (const task of dueTasks) {
    if (calTaskIds.has(task.id)) continue;
    const due = task.dueDate!;
    const endAt = new Date(due.getTime() + 30 * 60_000);
    results.push({
      id: `task_${task.id}`,
      title: `截止：${task.title}`,
      startAt: due.toISOString(),
      endAt: endAt.toISOString(),
      allDay: false,
      type: "task_due",
      source: "task",
      priority: mapPriority(task.priority),
      status: task.status,
      projectId: task.projectId,
      projectName: task.project?.name ?? null,
      projectColor: task.project?.color ?? null,
      entityType: "task",
      entityId: task.id,
      taskId: task.id,
      description: null,
      location: null,
      isEditable: false,
      isDeletable: false,
    });
  }

  for (const rem of followupReminders) {
    const start = rem.triggerAt;
    const end = new Date(start.getTime() + 15 * 60_000);
    results.push({
      id: `rem_${rem.id}`,
      title: rem.title || "跟进提醒",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      allDay: false,
      type: "followup",
      source: "system",
      priority: rem.task ? mapPriority(rem.task.priority) : "medium",
      status: rem.status,
      projectId: rem.task?.projectId ?? null,
      projectName: rem.task?.project?.name ?? null,
      projectColor: rem.task?.project?.color ?? null,
      entityType: rem.taskId ? "task" : "reminder",
      entityId: rem.taskId ?? rem.id,
      taskId: rem.taskId,
      description: rem.message,
      location: null,
      isEditable: false,
      isDeletable: false,
    });
  }

  results.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  });

  return NextResponse.json(results);
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
