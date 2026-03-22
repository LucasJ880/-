/**
 * 提醒生成引擎
 *
 * P0 策略：deadline / event 即时计算，不写库；
 * followup 从 Reminder 表读取；read 状态统一通过 sourceKey 查 Reminder 表。
 */

import { db } from "@/lib/db";
import {
  startOfDayToronto,
  endOfDayToronto,
  formatHHmmToronto,
} from "@/lib/time";

// ─── Types ─────────────────────────────────────────────────────

export interface ReminderItem {
  sourceKey: string;
  type: "deadline" | "event" | "followup";
  title: string;
  subtitle: string;
  priority?: string;
  taskId?: string | null;
  eventId?: string | null;
  projectId?: string | null;
  isRead: boolean;
  notify: boolean;
  project?: { id?: string; name: string; color: string } | null;
  location?: string | null;
}

export interface ReminderLayers {
  immediate: ReminderItem[];
  today: ReminderItem[];
  upcoming: ReminderItem[];
  unreadCount: number;
}

// ─── Helpers ───────────────────────────────────────────────────

function fmtTime(iso: Date): string {
  return formatHHmmToronto(iso);
}

function daysBetween(a: Date, b: Date): number {
  const aStart = startOfDayToronto(a);
  const bStart = startOfDayToronto(b);
  return Math.round((bStart.getTime() - aStart.getTime()) / 86_400_000);
}

// ─── Core ──────────────────────────────────────────────────────

export async function generateReminderLayers(
  userId: string
): Promise<ReminderLayers> {
  const now = new Date();

  const todayStart = startOfDayToronto(now);
  const todayEnd = endOfDayToronto(now);

  const tomorrowRef = new Date(now.getTime() + 86_400_000);
  const tomorrowEnd = endOfDayToronto(tomorrowRef);

  const soonEnd = new Date(now.getTime() + 60 * 60_000);
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);

  const taskSelect = {
    id: true,
    title: true,
    priority: true,
    dueDate: true,
    projectId: true,
    project: { select: { id: true, name: true, color: true } },
  } as const;

  const [
    overdueTasks,
    todayTasks,
    tomorrowTasks,
    todayEvents,
    followups,
    readRecords,
  ] = await Promise.all([
    db.task.findMany({
      where: { status: { notIn: ["done", "cancelled"] }, dueDate: { lt: todayStart } },
      select: taskSelect,
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    db.task.findMany({
      where: { status: { notIn: ["done", "cancelled"] }, dueDate: { gte: todayStart, lt: todayEnd } },
      select: taskSelect,
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 20,
    }),
    db.task.findMany({
      where: { status: { notIn: ["done", "cancelled"] }, dueDate: { gte: todayEnd, lt: tomorrowEnd } },
      select: taskSelect,
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 20,
    }),
    db.calendarEvent.findMany({
      where: {
        userId,
        source: "qingyan",
        endTime: { gt: now },
        startTime: { lt: todayEnd },
      },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        allDay: true,
        location: true,
        reminderMinutes: true,
        task: { select: { id: true } },
      },
      orderBy: { startTime: "asc" },
      take: 20,
    }),
    db.reminder.findMany({
      where: { userId, type: "followup", status: "pending", triggerAt: { lte: weekEnd } },
      select: {
        id: true,
        sourceKey: true,
        title: true,
        message: true,
        triggerAt: true,
        taskId: true,
        task: { select: { projectId: true, project: { select: { id: true, name: true, color: true } } } },
      },
      orderBy: { triggerAt: "asc" },
    }),
    db.reminder.findMany({
      where: { userId, status: "read" },
      select: { sourceKey: true },
    }),
  ]);

  const readSet = new Set(readRecords.map((r) => r.sourceKey));

  const immediate: ReminderItem[] = [];
  const today: ReminderItem[] = [];
  const upcoming: ReminderItem[] = [];

  // ── Overdue tasks → immediate ──
  for (const t of overdueTasks) {
    const key = `deadline:overdue:${t.id}`;
    if (readSet.has(key)) continue;
    const days = daysBetween(new Date(t.dueDate!), todayStart);
    immediate.push({
      sourceKey: key,
      type: "deadline",
      title: t.title,
      subtitle: `已逾期 ${days} 天`,
      priority: t.priority,
      taskId: t.id,
      projectId: t.projectId,
      isRead: false,
      notify: false,
      project: t.project,
    });
  }

  // ── Today events → immediate or today ──
  for (const e of todayEvents) {
    const key = `event:today:${e.id}`;
    if (readSet.has(key)) continue;
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    const isSoon = !e.allDay && start.getTime() <= soonEnd.getTime();
    const minsUntil = Math.round((start.getTime() - now.getTime()) / 60_000);
    const shouldNotify =
      !e.allDay &&
      minsUntil > 0 &&
      minsUntil <= (e.reminderMinutes ?? 15);

    const subtitle = e.allDay
      ? "全天"
      : `${fmtTime(start)} - ${fmtTime(end)}`;

    const item: ReminderItem = {
      sourceKey: key,
      type: "event",
      title: e.title,
      subtitle,
      taskId: e.task?.id ?? null,
      eventId: e.id,
      isRead: false,
      notify: shouldNotify,
      location: e.location,
    };

    if (isSoon) {
      immediate.push(item);
    } else {
      today.push(item);
    }
  }

  // ── Today deadline tasks → today ──
  for (const t of todayTasks) {
    const key = `deadline:today:${t.id}`;
    if (readSet.has(key)) continue;
    today.push({
      sourceKey: key,
      type: "deadline",
      title: t.title,
      subtitle: "今天截止",
      priority: t.priority,
      taskId: t.id,
      projectId: t.projectId,
      isRead: false,
      notify: false,
      project: t.project,
    });
  }

  // ── Tomorrow deadline tasks → upcoming ──
  for (const t of tomorrowTasks) {
    const key = `deadline:tomorrow:${t.id}`;
    if (readSet.has(key)) continue;
    upcoming.push({
      sourceKey: key,
      type: "deadline",
      title: t.title,
      subtitle: "明天截止",
      priority: t.priority,
      taskId: t.id,
      projectId: t.projectId,
      isRead: false,
      notify: false,
      project: t.project,
    });
  }

  // ── Followup reminders → immediate / today / upcoming ──
  for (const f of followups) {
    const triggerMs = new Date(f.triggerAt).getTime();
    const isPastDue = triggerMs <= now.getTime();
    const isToday =
      triggerMs > now.getTime() &&
      triggerMs < todayEnd.getTime();

    const item: ReminderItem = {
      sourceKey: f.sourceKey,
      type: "followup",
      title: f.title,
      subtitle: f.message || "跟进提醒",
      taskId: f.taskId,
      projectId: f.task?.projectId ?? null,
      isRead: false,
      notify: isPastDue,
      project: f.task?.project ?? null,
    };

    if (isPastDue) {
      immediate.push(item);
    } else if (isToday) {
      today.push(item);
    } else {
      upcoming.push(item);
    }
  }

  const unreadCount = immediate.length + today.length + upcoming.length;

  return { immediate, today, upcoming, unreadCount };
}
