"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Flag,
  FolderKanban,
  Bell,
  BellOff,
  Pencil,
  Loader2,
  Send,
  MessageSquare,
  Activity,
  Clock,
  CheckCircle2,
  Circle,
  XCircle,
  User,
  AlertTriangle,
  CalendarClock,
  Plus,
  MapPin,
  Trash2,
  X,
} from "lucide-react";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

/* ── Types ── */

interface CalendarEventBrief {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  needReminder: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string } | null;
  calendarEvents?: CalendarEventBrief[];
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string };
}

interface ActivityItem {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
  actor: { id: string; name: string };
}

interface SimpleProject {
  id: string;
  name: string;
}

/* ── Helpers ── */

const STATUS_ICONS: Record<string, typeof Circle> = {
  todo: Circle,
  in_progress: Clock,
  done: CheckCircle2,
  cancelled: XCircle,
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDueStatus(dueDate: string | null, status: string) {
  if (!dueDate || status === "done" || status === "cancelled") return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (diff < 0)
    return {
      label: `已逾期 ${Math.abs(diff)} 天`,
      style: "text-[#a63d3d] bg-[rgba(166,61,61,0.04)] border-[rgba(166,61,61,0.15)]",
    };
  if (diff === 0)
    return {
      label: "今天到期",
      style: "text-[#b06a28] bg-[rgba(176,106,40,0.04)] border-[rgba(176,106,40,0.15)]",
    };
  if (diff === 1)
    return {
      label: "明天到期",
      style: "text-[#9a6a2f] bg-[rgba(154,106,47,0.04)] border-[rgba(154,106,47,0.15)]",
    };
  return null;
}

function activityLabel(action: string) {
  const map: Record<string, string> = {
    created: "创建了任务",
    updated: "更新了任务",
    edited: "编辑了任务",
    comment: "添加了评论",
  };
  return map[action] || action;
}

/* ── Edit Panel ── */

function EditPanel({
  task,
  projects,
  onSaved,
  onClose,
}: {
  task: Task;
  projects: SimpleProject[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [projectId, setProjectId] = useState(task.project?.id || "");
  const [dueDate, setDueDate] = useState(
    task.dueDate ? task.dueDate.split("T")[0] : ""
  );
  const [needReminder, setNeedReminder] = useState(task.needReminder);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description || null,
          status,
          priority,
          projectId: projectId || null,
          dueDate: dueDate || null,
          needReminder,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `保存失败 (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          标题
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          描述
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            状态
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {Object.entries(TASK_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            优先级
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {Object.entries(TASK_PRIORITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            截止日期
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            项目
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">无项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setNeedReminder(!needReminder)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
          needReminder
            ? "border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] text-[#9a6a2f]"
            : "border-border text-muted hover:bg-background"
        )}
      >
        {needReminder ? <Bell size={14} /> : <BellOff size={14} />}
        {needReminder ? "已开启到期提醒" : "开启到期提醒"}
      </button>
      {error && (
        <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          保存
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-background"
        >
          取消
        </button>
      </div>
    </form>
  );
}

/* ── Comment Section ── */

function CommentSection({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    apiFetch(`/api/tasks/${taskId}/comments`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setComments(data);
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input.trim() }),
      });
      if (res.ok) {
        setInput("");
        load();
      }
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <MessageSquare size={15} />
        评论 ({comments.length})
      </h3>

      {comments.length === 0 && (
        <p className="mb-3 text-xs text-muted">暂无评论</p>
      )}

      <div className="mb-4 space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="rounded-lg bg-background px-3 py-2.5">
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-accent">
                <User size={10} />
              </div>
              <span className="text-xs font-medium">{c.author.name}</span>
              <span className="text-[10px] text-muted">
                {formatDateTime(c.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {c.content}
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="写评论... (Enter 发送)"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {sending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Activity Log ── */

function ActivityLog({ taskId }: { taskId: string }) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  useEffect(() => {
    apiFetch(`/api/tasks/${taskId}/activities`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setActivities(data);
      })
      .catch(() => {});
  }, [taskId]);

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Activity size={15} />
        活动记录
      </h3>

      {activities.length === 0 && (
        <p className="text-xs text-muted">暂无活动记录</p>
      )}

      <div className="space-y-0">
        {activities.map((a, idx) => (
          <div key={a.id} className="relative flex gap-3 pb-4">
            {idx < activities.length - 1 && (
              <div className="absolute left-[9px] top-5 h-full w-px bg-border" />
            )}
            <div className="relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border bg-card-bg">
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  a.action === "created"
                    ? "bg-[#2e7a56]"
                    : a.action === "updated"
                      ? "bg-[#2b6055]"
                      : a.action === "comment"
                        ? "bg-[#805078]"
                        : "bg-[#8a9590]"
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-medium">{a.actor.name}</span>
                <span className="text-muted">{activityLabel(a.action)}</span>
              </div>
              {a.detail && a.action !== "comment" && (
                <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
              )}
              <p className="mt-0.5 text-[10px] text-muted/60">
                {formatDateTime(a.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Task Schedule Modal ── */

function TaskScheduleModal({
  task,
  onClose,
  onSaved,
}: {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState(() => {
    if (task.dueDate) return task.dueDate.split("T")[0];
    return new Date().toISOString().split("T")[0];
  });
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");

    const payload: Record<string, unknown> = {
      title: title.trim(),
      allDay,
      location: location || null,
      taskId: task.id,
    };

    if (allDay) {
      payload.startTime = `${date}T00:00:00`;
      payload.endTime = `${date}T23:59:59`;
    } else {
      payload.startTime = `${date}T${startTime}:00`;
      payload.endTime = `${date}T${endTime}:00`;
    }

    try {
      const res = await apiFetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `创建失败 (${res.status})`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-border bg-card-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">为任务添加日程</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-background"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="日程标题"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted">日期</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setAllDay(!allDay)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-sm transition-colors",
                  allDay
                    ? "border-accent bg-accent/5 font-medium text-accent"
                    : "border-border text-muted hover:bg-background"
                )}
              >
                {allDay ? "✓ 全天事件" : "全天事件"}
              </button>
            </div>
          </div>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">开始时间</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">结束时间</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="地点（可选）"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && (
            <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-background"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              创建日程
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main Page ── */

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const loadTask = useCallback(() => {
    apiFetch(`/api/tasks/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setTask)
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadTask();
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data))
          setProjects(
            data.map((p: { id: string; name: string }) => ({
              id: p.id,
              name: p.name,
            }))
          );
      })
      .catch(() => {});
  }, [loadTask]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted">任务不存在或已被删除</p>
        <Link
          href="/tasks"
          className="text-sm text-accent transition-colors hover:underline"
        >
          返回任务列表
        </Link>
      </div>
    );
  }

  const statusInfo = TASK_STATUS[task.status] || TASK_STATUS.todo;
  const priorityInfo = TASK_PRIORITY[task.priority] || TASK_PRIORITY.medium;
  const StatusIcon = STATUS_ICONS[task.status] || Circle;
  const dueStatus = getDueStatus(task.dueDate, task.status);

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto pb-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
        >
          <ArrowLeft size={18} />
        </button>
        <Link
          href="/tasks"
          className="text-sm text-muted transition-colors hover:text-foreground"
        >
          任务管理
        </Link>
        <span className="text-xs text-muted">/</span>
        <span className="truncate text-sm font-medium">{task.title}</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Task Header */}
          <div className="rounded-xl border border-border bg-card-bg p-5">
            {editing ? (
              <EditPanel
                task={task}
                projects={projects}
                onSaved={() => {
                  loadTask();
                  setEditing(false);
                }}
                onClose={() => setEditing(false)}
              />
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h1 className="text-xl font-bold leading-tight">
                    {task.title}
                  </h1>
                  <button
                    onClick={() => setEditing(true)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-background hover:text-foreground"
                  >
                    <Pencil size={12} />
                    编辑
                  </button>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                      statusInfo.color
                    )}
                  >
                    <StatusIcon size={12} />
                    {statusInfo.label}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium",
                      priorityInfo.color
                    )}
                  >
                    <Flag size={11} />
                    {priorityInfo.label}优先级
                  </span>
                  {task.needReminder && (
                    <span className="flex items-center gap-1 rounded-full border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-2 py-1 text-xs font-medium text-[#9a6a2f]">
                      <Bell size={11} />
                      已开启提醒
                    </span>
                  )}
                  {dueStatus && (
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium",
                        dueStatus.style
                      )}
                    >
                      {dueStatus.label.includes("逾期") ? (
                        <AlertTriangle size={11} />
                      ) : (
                        <CalendarClock size={11} />
                      )}
                      {dueStatus.label}
                    </span>
                  )}
                </div>

                {task.description ? (
                  <div className="rounded-lg bg-background px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                      {task.description}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted">暂无描述</p>
                )}
              </>
            )}
          </div>

          {/* Tabs: Comments / Activity */}
          <div className="rounded-xl border border-border bg-card-bg">
            <div className="flex border-b border-border">
              <button
                onClick={() => setTab("comments")}
                className={cn(
                  "flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors",
                  tab === "comments"
                    ? "border-b-2 border-accent text-accent"
                    : "text-muted hover:text-foreground"
                )}
              >
                <MessageSquare size={14} />
                评论
              </button>
              <button
                onClick={() => setTab("activity")}
                className={cn(
                  "flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors",
                  tab === "activity"
                    ? "border-b-2 border-accent text-accent"
                    : "text-muted hover:text-foreground"
                )}
              >
                <Activity size={14} />
                活动记录
              </button>
            </div>
            <div className="p-5">
              {tab === "comments" ? (
                <CommentSection taskId={task.id} />
              ) : (
                <ActivityLog taskId={task.id} />
              )}
            </div>
          </div>
        </div>

        {/* Right: Sidebar Info */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card-bg p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
              任务信息
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <FolderKanban size={12} />
                  项目
                </span>
                {task.project ? (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: task.project.color }}
                    />
                    <span className="text-xs font-medium">
                      {task.project.name}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted">无</span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Calendar size={12} />
                  截止日期
                </span>
                <span className="text-xs font-medium">
                  {task.dueDate ? formatDate(task.dueDate) : "未设置"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <User size={12} />
                  负责人
                </span>
                <span className="text-xs font-medium">
                  {task.assignee?.name || "未分配"}
                </span>
              </div>

              <div className="h-px bg-border" />

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted">创建时间</span>
                <span className="text-[10px] text-muted">
                  {formatDateTime(task.createdAt)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted">最后更新</span>
                <span className="text-[10px] text-muted">
                  {formatDateTime(task.updatedAt)}
                </span>
              </div>
              {task.completedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted">完成时间</span>
                  <span className="text-[10px] text-muted">
                    {formatDateTime(task.completedAt)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Status Change */}
          <div className="rounded-xl border border-border bg-card-bg p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
              快速操作
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TASK_STATUS).map(([key, info]) => {
                const active = task.status === key;
                return (
                  <button
                    key={key}
                    disabled={active}
                    onClick={async () => {
                      await apiFetch(`/api/tasks/${task.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: key }),
                      });
                      loadTask();
                    }}
                    className={cn(
                      "rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      active
                        ? cn(info.color, "opacity-100")
                        : "border border-border text-muted hover:bg-background"
                    )}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Linked Calendar Events */}
          <div className="rounded-xl border border-border bg-card-bg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                关联日程
              </h3>
              <button
                onClick={() => setShowScheduleForm(true)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent/10"
              >
                <Plus size={11} />
                加入日程
              </button>
            </div>
            {task.calendarEvents && task.calendarEvents.length > 0 ? (
              <div className="space-y-2">
                {task.calendarEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start gap-2 rounded-lg bg-background px-3 py-2"
                  >
                    <Calendar size={12} className="mt-0.5 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{ev.title}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                        <span className="flex items-center gap-0.5">
                          <Clock size={9} />
                          {ev.allDay
                            ? "全天"
                            : `${new Date(ev.startTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} - ${new Date(ev.endTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`}
                        </span>
                        <span>
                          {new Date(ev.startTime).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
                        </span>
                        {ev.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin size={9} />
                            {ev.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await apiFetch(`/api/calendar/${ev.id}`, { method: "DELETE" });
                        loadTask();
                      }}
                      className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-[#a63d3d]"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">暂无关联日程</p>
            )}
          </div>
        </div>
      </div>

      {/* Schedule Form Modal */}
      {showScheduleForm && (
        <TaskScheduleModal
          task={task}
          onClose={() => setShowScheduleForm(false)}
          onSaved={() => {
            setShowScheduleForm(false);
            loadTask();
          }}
        />
      )}
    </div>
  );
}
