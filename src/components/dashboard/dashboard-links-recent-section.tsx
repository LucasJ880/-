"use client";

import {
  MessagesSquare,
  FolderKanban,
  Inbox,
  Plus,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";
import type { TaskItem } from "./types";

interface Props {
  recentTasks: (TaskItem & { updatedAt: string })[];
  onProjectClick?: (projectId: string) => void;
}

export function DashboardLinksRecentSection({ recentTasks, onProjectClick }: Props) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Link
          href="/inbox"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-4 transition-shadow hover:shadow-md"
        >
          <div className="rounded-lg bg-accent-soft p-2 text-accent">
            <Inbox size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold">收件箱</p>
            <p className="text-[11px] text-muted">快速记录事项</p>
          </div>
        </Link>
        <Link
          href="/tasks"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-4 transition-shadow hover:shadow-md"
        >
          <div className="rounded-lg bg-success-bg p-2 text-success">
            <Plus size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold">新建任务</p>
            <p className="text-[11px] text-muted">手动添加任务</p>
          </div>
        </Link>
        <Link
          href="/projects"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-4 transition-shadow hover:shadow-md"
        >
          <div className="rounded-lg bg-info-bg p-2 text-info">
            <FolderKanban size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold">管理项目</p>
            <p className="text-[11px] text-muted">查看所有项目</p>
          </div>
        </Link>
        <Link
          href="/assistant"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-4 transition-shadow hover:shadow-md"
        >
          <div className="rounded-lg bg-accent-soft p-2 text-accent">
            <MessagesSquare size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold">协同空间</p>
            <p className="text-[11px] text-muted">对话式协作</p>
          </div>
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold">最近更新</h2>
          <Link
            href="/tasks"
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
          >
            查看全部 <ArrowRight size={12} />
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recentTasks.length > 0 ? (
            recentTasks.map((task) => {
              const statusInfo =
                TASK_STATUS[task.status as TaskStatus] || TASK_STATUS.todo;
              const priorityInfo =
                TASK_PRIORITY[task.priority as TaskPriority] ||
                TASK_PRIORITY.medium;
              const projectId = task.projectId || task.project?.id;

              return (
                <div
                  key={task.id}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-background"
                >
                  <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {task.title}
                      </p>
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
                      onClick={() => {
                        if (projectId && onProjectClick) onProjectClick(projectId);
                      }}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition-colors",
                        onProjectClick && projectId && "hover:bg-accent-soft hover:text-foreground"
                      )}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: task.project.color }}
                      />
                      {task.project.name}
                    </button>
                  )}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                      statusInfo.color
                    )}
                  >
                    {statusInfo.label}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted">
              暂无任务，可从收件箱或协同空间开始创建
            </div>
          )}
        </div>
      </div>
    </>
  );
}
