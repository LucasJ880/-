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
import type { TaskSuggestion } from "@/lib/ai/schemas";
import { PRIORITY_STYLES, type SimpleProject } from "./types";

export function TaskCard({
  suggestion,
  projects,
  onCreated,
}: {
  suggestion: TaskSuggestion;
  projects: SimpleProject[];
  onCreated?: () => void;
}) {
  const [status, setStatus] = useState<"pending" | "creating" | "created" | "error">("pending");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...suggestion, projectId: suggestion.projectId || "" });

  const priorityInfo = TASK_PRIORITY[form.priority as TaskPriority] || TASK_PRIORITY.medium;
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
      <div className="my-2 flex items-center gap-3 rounded-xl border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)] px-4 py-3">
        <CheckCircle2 size={18} className="text-[#2e7a56]" />
        <span className="text-sm font-medium text-[#2e7a56]">
          任务「{form.title}」已创建成功
        </span>
        <Link href="/tasks" className="ml-auto flex items-center gap-1 text-xs text-[#2e7a56] hover:text-[#2e7a56]">
          查看任务列表 <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(43,96,85,0.15)] bg-gradient-to-br from-[rgba(43,96,85,0.03)] to-[rgba(43,96,85,0.02)]">
      <div className="flex items-center justify-between border-b border-[rgba(43,96,85,0.08)] px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[#2b6055]">
          <CheckCircle2 size={13} />
          AI 任务建议
        </span>
        <button
          onClick={() => setEditing(!editing)}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#2b6055] transition-colors hover:bg-[rgba(43,96,85,0.08)]"
        >
          <Pencil size={11} />
          {editing ? "完成" : "修改"}
        </button>
      </div>

      <div className="space-y-3 p-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full resize-none rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskSuggestion["priority"] })}
                className="rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-2 py-1 text-xs outline-none"
              >
                <option value="low">低优先级</option>
                <option value="medium">中优先级</option>
                <option value="high">高优先级</option>
                <option value="urgent">紧急</option>
              </select>
              <input
                type="date"
                value={form.dueDate || ""}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value || null })}
                className="rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-2 py-1 text-xs outline-none"
              />
              <select
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                className="rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-2 py-1 text-xs outline-none"
              >
                <option value="">无所属项目</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-foreground">{form.title}</h4>
            {form.description && (
              <p className="text-xs leading-relaxed text-muted">{form.description}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", PRIORITY_STYLES[form.priority] || PRIORITY_STYLES.medium)}>
                <Flag size={11} />
                {priorityInfo.label}优先级
              </span>
              {form.dueDate && (
                <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                  <Calendar size={11} />
                  {form.dueDate}
                </span>
              )}
              {displayProjectName && (
                <span className="flex items-center gap-1 rounded-full border border-[rgba(128,80,120,0.15)] bg-[rgba(128,80,120,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#805078]">
                  <FolderKanban size={11} />
                  {displayProjectName}
                </span>
              )}
              {form.needReminder && (
                <span className="flex items-center gap-1 rounded-full border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#9a6a2f]">
                  <Bell size={11} />
                  需要提醒
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[rgba(43,96,85,0.08)] px-4 py-2.5">
        <button
          onClick={handleCreate}
          disabled={status === "creating" || !form.title.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {status === "creating" ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          {status === "creating" ? "创建中..." : "确认创建任务"}
        </button>
        {status === "error" && <span className="text-xs text-[#a63d3d]">创建失败，请重试</span>}
      </div>
    </div>
  );
}
