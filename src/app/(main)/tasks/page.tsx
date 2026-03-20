"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  Trash2,
  ChevronDown,
  Pencil,
  X,
  Bell,
  BellOff,
  AlertTriangle,
  CalendarClock,
  ListTodo,
} from "lucide-react";
import Link from "next/link";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  needReminder: boolean;
  createdAt: string;
  project: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string } | null;
}

interface SimpleProject {
  id: string;
  name: string;
  color: string;
}

const STATUS_ICONS: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  in_progress: Clock,
  done: CheckCircle2,
  cancelled: XCircle,
};

function getDueStatus(dueDate: string | null, status: string) {
  if (!dueDate || status === "done" || status === "cancelled") return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return { label: `已逾期 ${Math.abs(diff)} 天`, style: "text-red-600 bg-red-50 border-red-200" };
  if (diff === 0) return { label: "今天到期", style: "text-orange-600 bg-orange-50 border-orange-200" };
  if (diff === 1) return { label: "明天到期", style: "text-amber-600 bg-amber-50 border-amber-200" };
  return null;
}

function TaskFormModal({
  open,
  onClose,
  onSaved,
  editing,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: Task | null;
  projects: SimpleProject[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [projectId, setProjectId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [needReminder, setNeedReminder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description || "");
      setPriority(editing.priority);
      setStatus(editing.status);
      setProjectId(editing.project?.id || "");
      setDueDate(editing.dueDate ? editing.dueDate.split("T")[0] : "");
      setNeedReminder(editing.needReminder);
    } else {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus("todo");
      setProjectId("");
      setDueDate("");
      setNeedReminder(false);
    }
  }, [editing, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setSaveError("");

    const payload = {
      title: title.trim(),
      description: description || null,
      priority,
      status,
      projectId: projectId || null,
      dueDate: dueDate || null,
      needReminder,
    };

    try {
      const url = editing ? `/api/tasks/${editing.id}` : "/api/tasks";
      const method = editing ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `保存失败 (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card-bg p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {editing ? "编辑任务" : "新建任务"}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-background"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              任务标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="任务描述（可选）..."
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">优先级</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                      priority === p
                        ? "border-accent bg-accent text-white"
                        : "border-border hover:bg-background"
                    )}
                  >
                    {TASK_PRIORITY[p].label}
                  </button>
                ))}
              </div>
            </div>
            {editing && (
              <div>
                <label className="mb-1 block text-sm font-medium">状态</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                        status === s
                          ? "border-accent bg-accent text-white"
                          : "border-border hover:bg-background"
                      )}
                    >
                      {TASK_STATUS[s].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                所属项目
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">无</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">截止日期</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setNeedReminder(!needReminder)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                needReminder
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-border text-muted hover:bg-background"
              )}
            >
              {needReminder ? <Bell size={14} /> : <BellOff size={14} />}
              {needReminder ? "已开启到期提醒" : "开启到期提醒"}
            </button>
          </div>
          {saveError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-background"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "保存修改" : "创建任务"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatusDropdown({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(false);

  const handleChange = async (status: TaskStatus) => {
    setOpen(false);
    await apiFetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onUpdate();
  };

  const statusInfo = TASK_STATUS[task.status];
  const Icon = STATUS_ICONS[task.status];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
          statusInfo.color
        )}
      >
        <Icon size={13} />
        {statusInfo.label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => {
              const info = TASK_STATUS[s];
              const SIcon = STATUS_ICONS[s];
              return (
                <button
                  key={s}
                  onClick={() => handleChange(s)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-background",
                    task.status === s && "font-semibold"
                  )}
                >
                  <SIcon size={13} />
                  {info.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const loadTasks = useCallback(() => {
    setLoading(true);
    const params = filter !== "all" ? `?status=${filter}` : "";
    apiFetch(`/api/tasks${params}`)
      .then((r) => r.json())
      .then(setTasks)
      .finally(() => setLoading(false));
  }, [filter]);

  const loadProjects = useCallback(() => {
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data: { id: string; name: string; color: string }[]) =>
        setProjects(data.map((p) => ({ id: p.id, name: p.name, color: p.color })))
      );
  }, []);

  useEffect(() => {
    loadTasks();
    loadProjects();
  }, [loadTasks, loadProjects]);

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
    loadTasks();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="任务管理"
        description="管理和追踪您的所有工作任务"
        actions={
          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setShowForm(true);
            }}
            className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 ease-out hover:bg-accent-hover active:scale-[0.98]"
          >
            <Plus size={16} />
            新建任务
          </button>
        }
      />

      <div className="flex gap-2">
        {(["all", ...Object.keys(TASK_STATUS)] as const).map((s) => {
          const label =
            s === "all"
              ? `全部 (${tasks.length})`
              : TASK_STATUS[s as TaskStatus].label;
          return (
            <button
              key={s}
              onClick={() => setFilter(s as TaskStatus | "all")}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                filter === s
                  ? "border-accent bg-accent/5 font-medium text-accent"
                  : "border-border text-muted hover:bg-card-bg"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-card-bg p-4 shadow-card">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="h-4 flex-1 rounded bg-border" />
              <div className="h-5 w-16 rounded bg-border" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card-bg/80 px-6 py-14 text-center shadow-card">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <ListTodo size={28} strokeWidth={1.75} />
          </div>
          <h3 className="text-base font-semibold text-foreground">暂无任务</h3>
          <p className="mt-1 max-w-sm text-sm text-muted">
            创建任务以跟踪进度；也可在「AI 助手」或「收件箱」用自然语言生成建议。
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setShowForm(true);
            }}
            className="mt-6 min-h-10 rounded-[var(--radius-md)] bg-accent px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent-hover active:scale-[0.98]"
          >
            新建任务
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card-bg">
          {tasks.map((task) => {
            const priorityInfo =
              TASK_PRIORITY[task.priority] || TASK_PRIORITY.medium;
            const dueStatus = getDueStatus(task.dueDate, task.status);
            return (
              <div
                key={task.id}
                className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-background"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/tasks/${task.id}`}
                      className={cn(
                        "truncate text-sm font-medium hover:text-accent hover:underline",
                        task.status === "done" && "text-muted line-through"
                      )}
                    >
                      {task.title}
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        priorityInfo.color
                      )}
                    >
                      {priorityInfo.label}
                    </span>
                    {task.needReminder && (
                      <Bell size={12} className="shrink-0 text-amber-500" />
                    )}
                    {dueStatus && (
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          dueStatus.style
                        )}
                      >
                        {dueStatus.label.includes("逾期") ? (
                          <AlertTriangle size={10} />
                        ) : (
                          <CalendarClock size={10} />
                        )}
                        {dueStatus.label}
                      </span>
                    )}
                    {task.dueDate && !dueStatus && (
                      <span className="shrink-0 text-[10px] text-muted">
                        截止 {new Date(task.dueDate).toLocaleDateString("zh-CN")}
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {task.description}
                    </p>
                  )}
                  {task.project && (
                    <div className="mt-1 flex items-center gap-1.5">
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
                <StatusDropdown task={task} onUpdate={loadTasks} />
                <button
                  onClick={() => {
                    setEditingTask(task);
                    setShowForm(true);
                  }}
                  className="rounded p-1.5 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-blue-50 hover:text-accent"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => handleDelete(task.id)}
                  className="rounded p-1.5 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <TaskFormModal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingTask(null);
        }}
        onSaved={loadTasks}
        editing={editingTask}
        projects={projects}
      />
    </div>
  );
}
