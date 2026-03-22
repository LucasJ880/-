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
  Clock,
  MapPin,
  Link2,
} from "lucide-react";
import { cn, TASK_PRIORITY, type TaskPriority } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { WorkSuggestion, TaskSuggestion, EventSuggestion } from "@/lib/ai";

export interface SimpleProject {
  id: string;
  name: string;
}

interface Props {
  suggestion: WorkSuggestion;
  projects?: SimpleProject[];
  onCreated?: () => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-[rgba(110,125,118,0.06)] text-[#6e7d76] border-[rgba(110,125,118,0.15)]",
  medium: "bg-[rgba(154,106,47,0.04)] text-[#9a6a2f] border-[rgba(154,106,47,0.15)]",
  high: "bg-[rgba(176,106,40,0.04)] text-[#b06a28] border-[rgba(176,106,40,0.15)]",
  urgent: "bg-[rgba(166,61,61,0.04)] text-[#a63d3d] border-[rgba(166,61,61,0.15)]",
};

/* ── Task Card ── */

function TaskCard({
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

/* ── Event Card ── */

function formatTime(iso: string) {
  if (!iso) return "";
  const idx = iso.indexOf("T");
  return idx !== -1 ? iso.substring(idx + 1, idx + 6) : "";
}

function formatDateLabel(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "America/Toronto" });
  } catch {
    return iso.split("T")[0];
  }
}

