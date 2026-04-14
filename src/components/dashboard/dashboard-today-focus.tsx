"use client";

import Link from "next/link";
import {
  Target,
  CheckSquare,
  Calendar,
  Bell,
  ArrowRight,
  Clock,
  MapPin,
  Sparkles,
} from "lucide-react";
import { cn, TASK_PRIORITY, type TaskPriority } from "@/lib/utils";
import { toToronto, daysRemainingToronto } from "@/lib/time";
import type {
  TaskItem,
  CalendarEventItem,
  ReminderSummaryData,
  ScheduleEvent,
} from "./types";

interface FocusItem {
  id: string;
  type: "task" | "event" | "reminder";
  title: string;
  subtitle: string | null;
  time: string | null;
  sortKey: number;
  priority?: string;
  projectName?: string | null;
  projectColor?: string | null;
  projectId?: string | null;
  href?: string;
  isOverdue?: boolean;
  isAllDay?: boolean;
  location?: string | null;
}

function buildFocusItems(
  highPriorityTasks: TaskItem[],
  upcomingTasks: TaskItem[],
  scheduleEvents: ScheduleEvent[],
  reminderSummary: ReminderSummaryData | null
): FocusItem[] {
  const items: FocusItem[] = [];
  const seen = new Set<string>();

  const todayTasks = [...highPriorityTasks, ...upcomingTasks].filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    if (t.status === "done" || t.status === "cancelled") return false;
    if (!t.dueDate) return t.priority === "urgent" || t.priority === "high";
    const diff = daysRemainingToronto(t.dueDate);
    return diff <= 1;
  });

  for (const t of todayTasks) {
    const diff = t.dueDate ? daysRemainingToronto(t.dueDate) : 99;
    items.push({
      id: `task-${t.id}`,
      type: "task",
      title: t.title,
      subtitle: diff < 0 ? `已逾期 ${Math.abs(diff)} 天` : diff === 0 ? "今天到期" : diff === 1 ? "明天到期" : null,
      time: t.dueDate ? formatTime(t.dueDate) : null,
      sortKey: diff < 0 ? -1000 + diff : diff,
      priority: t.priority,
      projectName: t.project?.name,
      projectColor: t.project?.color,
      projectId: t.projectId || t.project?.id,
      href: `/tasks/${t.id}`,
      isOverdue: diff < 0,
    });
  }

  const todayEvents = scheduleEvents.filter((e) => {
    return e.type === "calendar" && !seen.has(`evt-${e.id}`);
  });

  for (const e of todayEvents) {
    seen.add(`evt-${e.id}`);
    const startDate = new Date(e.startAt);
    items.push({
      id: `evt-${e.id}`,
      type: "event",
      title: e.title,
      subtitle: e.projectName || null,
      time: e.allDay ? "全天" : formatTimeFromDate(startDate),
      sortKey: e.allDay ? -500 : startDate.getHours() * 60 + startDate.getMinutes(),
      projectName: e.projectName,
      projectColor: e.projectColor,
      projectId: e.projectId,
      isAllDay: e.allDay,
      location: e.location,
    });
  }

  if (reminderSummary) {
    const reminders = [...reminderSummary.immediate, ...reminderSummary.today];
    for (const r of reminders) {
      const key = `rem-${r.sourceKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: key,
        type: "reminder",
        title: r.title,
        subtitle: r.subtitle,
        time: null,
        sortKey: r.type === "overdue" ? -900 : 500,
        projectName: r.project?.name,
        projectColor: r.project?.color,
        projectId: r.projectId || r.project?.id,
      });
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items.slice(0, 8);
}

function formatTime(dateStr: string): string {
  const d = toToronto(new Date(dateStr));
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return "";
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatTimeFromDate(d: Date): string {
  const t = toToronto(d);
  return `${t.getHours()}:${t.getMinutes().toString().padStart(2, "0")}`;
}

const TYPE_ICON = {
  task: CheckSquare,
  event: Calendar,
  reminder: Bell,
} as const;

const TYPE_COLOR = {
  task: "text-accent",
  event: "text-[#2e7a56]",
  reminder: "text-[#9a6a2f]",
} as const;

function FocusItemRow({
  item,
  onProjectClick,
}: {
  item: FocusItem;
  onProjectClick?: (id: string) => void;
}) {
  const Icon = TYPE_ICON[item.type];
  const color = TYPE_COLOR[item.type];

  const content = (
    <div className="flex items-center gap-3 px-4 py-2.5 transition-all duration-150 hover:bg-background">
      <div className={cn("shrink-0", color)}>
        <Icon size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-[14px] font-medium tracking-[-0.01em]", item.isOverdue && "text-[#a63d3d]")}>
            {item.title}
          </span>
          {item.priority && (
            <span
              className={cn(
                "shrink-0 rounded-[var(--radius-md)] px-1.5 py-0.5 text-[11px] font-medium tracking-[-0.01em]",
                (TASK_PRIORITY[item.priority as TaskPriority] || TASK_PRIORITY.medium).color
              )}
            >
              {(TASK_PRIORITY[item.priority as TaskPriority] || TASK_PRIORITY.medium).label}
            </span>
          )}
        </div>
        {(item.subtitle || item.location) && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted tracking-[-0.01em]">
            {item.subtitle && <span>{item.subtitle}</span>}
            {item.location && (
              <span className="flex items-center gap-0.5">
                <MapPin size={9} />
                {item.location}
              </span>
            )}
          </div>
        )}
      </div>

      {item.projectName && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (item.projectId && onProjectClick) onProjectClick(item.projectId);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 text-[13px] font-medium tracking-[-0.01em] text-muted shadow-xs transition-all duration-150 hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.projectColor || "#6e7d76" }}
          />
          {item.projectName}
        </button>
      )}

      {item.time && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted tracking-[-0.01em]">
          <Clock size={10} />
          {item.time}
        </span>
      )}
    </div>
  );

  if (item.href) {
    return <Link href={item.href}>{content}</Link>;
  }
  return content;
}

interface Props {
  highPriorityTasks: TaskItem[];
  upcomingTasks: TaskItem[];
  scheduleEvents: ScheduleEvent[];
  reminderSummary: ReminderSummaryData | null;
  onProjectClick?: (id: string) => void;
}

export function DashboardTodayFocus({
  highPriorityTasks,
  upcomingTasks,
  scheduleEvents,
  reminderSummary,
  onProjectClick,
}: Props) {
  const items = buildFocusItems(
    highPriorityTasks,
    upcomingTasks,
    scheduleEvents,
    reminderSummary
  );

  const now = new Date();
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 周${weekday}`;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card-bg shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Target size={15} className="text-accent" />
          <h2 className="text-[13px] font-semibold tracking-[-0.01em]">今日聚焦</h2>
          <span className="text-[12px] text-muted tracking-[-0.01em]">{dateStr}</span>
        </div>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium tracking-[-0.01em] text-accent">
          {items.length} 项待办
        </span>
      </div>

      {items.length > 0 ? (
        <div className="divide-y divide-border/60">
          {items.map((item) => (
            <FocusItemRow
              key={item.id}
              item={item}
              onProjectClick={onProjectClick}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Sparkles size={24} className="text-accent/30" />
          <p className="text-[13px] font-medium tracking-[-0.01em] text-muted">今天暂无紧急事项</p>
          <p className="text-[12px] text-muted/60 tracking-[-0.01em]">
            创建任务或日程后，待办事项会自动出现在这里
          </p>
        </div>
      )}

      <div className="border-t border-border px-4 py-2.5">
        <div className="flex items-center gap-4 text-[12px] tracking-[-0.01em]">
          <Link
            href="/tasks"
            className="flex items-center gap-1 font-medium text-accent transition-all duration-150 hover:underline"
          >
            全部任务 <ArrowRight size={10} />
          </Link>
          <Link
            href="/assistant"
            className="flex items-center gap-1 font-medium text-muted transition-all duration-150 hover:text-foreground"
          >
            AI 助手 <ArrowRight size={10} />
          </Link>
        </div>
      </div>
    </div>
  );
}
