"use client";

import { useState, useMemo } from "react";
import {
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  ListTodo,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import {
  cn,
  TASK_PRIORITY,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/utils";
import type { TaskItem, ProjectBreakdown } from "./types";
import { daysRemainingToronto, toToronto } from "@/lib/time";
import { apiFetch } from "@/lib/api-fetch";

interface TimeGroup {
  key: string;
  label: string;
  tasks: TaskItem[];
  isOverdue?: boolean;
}

function groupByTime(tasks: TaskItem[]): TimeGroup[] {
  const overdue: TaskItem[] = [];
  const today: TaskItem[] = [];
  const thisWeek: TaskItem[] = [];
  const later: TaskItem[] = [];

  for (const t of tasks) {
    if (t.status === "done" || t.status === "cancelled") continue;
    if (!t.dueDate) {
      later.push(t);
      continue;
    }
    const diff = daysRemainingToronto(t.dueDate);
    if (diff < 0) overdue.push(t);
    else if (diff === 0) today.push(t);
    else if (diff <= 6) thisWeek.push(t);
    else later.push(t);
  }

  const groups: TimeGroup[] = [];
  if (overdue.length) groups.push({ key: "overdue", label: "逾期", tasks: overdue, isOverdue: true });
  if (today.length) groups.push({ key: "today", label: "今天", tasks: today });
  if (thisWeek.length) groups.push({ key: "week", label: "本周", tasks: thisWeek });
  if (later.length) groups.push({ key: "later", label: "稍后", tasks: later });
  return groups;
}

function formatDue(dueDate: string | null): string {
  if (!dueDate) return "";
  const diff = daysRemainingToronto(dueDate);
  if (diff < 0) return `逾期${Math.abs(diff)}天`;
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  const t = toToronto(new Date(dueDate));
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][t.getDay()];
  if (diff <= 6) return weekday;
  return `${t.getMonth() + 1}/${t.getDate()}`;
}

function TaskCheckButton({
  task,
  onToggle,
}: {
  task: TaskItem;
  onToggle: (id: string, newStatus: TaskStatus) => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle(task.id, task.status === "done" ? "todo" : "done");
  };

  if (task.status === "done") {
    return <button onClick={handleClick} className="shrink-0 text-[#2e7a56]"><CheckCircle2 size={16} /></button>;
  }
  if (task.status === "in_progress") {
    return <button onClick={handleClick} className="shrink-0 text-[#2b6055]"><Clock size={16} /></button>;
  }
  return (
    <button onClick={handleClick} className="shrink-0 text-border transition-colors hover:text-[#2e7a56]">
      <Circle size={16} />
    </button>
  );
}

function DashboardTaskRow({
  task,
  onTaskClick,
  onToggle,
  onProjectClick,
}: {
  task: TaskItem;
  onTaskClick?: (taskId: string) => void;
  onToggle: (id: string, newStatus: TaskStatus) => void;
  onProjectClick?: (projectId: string) => void;
}) {
  const due = formatDue(task.dueDate);
  const isOverdue = task.dueDate && daysRemainingToronto(task.dueDate) < 0 && task.status !== "done" && task.status !== "cancelled";
  const showPriority = task.priority === "urgent" || task.priority === "high";
  const priorityInfo = TASK_PRIORITY[task.priority as TaskPriority] || TASK_PRIORITY.medium;

  return (
    <div className="group flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-background">
      <TaskCheckButton task={task} onToggle={onToggle} />

      <button
        onClick={() => onTaskClick?.(task.id)}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm font-medium transition-colors hover:text-accent",
          task.status === "done" && "text-muted line-through"
        )}
      >
        {task.title}
      </button>

      <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
        {task.project && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const pid = task.projectId || task.project?.id;
              if (pid && onProjectClick) onProjectClick(pid);
            }}
            className="flex items-center gap-1 text-muted hover:text-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: task.project.color }} />
            <span className="max-w-[60px] truncate">{task.project.name}</span>
          </button>
        )}
        {due && (
          <span className={cn("whitespace-nowrap", isOverdue ? "text-[#a63d3d] font-medium" : "text-muted")}>
            {due}
          </span>
        )}
        {showPriority && (
          <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", priorityInfo.color)}>
            {priorityInfo.label}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  highPriorityTasks: TaskItem[];
  upcomingTasks: TaskItem[];
  projectBreakdown?: ProjectBreakdown[];
  onProjectClick?: (projectId: string) => void;
  onTaskClick?: (taskId: string) => void;
}

export function DashboardTasksSection({
  highPriorityTasks,
  upcomingTasks,
  projectBreakdown,
  onProjectClick,
  onTaskClick,
}: Props) {
  const [localTasks, setLocalTasks] = useState<Map<string, TaskStatus>>(new Map());

  const allTasks = useMemo(() => {
    const merged = new Map<string, TaskItem>();
    for (const t of [...highPriorityTasks, ...upcomingTasks]) {
      if (!merged.has(t.id)) merged.set(t.id, t);
    }
    return Array.from(merged.values()).map((t) => ({
      ...t,
      status: localTasks.get(t.id) ?? t.status,
    }));
  }, [highPriorityTasks, upcomingTasks, localTasks]);

  const activeTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const groups = useMemo(() => groupByTime(activeTasks), [activeTasks]);

  const handleToggle = async (id: string, newStatus: TaskStatus) => {
    setLocalTasks((prev) => new Map(prev).set(id, newStatus));
    await apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const activeProjects = projectBreakdown?.filter((p) => p.total > 0).slice(0, 4);

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ListTodo size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">待办事项</h2>
        <span className="ml-auto text-xs text-muted">
          {activeTasks.length} 项
        </span>
        <Link href="/tasks" className="flex items-center gap-0.5 text-xs text-accent hover:underline">
          全部 <ChevronRight size={12} />
        </Link>
      </div>

      {/* Task timeline groups */}
      {groups.length > 0 ? (
        <div className="divide-y divide-border">
          {groups.map((group) => (
            <div key={group.key}>
              <div className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium",
                group.isOverdue ? "text-[#a63d3d] bg-[rgba(166,61,61,0.03)]" : "text-muted"
              )}>
                {group.isOverdue && <AlertTriangle size={11} />}
                {group.label}
                <span className="text-[10px] opacity-60 ml-1">{group.tasks.length}</span>
              </div>
              <div className="divide-y divide-border/50">
                {group.tasks.slice(0, 3).map((t) => (
                  <DashboardTaskRow
                    key={t.id}
                    task={t}
                    onTaskClick={onTaskClick}
                    onToggle={handleToggle}
                    onProjectClick={onProjectClick}
                  />
                ))}
                {group.tasks.length > 3 && (
                  <div className="px-4 py-1.5 text-xs text-muted">
                    +{group.tasks.length - 3} 项更多
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted">
          没有待办事项，干得漂亮！
        </div>
      )}

      {/* Project progress summary */}
      {activeProjects && activeProjects.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 text-xs font-medium text-muted">项目进度</div>
          <div className="space-y-2">
            {activeProjects.map((p) => {
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <button
                  key={p.id}
                  onClick={() => onProjectClick?.(p.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-background"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="flex-1 truncate text-xs font-medium">{p.name}</span>
                  <div className="h-1.5 w-20 rounded-full bg-border/50">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[11px] text-muted">{pct}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
