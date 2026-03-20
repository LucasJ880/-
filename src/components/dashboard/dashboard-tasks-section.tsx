"use client";

import { CalendarClock, Flag, AlertTriangle } from "lucide-react";
import Link from "next/link";
import {
  cn,
  TASK_PRIORITY,
  type TaskPriority,
} from "@/lib/utils";
import type { TaskItem } from "./types";

function formatDate(d: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function DueBadge({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);

  let style = "border-slate-200 bg-slate-50 text-slate-600";
  let label = formatDate(dueDate);
  if (diff < 0) {
    style = "border-red-200 bg-red-50 text-red-600";
    label = `已逾期 ${Math.abs(diff)} 天`;
  } else if (diff === 0) {
    style = "border-orange-200 bg-orange-50 text-orange-600";
    label = "今天到期";
  } else if (diff === 1) {
    style = "border-amber-200 bg-amber-50 text-amber-600";
    label = "明天到期";
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        style
      )}
    >
      <CalendarClock size={10} />
      {label}
    </span>
  );
}

function TaskRow({ task }: { task: TaskItem }) {
  const priorityInfo =
    TASK_PRIORITY[task.priority as TaskPriority] || TASK_PRIORITY.medium;
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{task.title}</span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              priorityInfo.color
            )}
          >
            {priorityInfo.label}
          </span>
        </div>
        {task.project && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: task.project.color }}
            />
            <span className="text-[11px] text-muted">{task.project.name}</span>
          </div>
        )}
      </div>
      <DueBadge dueDate={task.dueDate} />
    </Link>
  );
}

export function DashboardTasksSection({
  highPriorityTasks,
  upcomingTasks,
}: {
  highPriorityTasks: TaskItem[];
  upcomingTasks: TaskItem[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Flag size={14} className="text-orange-500" />
          <h2 className="text-sm font-semibold">高优先级任务</h2>
          <span className="ml-auto text-xs text-muted">
            {highPriorityTasks.length} 项
          </span>
        </div>
        <div className="divide-y divide-border">
          {highPriorityTasks.length > 0 ? (
            highPriorityTasks.map((t) => <TaskRow key={t.id} task={t} />)
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted">
              没有高优先级待办，很好！
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertTriangle size={14} className="text-amber-500" />
          <h2 className="text-sm font-semibold">即将到期</h2>
          <span className="ml-auto text-xs text-muted">未来 3 天内</span>
        </div>
        <div className="divide-y divide-border">
          {upcomingTasks.length > 0 ? (
            upcomingTasks.map((t) => <TaskRow key={t.id} task={t} />)
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted">
              近期没有即将到期的任务
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
