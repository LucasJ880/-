"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CheckSquare,
  Clock,
  ListTodo,
  FolderKanban,
  ArrowRight,
  Loader2,
  Plus,
  Bot,
  Inbox,
  Flag,
  AlertTriangle,
  CalendarClock,
  TrendingUp,
  Calendar,
  MapPin,
  X,
  Trash2,
  Link2,
  Pencil,
  Bell,
} from "lucide-react";
import Link from "next/link";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";

interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: { name: string; color: string } | null;
}

interface ProjectBreakdown {
  id: string;
  name: string;
  color: string;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
}

interface CalendarEventItem {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  source?: "qingyan" | "google";
  task: { id: string; title: string; status: string } | null;
}

interface Stats {
  totalTasks: number;
  todoCount: number;
  inProgressCount: number;
  doneCount: number;
  totalProjects: number;
  week: {
    created: number;
    completed: number;
    overdue: number;
    active: number;
  };
  highPriorityTasks: TaskItem[];
  upcomingTasks: TaskItem[];
  projectBreakdown: ProjectBreakdown[];
  recentTasks: (TaskItem & { updatedAt: string })[];
}

interface ReminderSummaryData {
  immediate: { sourceKey: string; type: string; title: string; subtitle: string }[];
  today: { sourceKey: string; type: string; title: string; subtitle: string }[];
  upcoming: { sourceKey: string; type: string; title: string; subtitle: string }[];
  unreadCount: number;
}

function ReminderSummaryCard({ data }: { data: ReminderSummaryData | null }) {
  if (!data || data.unreadCount === 0) return null;

  const overdueCount = data.immediate.filter((i) => i.type === "deadline").length;
  const todayDeadlines = data.today.filter((i) => i.type === "deadline").length;
  const todayEvents = data.immediate.filter((i) => i.type === "event").length + data.today.filter((i) => i.type === "event").length;
  const followups = [...data.immediate, ...data.today, ...data.upcoming].filter((i) => i.type === "followup").length;

  const nextEvent = [...data.immediate, ...data.today].find((i) => i.type === "event");

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Bell size={15} className="text-accent" />
        <h2 className="font-semibold">今日提醒</h2>
        <span className="ml-auto text-xs text-muted">{data.unreadCount} 条待处理</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {[
          { label: "逾期", value: overdueCount, color: overdueCount > 0 ? "text-red-600" : "text-slate-400" },
          { label: "今天截止", value: todayDeadlines, color: todayDeadlines > 0 ? "text-orange-600" : "text-slate-400" },
          { label: "今日日程", value: todayEvents, color: todayEvents > 0 ? "text-blue-600" : "text-slate-400" },
          { label: "跟进", value: followups, color: followups > 0 ? "text-purple-600" : "text-slate-400" },
        ].map((c) => (
          <div key={c.label} className="bg-card-bg px-5 py-3 text-center">
            <p className={cn("text-xl font-bold", c.color)}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-muted">{c.label}</p>
          </div>
        ))}
      </div>
      {nextEvent && (
        <div className="border-t border-border px-5 py-2.5">
          <p className="text-xs text-muted">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            下一个日程：<span className="font-medium text-foreground">{nextEvent.title}</span>
            <span className="ml-1.5 text-muted">{nextEvent.subtitle}</span>
          </p>
        </div>
      )}
    </div>
  );
}

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

function ProgressBar({
  done,
  inProgress,
  total,
}: {
  done: number;
  inProgress: number;
  total: number;
}) {
  if (total === 0) return <div className="h-1.5 w-full rounded-full bg-slate-100" />;
  const donePct = (done / total) * 100;
  const inPct = (inProgress / total) * 100;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      {donePct > 0 && (
        <div
          className="bg-green-500 transition-all"
          style={{ width: `${donePct}%` }}
        />
      )}
      {inPct > 0 && (
        <div
          className="bg-blue-400 transition-all"
          style={{ width: `${inPct}%` }}
        />
      )}
    </div>
  );
}

/* ── Event Form Modal ── */

interface SimpleTask {
  id: string;
  title: string;
}

