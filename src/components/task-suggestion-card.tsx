"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Calendar,
  Flag,
  FolderKanban,
  Bell,
  Loader2,
  ExternalLink,
  Pencil,
} from "lucide-react";
import { cn, TASK_PRIORITY, type TaskPriority } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { TaskSuggestion } from "@/lib/ai";

export interface SimpleProject {
  id: string;
  name: string;
}

interface Props {
  suggestion: TaskSuggestion;
  projects?: SimpleProject[];
  onCreated?: () => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-slate-50 text-slate-600 border-slate-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export function TaskSuggestionCard({ suggestion, projects = [], onCreated }: Props) {
  const [status, setStatus] = useState<
    "pending" | "creating" | "created" | "error"
  >("pending");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    ...suggestion,
    projectId: suggestion.projectId || "",
  });

  const priorityInfo =
    TASK_PRIORITY[form.priority as TaskPriority] || TASK_PRIORITY.medium;

  const selectedProject = projects.find((p) => p.id === form.projectId);
  const displayProjectName = selectedProject?.name || suggestion.project;

  const handleCreate = async () => {
    setStatus("creating");
    try {
      const res = await apiFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          priority: form.priority,
          dueDate: form.dueDate,
          projectId: form.projectId || null,
          needReminder: form.needReminder,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("created");
      onCreated?.();
    } catch {
      setStatus("error");
    }
  };

  if (status === "created") {
    return (
      <div className="my-2 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 size={18} className="text-green-600" />
        <span className="text-sm font-medium text-green-700">
          任务「{form.title}」已创建成功
        </span>
        <Link
          href="/tasks"
          className="ml-auto flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
        >
          查看任务列表 <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-indigo-50/50">
      <div className="flex items-center justify-between border-b border-blue-100 px-4 py-2.5">
        <span className="text-xs font-semibold text-blue-700">
          AI 任务建议
        </span>
        <button
          onClick={() => setEditing(!editing)}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-blue-500 transition-colors hover:bg-blue-100"
        >
          <Pencil size={11} />
          {editing ? "完成编辑" : "修改"}
        </button>
      </div>

      <div className="space-y-3 p-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
            />
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={2}
              className="w-full resize-none rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm({
                    ...form,
                    priority: e.target.value as TaskSuggestion["priority"],
                  })
                }
                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs outline-none"
              >
                <option value="low">低优先级</option>
                <option value="medium">中优先级</option>
                <option value="high">高优先级</option>
                <option value="urgent">紧急</option>
              </select>
              <input
                type="date"
                value={form.dueDate || ""}
                onChange={(e) =>
                  setForm({ ...form, dueDate: e.target.value || null })
                }
                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs outline-none"
              />
              <select
                value={form.projectId}
                onChange={(e) =>
                  setForm({ ...form, projectId: e.target.value })
                }
                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs outline-none"
              >
                <option value="">无所属项目</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-foreground">
              {form.title}
            </h4>
            {form.description && (
              <p className="text-xs leading-relaxed text-muted">
                {form.description}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  PRIORITY_STYLES[form.priority] || PRIORITY_STYLES.medium
                )}
              >
                <Flag size={11} />
                {priorityInfo.label}优先级
              </span>
              {form.dueDate && (
                <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  <Calendar size={11} />
                  {form.dueDate}
                </span>
              )}
              {displayProjectName && (
                <span className="flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-600">
                  <FolderKanban size={11} />
                  {displayProjectName}
                </span>
              )}
              {form.needReminder && (
                <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                  <Bell size={11} />
                  需要提醒
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-blue-100 px-4 py-2.5">
        <button
          onClick={handleCreate}
          disabled={status === "creating" || !form.title.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {status === "creating" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <CheckCircle2 size={13} />
          )}
          {status === "creating" ? "创建中..." : "确认创建任务"}
        </button>
        {status === "error" && (
          <span className="text-xs text-red-500">创建失败，请重试</span>
        )}
      </div>
    </div>
  );
}
