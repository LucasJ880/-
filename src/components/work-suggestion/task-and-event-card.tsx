"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Calendar,
  Flag,
  FolderKanban,
  Loader2,
  ExternalLink,
  Pencil,
  Clock,
  MapPin,
  Link2,
} from "lucide-react";
import { cn, TASK_PRIORITY, type TaskPriority } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { TaskSuggestion, EventSuggestion } from "@/lib/ai/schemas";
import { PRIORITY_STYLES, type SimpleProject } from "./types";
import { formatTime, formatDateLabel } from "./utils";

type ComboStatus =
  | "pending"
  | "creating_task"
  | "creating_event"
  | "done"
  | "task_ok_event_fail"
  | "all_fail";

export function TaskAndEventCard({
  taskSuggestion,
  eventSuggestion,
  projects,
  onCreated,
}: {
  taskSuggestion: TaskSuggestion;
  eventSuggestion: EventSuggestion;
  projects: SimpleProject[];
  onCreated?: () => void;
}) {
  const [status, setStatus] = useState<ComboStatus>("pending");
  const [taskEditing, setTaskEditing] = useState(false);
  const [eventEditing, setEventEditing] = useState(false);

  const [taskForm, setTaskForm] = useState({
    ...taskSuggestion,
    projectId: taskSuggestion.projectId || "",
  });
  const [eventForm, setEventForm] = useState({
    title: eventSuggestion.title,
    date: eventSuggestion.startTime?.split("T")[0] || "",
    startTime: formatTime(eventSuggestion.startTime) || "09:00",
    endTime: formatTime(eventSuggestion.endTime) || "10:00",
    allDay: eventSuggestion.allDay,
    location: eventSuggestion.location || "",
  });

  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  const priorityInfo = TASK_PRIORITY[taskForm.priority as TaskPriority] || TASK_PRIORITY.medium;
  const selectedProject = projects.find((p) => p.id === taskForm.projectId);
  const displayProjectName = selectedProject?.name || taskSuggestion.project;

  const buildEventPayload = (taskId?: string) => {
    const payload: Record<string, unknown> = {
      title: eventForm.title,
      allDay: eventForm.allDay,
      location: eventForm.location || null,
    };
    if (taskId) payload.taskId = taskId;
    if (eventForm.allDay) {
      payload.startTime = `${eventForm.date}T00:00:00`;
      payload.endTime = `${eventForm.date}T23:59:59`;
    } else {
      payload.startTime = `${eventForm.date}T${eventForm.startTime}:00`;
      payload.endTime = `${eventForm.date}T${eventForm.endTime}:00`;
    }
    return payload;
  };

  const handleCreate = async () => {
    setStatus("creating_task");
    let taskId: string | null = null;

    try {
      const taskRes = await apiFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskForm.title,
          description: taskForm.description,
          priority: taskForm.priority,
          dueDate: taskForm.dueDate,
          projectId: taskForm.projectId || null,
          needReminder: taskForm.needReminder,
        }),
      });
      if (!taskRes.ok) throw new Error("task_fail");
      const taskData = await taskRes.json();
      taskId = taskData.id;
      setCreatedTaskId(taskId);
    } catch {
      setStatus("all_fail");
      return;
    }

    setStatus("creating_event");
    try {
      const eventRes = await apiFetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEventPayload(taskId!)),
      });
      if (!eventRes.ok) throw new Error("event_fail");
      setStatus("done");
      onCreated?.();
    } catch {
      setStatus("task_ok_event_fail");
    }
  };

  const handleRetryEvent = async () => {
    if (!createdTaskId) return;
    setStatus("creating_event");
    try {
      const eventRes = await apiFetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEventPayload(createdTaskId)),
      });
      if (!eventRes.ok) throw new Error();
      setStatus("done");
      onCreated?.();
    } catch {
      setStatus("task_ok_event_fail");
    }
  };

  if (status === "done") {
    return (
      <div className="my-2 flex items-center gap-3 rounded-xl border border-success/15 bg-success-bg px-4 py-3">
        <CheckCircle2 size={18} className="text-success" />
        <span className="text-sm font-medium text-success">
          任务「{taskForm.title}」+ 日程「{eventForm.title}」已创建并关联
        </span>
        <Link href="/tasks" className="ml-auto flex items-center gap-1 text-xs text-success hover:text-success">
          查看 <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  const isCreating = status === "creating_task" || status === "creating_event";

  return (
    <div className="my-2 space-y-0 rounded-xl border border-info/15 bg-gradient-to-br from-[rgba(128,80,120,0.03)] to-accent-soft/30">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-info/10 px-4 py-2.5">
        <Link2 size={13} className="text-info" />
        <span className="text-xs font-semibold text-info">AI 识别到一个任务 + 一个关联日程</span>
      </div>

      {/* Task Section */}
      <div className="border-b border-info/10">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
            <CheckCircle2 size={12} /> 任务
          </span>
          <button
            onClick={() => setTaskEditing(!taskEditing)}
            disabled={isCreating}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            <Pencil size={10} /> {taskEditing ? "完成" : "修改"}
          </button>
        </div>
        <div className="space-y-2 px-4 pb-3">
          {taskEditing ? (
            <div className="space-y-2">
              <input
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                className="w-full rounded-lg border border-accent/15 bg-card-bg px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
              />
              <textarea
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                rows={2}
                className="w-full resize-none rounded-lg border border-accent/15 bg-card-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as TaskSuggestion["priority"] })}
                  className="rounded-lg border border-accent/15 bg-card-bg px-2 py-1 text-xs outline-none"
                >
                  <option value="low">低优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="high">高优先级</option>
                  <option value="urgent">紧急</option>
                </select>
                <input
                  type="date"
                  value={taskForm.dueDate || ""}
                  onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value || null })}
                  className="rounded-lg border border-accent/15 bg-card-bg px-2 py-1 text-xs outline-none"
                />
                <select
                  value={taskForm.projectId}
                  onChange={(e) => setTaskForm({ ...taskForm, projectId: e.target.value })}
                  className="rounded-lg border border-accent/15 bg-card-bg px-2 py-1 text-xs outline-none"
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
              <h4 className="text-sm font-semibold text-foreground">{taskForm.title}</h4>
              {taskForm.description && (
                <p className="text-xs leading-relaxed text-muted">{taskForm.description}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", PRIORITY_STYLES[taskForm.priority] || PRIORITY_STYLES.medium)}>
                  <Flag size={10} /> {priorityInfo.label}
                </span>
                {taskForm.dueDate && (
                  <span className="flex items-center gap-1 rounded-full border border-muted/15 bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                    <Calendar size={10} /> {taskForm.dueDate}
                  </span>
                )}
                {displayProjectName && (
                  <span className="flex items-center gap-1 rounded-full border border-info/15 bg-info-bg px-2 py-0.5 text-[11px] font-medium text-info">
                    <FolderKanban size={10} /> {displayProjectName}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Event Section */}
      <div className={cn(status === "task_ok_event_fail" && "ring-1 ring-[rgba(166,61,61,0.15)] rounded-b-xl")}>
        <div className="flex items-center justify-between px-4 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
            <Calendar size={12} /> 日程
          </span>
          <button
            onClick={() => setEventEditing(!eventEditing)}
            disabled={isCreating}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-success transition-colors hover:bg-success-bg disabled:opacity-40"
          >
            <Pencil size={10} /> {eventEditing ? "完成" : "修改"}
          </button>
        </div>
        <div className="space-y-2 px-4 pb-3">
          {eventEditing ? (
            <div className="space-y-2">
              <input
                value={eventForm.title}
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                className="w-full rounded-lg border border-success/15 bg-card-bg px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={eventForm.date}
                  onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                  className="rounded-lg border border-success/15 bg-card-bg px-2 py-1 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => setEventForm({ ...eventForm, allDay: !eventForm.allDay })}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs transition-colors",
                    eventForm.allDay ? "border-accent bg-accent/5 font-medium text-accent" : "border-success/15 text-muted"
                  )}
                >
                  {eventForm.allDay ? "✓ 全天" : "全天"}
                </button>
              </div>
              {!eventForm.allDay && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="time"
                    value={eventForm.startTime}
                    onChange={(e) => setEventForm({ ...eventForm, startTime: e.target.value })}
                    className="rounded-lg border border-success/15 bg-card-bg px-2 py-1 text-xs outline-none"
                  />
                  <input
                    type="time"
                    value={eventForm.endTime}
                    onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
                    className="rounded-lg border border-success/15 bg-card-bg px-2 py-1 text-xs outline-none"
                  />
                </div>
              )}
              <input
                value={eventForm.location}
                onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                placeholder="地点（可选）"
                className="w-full rounded-lg border border-success/15 bg-card-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
          ) : (
            <>
              <h4 className="text-sm font-semibold text-foreground">{eventForm.title}</h4>
              <div className="flex flex-wrap gap-1.5">
                <span className="flex items-center gap-1 rounded-full border border-success/15 bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
                  <Calendar size={10} /> {formatDateLabel(eventForm.date ? `${eventForm.date}T00:00` : eventSuggestion.startTime)}
                </span>
                <span className="flex items-center gap-1 rounded-full border border-muted/15 bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                  <Clock size={10} /> {eventForm.allDay ? "全天" : `${eventForm.startTime} - ${eventForm.endTime}`}
                </span>
                {eventForm.location && (
                  <span className="flex items-center gap-1 rounded-full border border-muted/15 bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                    <MapPin size={10} /> {eventForm.location}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-info/10 px-4 py-2.5">
        {status === "task_ok_event_fail" ? (
          <>
            <span className="text-xs text-warning">任务已创建，日程创建失败</span>
            <button
              onClick={handleRetryEvent}
              className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition-colors hover:bg-success/90"
            >
              <Calendar size={12} /> 重试创建日程
            </button>
          </>
        ) : status === "all_fail" ? (
          <>
            <span className="text-xs text-danger">创建失败，请重试</span>
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover"
            >
              <Link2 size={12} /> 重试
            </button>
          </>
        ) : (
          <button
            onClick={handleCreate}
            disabled={isCreating || !taskForm.title.trim() || !eventForm.title.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-info px-3.5 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition-colors hover:bg-info/90 disabled:opacity-50"
          >
            {isCreating ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {status === "creating_task" ? "创建任务中..." : "创建日程中..."}
              </>
            ) : (
              <>
                <Link2 size={13} /> 一键创建任务 + 日程
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