function EventCard({
  suggestion,
  onCreated,
}: {
  suggestion: EventSuggestion;
  onCreated?: () => void;
}) {
  const [status, setStatus] = useState<"pending" | "creating" | "created" | "error">("pending");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: suggestion.title,
    date: suggestion.startTime?.split("T")[0] || "",
    startTime: formatTime(suggestion.startTime) || "09:00",
    endTime: formatTime(suggestion.endTime) || "10:00",
    allDay: suggestion.allDay,
    location: suggestion.location || "",
  });

  const handleCreate = async () => {
    setStatus("creating");
    const payload: Record<string, unknown> = {
      title: form.title,
      allDay: form.allDay,
      location: form.location || null,
    };
    if (form.allDay) {
      payload.startTime = `${form.date}T00:00:00`;
      payload.endTime = `${form.date}T23:59:59`;
    } else {
      payload.startTime = `${form.date}T${form.startTime}:00`;
      payload.endTime = `${form.date}T${form.endTime}:00`;
    }
    try {
      const res = await apiFetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
          日程「{form.title}」已创建成功
        </span>
        <Link href="/" className="ml-auto flex items-center gap-1 text-xs text-[#2e7a56] hover:text-[#2e7a56]">
          查看工作台 <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(46,122,86,0.15)] bg-gradient-to-br from-[rgba(46,122,86,0.03)] to-[rgba(46,122,86,0.02)]">
      <div className="flex items-center justify-between border-b border-[rgba(46,122,86,0.08)] px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[#2e7a56]">
          <Calendar size={13} />
          AI 日程建议
        </span>
        <button
          onClick={() => setEditing(!editing)}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#2e7a56] transition-colors hover:bg-[rgba(46,122,86,0.08)]"
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
              className="w-full rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-2 py-1 text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, allDay: !form.allDay })}
                className={cn(
                  "rounded-lg border px-2 py-1 text-xs transition-colors",
                  form.allDay ? "border-accent bg-accent/5 font-medium text-accent" : "border-[rgba(46,122,86,0.15)] text-muted"
                )}
              >
                {form.allDay ? "✓ 全天" : "全天"}
              </button>
            </div>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-2 py-1 text-xs outline-none"
                />
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-2 py-1 text-xs outline-none"
                />
              </div>
            )}
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="地点（可选）"
              className="w-full rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-foreground">{form.title}</h4>
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1 rounded-full border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#2e7a56]">
                <Calendar size={11} />
                {formatDateLabel(form.date ? `${form.date}T00:00` : suggestion.startTime)}
              </span>
              <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                <Clock size={11} />
                {form.allDay ? "全天" : `${form.startTime} - ${form.endTime}`}
              </span>
              {form.location && (
                <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                  <MapPin size={11} />
                  {form.location}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[rgba(46,122,86,0.08)] px-4 py-2.5">
        <button
          onClick={handleCreate}
          disabled={status === "creating" || !form.title.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[#2e7a56] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2e7a56]/90 disabled:opacity-50"
        >
          {status === "creating" ? <Loader2 size={13} className="animate-spin" /> : <Calendar size={13} />}
          {status === "creating" ? "创建中..." : "确认创建日程"}
        </button>
        {status === "error" && <span className="text-xs text-[#a63d3d]">创建失败，请重试</span>}
      </div>
    </div>
  );
}

/* ── Task + Event Combined Card ── */

type ComboStatus =
  | "pending"
  | "creating_task"
  | "creating_event"
  | "done"
  | "task_ok_event_fail"
  | "all_fail";

function TaskAndEventCard({
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
      <div className="my-2 flex items-center gap-3 rounded-xl border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)] px-4 py-3">
        <CheckCircle2 size={18} className="text-[#2e7a56]" />
        <span className="text-sm font-medium text-[#2e7a56]">
          任务「{taskForm.title}」+ 日程「{eventForm.title}」已创建并关联
        </span>
        <Link href="/tasks" className="ml-auto flex items-center gap-1 text-xs text-[#2e7a56] hover:text-[#2e7a56]">
          查看 <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  const isCreating = status === "creating_task" || status === "creating_event";

  return (
    <div className="my-2 space-y-0 rounded-xl border border-[rgba(128,80,120,0.15)] bg-gradient-to-br from-[rgba(128,80,120,0.03)] to-[rgba(43,96,85,0.02)]">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-[rgba(128,80,120,0.08)] px-4 py-2.5">
        <Link2 size={13} className="text-[#805078]" />
        <span className="text-xs font-semibold text-[#805078]">AI 识别到一个任务 + 一个关联日程</span>
      </div>

      {/* Task Section */}
      <div className="border-b border-[rgba(128,80,120,0.08)]">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#2b6055]">
            <CheckCircle2 size={12} /> 任务
          </span>
          <button
            onClick={() => setTaskEditing(!taskEditing)}
            disabled={isCreating}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#2b6055] transition-colors hover:bg-[rgba(43,96,85,0.04)] disabled:opacity-40"
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
                className="w-full rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
              />
              <textarea
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                rows={2}
                className="w-full resize-none rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as TaskSuggestion["priority"] })}
                  className="rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-2 py-1 text-xs outline-none"
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
                  className="rounded-lg border border-[rgba(43,96,85,0.15)] bg-white px-2 py-1 text-xs outline-none"
                />
                <select
                  value={taskForm.projectId}
                  onChange={(e) => setTaskForm({ ...taskForm, projectId: e.target.value })}
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
              <h4 className="text-sm font-semibold text-foreground">{taskForm.title}</h4>
              {taskForm.description && (
                <p className="text-xs leading-relaxed text-muted">{taskForm.description}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", PRIORITY_STYLES[taskForm.priority] || PRIORITY_STYLES.medium)}>
                  <Flag size={10} /> {priorityInfo.label}
                </span>
                {taskForm.dueDate && (
                  <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                    <Calendar size={10} /> {taskForm.dueDate}
                  </span>
                )}
                {displayProjectName && (
                  <span className="flex items-center gap-1 rounded-full border border-[rgba(128,80,120,0.15)] bg-[rgba(128,80,120,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#805078]">
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
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#2e7a56]">
            <Calendar size={12} /> 日程
          </span>
          <button
            onClick={() => setEventEditing(!eventEditing)}
            disabled={isCreating}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#2e7a56] transition-colors hover:bg-[rgba(46,122,86,0.04)] disabled:opacity-40"
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
                className="w-full rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={eventForm.date}
                  onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                  className="rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-2 py-1 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => setEventForm({ ...eventForm, allDay: !eventForm.allDay })}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs transition-colors",
                    eventForm.allDay ? "border-accent bg-accent/5 font-medium text-accent" : "border-[rgba(46,122,86,0.15)] text-muted"
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
                    className="rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-2 py-1 text-xs outline-none"
                  />
                  <input
                    type="time"
                    value={eventForm.endTime}
                    onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
                    className="rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-2 py-1 text-xs outline-none"
                  />
                </div>
              )}
              <input
                value={eventForm.location}
                onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                placeholder="地点（可选）"
                className="w-full rounded-lg border border-[rgba(46,122,86,0.15)] bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
          ) : (
            <>
              <h4 className="text-sm font-semibold text-foreground">{eventForm.title}</h4>
              <div className="flex flex-wrap gap-1.5">
                <span className="flex items-center gap-1 rounded-full border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#2e7a56]">
                  <Calendar size={10} /> {formatDateLabel(eventForm.date ? `${eventForm.date}T00:00` : eventSuggestion.startTime)}
                </span>
                <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                  <Clock size={10} /> {eventForm.allDay ? "全天" : `${eventForm.startTime} - ${eventForm.endTime}`}
                </span>
                {eventForm.location && (
                  <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                    <MapPin size={10} /> {eventForm.location}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-[rgba(128,80,120,0.08)] px-4 py-2.5">
        {status === "task_ok_event_fail" ? (
          <>
            <span className="text-xs text-[#9a6a2f]">任务已创建，日程创建失败</span>
            <button
              onClick={handleRetryEvent}
              className="flex items-center gap-1.5 rounded-lg bg-[#2e7a56] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2e7a56]/90"
            >
              <Calendar size={12} /> 重试创建日程
            </button>
          </>
        ) : status === "all_fail" ? (
          <>
            <span className="text-xs text-[#a63d3d]">创建失败，请重试</span>
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <Link2 size={12} /> 重试
            </button>
          </>
        ) : (
          <button
            onClick={handleCreate}
            disabled={isCreating || !taskForm.title.trim() || !eventForm.title.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-[#805078] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#805078]/90 disabled:opacity-50"
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

/* ── Unified Entry ── */

export function WorkSuggestionCard({ suggestion, projects = [], onCreated }: Props) {
  if (suggestion.type === "task_and_event" && suggestion.task && suggestion.event) {
    return (
      <TaskAndEventCard
        taskSuggestion={suggestion.task}
        eventSuggestion={suggestion.event}
        projects={projects}
        onCreated={onCreated}
      />
    );
  }
  if (suggestion.type === "event" && suggestion.event) {
    return <EventCard suggestion={suggestion.event} onCreated={onCreated} />;
  }
  if (suggestion.type === "task" && suggestion.task) {
    return <TaskCard suggestion={suggestion.task} projects={projects} onCreated={onCreated} />;
  }
  return null;
}
