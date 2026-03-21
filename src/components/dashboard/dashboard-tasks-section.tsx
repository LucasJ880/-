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

  let style = "border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] text-[#6e7d76]";
  let label = formatDate(dueDate);
  if (diff < 0) {
    style = "border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] text-[#a63d3d]";
    label = `已逾期 ${Math.abs(diff)} 天`;
  } else if (diff === 0) {
    style = "border-[rgba(176,106,40,0.15)] bg-[rgba(176,106,40,0.04)] text-[#b06a28]";
    label = "今天到期";
  } else if (diff === 1) {
    style = "border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] text-[#9a6a2f]";
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

function TaskRow({
  task,
  onProjectClick,
}: {
  task: TaskItem;
  onProjectClick?: (projectId: string) => void;
}) {
  const priorityInfo =
    TASK_PRIORITY[task.priority as TaskPriority] || TASK_PRIORITY.medium;
  const projectId = task.projectId || task.project?.id;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background">
      <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1">
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
      </Link>
      {task.project && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (projectId && onProjectClick) onProjectClick(projectId);
          }}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted transition-colors",
            onProjectClick && projectId && "hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
          )}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: task.project.color }}
          />
          {task.project.name}
        </button>
      )}
      <DueBadge dueDate={task.dueDate} />
    </div>
  );
}

interface Props {
  highPriorityTasks: TaskItem[];
  upcomingTasks: TaskItem[];
  onProjectClick?: (projectId: string) => void;
}

export function DashboardTasksSection({ highPriorityTasks, upcomingTasks, onProjectClick }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Flag size={14} className="text-[#b06a28]" />
          <h2 className="text-sm font-semibold">高优先级任务</h2>
          <span className="ml-auto text-xs text-muted">
            {highPriorityTasks.length} 项
          </span>
        </div>
        <div className="divide-y divide-border">
          {highPriorityTasks.length > 0 ? (
            highPriorityTasks.map((t) => (
              <TaskRow key={t.id} task={t} onProjectClick={onProjectClick} />
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted">
              没有高优先级待办，很好！
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertTriangle size={14} className="text-[#9a6a2f]" />
          <h2 className="text-sm font-semibold">即将到期</h2>
          <span className="ml-auto text-xs text-muted">未来 3 天内</span>
        </div>
        <div className="divide-y divide-border">
          {upcomingTasks.length > 0 ? (
            upcomingTasks.map((t) => (
              <TaskRow key={t.id} task={t} onProjectClick={onProjectClick} />
            ))
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
