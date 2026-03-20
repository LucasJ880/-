"use client";

import { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { CalendarEventItem, SimpleTask } from "./types";

function formatEventTime(
  startTime: string,
  endTime: string,
  allDay: boolean
) {
  if (allDay) return "全天";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(startTime)} - ${fmt(endTime)}`;
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

    apiFetch("/api/tasks?status=todo&status=in_progress")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data))
          setTasks(
            data.map((t: { id: string; title: string }) => ({
              id: t.id,
              title: t.title,
            }))
          );
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
            type="button"
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
        <span className="ml-auto text-xs text-muted">{events.length} 项</span>
        <button
          type="button"
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
                    type="button"
                    onClick={() => onEdit(ev)}
                    className="shrink-0 rounded p-1 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-blue-50 hover:text-accent"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
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
              type="button"
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

export function DashboardCalendarSection({
  events,
  showEventForm,
  editingEvent,
  onClose,
  onSaved,
  onOpenAdd,
  onOpenEdit,
  onDelete,
}: {
  events: CalendarEventItem[];
  showEventForm: boolean;
  editingEvent: CalendarEventItem | null;
  onClose: () => void;
  onSaved: () => void;
  onOpenAdd: () => void;
  onOpenEdit: (ev: CalendarEventItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <TodaySchedule
        events={events}
        onAdd={onOpenAdd}
        onEdit={onOpenEdit}
        onDelete={onDelete}
      />
      <EventFormModal
        open={showEventForm}
        onClose={onClose}
        onSaved={onSaved}
        editing={editingEvent}
      />
    </>
  );
}
