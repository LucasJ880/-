"use client";

import {
  Bot,
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

export function DashboardLinksRecentSection({
  recentTasks,
}: {
  recentTasks: (TaskItem & { updatedAt: string })[];
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Link
          href="/inbox"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-4 transition-shadow hover:shadow-md"
        >
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
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
          <div className="rounded-lg bg-green-50 p-2 text-green-600">
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
          <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
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
          <div className="rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 p-2 text-indigo-600">
            <Bot size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold">AI 助手</p>
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
              return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-background"
                >
                  <div className="min-w-0 flex-1">
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
                    {task.project && (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: task.project.color }}
                        />
                        <span className="text-xs text-muted">
                          {task.project.name}
                        </span>
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                      statusInfo.color
                    )}
                  >
                    {statusInfo.label}
                  </span>
                </Link>
              );
            })
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted">
              暂无任务，去收件箱或 AI 助手开始创建
            </div>
          )}
        </div>
      </div>
    </>
  );
}