function EventFormModal({
  open,
  onClose,
  onSaved,
  prefillTask,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  prefillTask?: SimpleTask | null;
  editing?: CalendarEventItem | null;
}) {
  const isEdit = !!editing;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [taskId, setTaskId] = useState("");
  const [tasks, setTasks] = useState<SimpleTask[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;

    if (editing) {
      setTitle(editing.title);
      setDate(editing.startTime.split("T")[0]);
      setAllDay(editing.allDay);
      setLocation(editing.location || "");
      setTaskId(editing.task?.id || "");
      if (!editing.allDay) {
        const fmtTime = (iso: string) => {
          const d = new Date(iso);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        };
        setStartTime(fmtTime(editing.startTime));
        setEndTime(fmtTime(editing.endTime));
      } else {
        setStartTime("09:00");
        setEndTime("10:00");
      }
    } else {
      setTitle(prefillTask ? prefillTask.title : "");
      setDate(new Date().toISOString().split("T")[0]);
      setStartTime("09:00");
      setEndTime("10:00");
      setAllDay(false);
      setLocation("");
      setTaskId(prefillTask?.id || "");
    }
    setError("");

    fetch("/api/tasks?status=todo&status=in_progress")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data))
          setTasks(data.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })));
      })
      .catch(() => {});
  }, [open, prefillTask, editing]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");

    const payload: Record<string, unknown> = {
      title: title.trim(),
      allDay,
      location: location || null,
      taskId: taskId || null,
    };

    if (allDay) {
      payload.startTime = `${date}T00:00:00`;
      payload.endTime = `${date}T23:59:59`;
    } else {
      payload.startTime = `${date}T${startTime}:00`;
      payload.endTime = `${date}T${endTime}:00`;
    }

    try {
      const url = isEdit ? `/api/calendar/${editing!.id}` : "/api/calendar";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
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
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-border bg-card-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {isEdit ? "编辑日程" : "添加日程"}
          </h3>
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
                <label className="mb-1 block text-xs text-muted">
                  开始时间
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">
                  结束时间
                </label>
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
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-muted">
              <Link2 size={11} />
              关联任务（可选）
            </label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">不关联任务</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
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
              {isEdit ? "保存" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Today Schedule Section ── */

function formatEventTime(startTime: string, endTime: string, allDay: boolean) {
  if (allDay) return "全天";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(startTime)} - ${fmt(endTime)}`;
}

function TodaySchedule({
  events,
  onAdd,
  onEdit,
  onDelete,
}: {
  events: CalendarEventItem[];
  onAdd: () => void;
  onEdit: (ev: CalendarEventItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Calendar size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">今日日程</h2>
        <span className="ml-auto text-xs text-muted">
          {events.length} 项
        </span>
        <button
          onClick={onAdd}
          className="ml-1 flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        >
          <Plus size={12} />
          添加
        </button>
      </div>
      <div className="divide-y divide-border">
        {events.length > 0 ? (
          events.map((ev) => (
            <div
              key={ev.id}
              className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background"
            >
              <div
                className={cn(
                  "h-8 w-1 shrink-0 rounded-full",
                  ev.source === "google"
                    ? "bg-red-400"
                    : ev.allDay
                      ? "bg-accent"
                      : "bg-blue-400"
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ev.title}</p>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatEventTime(ev.startTime, ev.endTime, ev.allDay)}
                  </span>
                  {ev.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={10} />
                      {ev.location}
                    </span>
                  )}
                  {ev.source === "google" && (
                    <span className="flex items-center gap-1 rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-500">
                      Google
                    </span>
                  )}
                  {ev.task && (
                    <Link
                      href={`/tasks/${ev.task.id}`}
                      className="flex items-center gap-1 text-accent hover:underline"
                    >
                      <Link2 size={10} />
                      {ev.task.title}
                    </Link>
                  )}
                </div>
              </div>
              {ev.source !== "google" && (
                <>
                  <button
                    onClick={() => onEdit(ev)}
                    className="shrink-0 rounded p-1 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-blue-50 hover:text-accent"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => onDelete(ev.id)}
                    className="shrink-0 rounded p-1 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-muted">今天暂无日程安排</p>
            <button
              onClick={onAdd}
              className="mt-1.5 text-xs text-accent hover:underline"
            >
              添加一个日程
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventItem | null>(null);
  const [reminderSummary, setReminderSummary] = useState<ReminderSummaryData | null>(null);

  const loadStats = useCallback(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const loadEvents = useCallback(() => {
    const internalP = fetch("/api/calendar").then((r) => r.json()).catch(() => []);
    const googleP = fetch("/api/calendar/google").then((r) => r.json()).catch(() => []);

    Promise.all([internalP, googleP]).then(([internal, google]) => {
      const internalEvents: CalendarEventItem[] = (Array.isArray(internal) ? internal : []).map(
        (e: CalendarEventItem) => ({ ...e, source: "qingyan" as const })
      );
      const googleEvents: CalendarEventItem[] = (Array.isArray(google) ? google : []).map(
        (e: { id: string; title: string; startTime: string; endTime: string; allDay: boolean; location: string | null }) => ({
          ...e,
          description: null,
          source: "google" as const,
          task: null,
        })
      );
      const merged = [...internalEvents, ...googleEvents].sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
      setEvents(merged);
    });
  }, []);

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      await fetch(`/api/calendar/${id}`, { method: "DELETE" });
      loadEvents();
    },
    [loadEvents]
  );

  const loadReminders = useCallback(() => {
    fetch("/api/reminders")
      .then((r) => r.json())
      .then(setReminderSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
    loadEvents();
    loadReminders();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadStats();
        loadEvents();
        loadReminders();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadStats, loadEvents, loadReminders]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!stats) return null;

  const summaryCards = [
    {
      label: "全部任务",
      value: stats.totalTasks,
      icon: ListTodo,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "待办",
      value: stats.todoCount,
      icon: Clock,
      color: "text-slate-600 bg-slate-50",
    },
    {
      label: "进行中",
      value: stats.inProgressCount,
      icon: CheckSquare,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "已完成",
      value: stats.doneCount,
      icon: CheckSquare,
      color: "text-green-600 bg-green-50",
    },
    {
      label: "项目数",
      value: stats.totalProjects,
      icon: FolderKanban,
      color: "text-purple-600 bg-purple-50",
    },
  ];

  const weekCards = [
    { label: "本周新增", value: stats.week.created, color: "text-blue-600" },
    { label: "本周完成", value: stats.week.completed, color: "text-green-600" },
    { label: "进行中", value: stats.week.active, color: "text-amber-600" },
    { label: "已逾期", value: stats.week.overdue, color: stats.week.overdue > 0 ? "text-red-600" : "text-slate-400" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="text-2xl font-bold">工作台</h1>
        <p className="mt-1 text-sm text-muted">欢迎回来，这是您的工作概览</p>
      </div>

      {/* 总览数字 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summaryCards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-card-bg p-4"
          >
            <div className="flex items-center gap-3">
              <div className={cn("rounded-lg p-2", c.color)}>
                <c.icon size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold">{c.value}</p>
                <p className="text-xs text-muted">{c.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 本周进度 */}
      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <TrendingUp size={15} className="text-accent" />
          <h2 className="font-semibold">本周进度</h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {weekCards.map((w) => (
            <div key={w.label} className="bg-card-bg px-5 py-4 text-center">
              <p className={cn("text-2xl font-bold", w.color)}>{w.value}</p>
              <p className="mt-0.5 text-xs text-muted">{w.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 今日提醒摘要 */}
      <ReminderSummaryCard data={reminderSummary} />

      {/* 今日日程 */}
      <TodaySchedule
        events={events}
        onAdd={() => {
          setEditingEvent(null);
          setShowEventForm(true);
        }}
        onEdit={(ev) => {
          setEditingEvent(ev);
          setShowEventForm(true);
        }}
        onDelete={handleDeleteEvent}
      />

      {/* 双列：高优 + 即将到期 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 高优先级任务 */}
        <div className="rounded-xl border border-border bg-card-bg">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Flag size={14} className="text-orange-500" />
            <h2 className="text-sm font-semibold">高优先级任务</h2>
            <span className="ml-auto text-xs text-muted">
              {stats.highPriorityTasks.length} 项
            </span>
          </div>
          <div className="divide-y divide-border">
            {stats.highPriorityTasks.length > 0 ? (
              stats.highPriorityTasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted">
                没有高优先级待办，很好！
              </div>
            )}
          </div>
        </div>

        {/* 即将到期任务 */}
        <div className="rounded-xl border border-border bg-card-bg">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <AlertTriangle size={14} className="text-amber-500" />
            <h2 className="text-sm font-semibold">即将到期</h2>
            <span className="ml-auto text-xs text-muted">
              未来 3 天内
            </span>
          </div>
          <div className="divide-y divide-border">
            {stats.upcomingTasks.length > 0 ? (
              stats.upcomingTasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted">
                近期没有即将到期的任务
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 项目概览 */}
      {stats.projectBreakdown.length > 0 && (
        <div className="rounded-xl border border-border bg-card-bg">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <FolderKanban size={15} className="text-purple-500" />
              <h2 className="font-semibold">项目概览</h2>
            </div>
            <Link
              href="/projects"
              className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
            >
              全部项目 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {stats.projectBreakdown.map((p) => (
              <div key={p.id} className="space-y-2 bg-card-bg px-5 py-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="ml-auto text-xs text-muted">
                    {p.done}/{p.total}
                  </span>
                </div>
                <ProgressBar
                  done={p.done}
                  inProgress={p.inProgress}
                  total={p.total}
                />
                <div className="flex gap-3 text-[11px] text-muted">
                  <span>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />{" "}
                    已完成 {p.done}
                  </span>
                  <span>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />{" "}
                    进行中 {p.inProgress}
                  </span>
                  <span>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-200" />{" "}
                    待办 {p.todo}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快捷入口 */}
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

      {/* 最近更新 */}
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
          {stats.recentTasks.length > 0 ? (
            stats.recentTasks.map((task) => {
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

      {/* 日程弹窗 */}
      <EventFormModal
        open={showEventForm}
        onClose={() => {
          setShowEventForm(false);
          setEditingEvent(null);
        }}
        onSaved={loadEvents}
        editing={editingEvent}
      />
    </div>
  );
}
