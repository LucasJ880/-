"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-fetch";
import {
  formatDateDisplayToronto,
  formatDateLabelToronto,
  formatHHmmToronto,
  formatISODateToronto,
  isTodayToronto,
} from "@/lib/time";
import type { CalendarEventItem, SimpleTask } from "../types";

/* ═══════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════ */

function isToday(d: Date): boolean {
  return isTodayToronto(d);
}

function fmtDateDisplay(d: Date): string {
  return formatDateDisplayToronto(d);
}

function fmtDateLabel(d: Date): string {
  return formatDateLabelToronto(d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/* ═══════════════════════════════════════════
   DateSwitcher
   ═══════════════════════════════════════════ */

export function DateSwitcher({
  date,
  onChange,
}: {
  date: Date;
  onChange: (d: Date) => void;
}) {
  const label = fmtDateLabel(date);
  const displayDate = fmtDateDisplay(date);
  const isTodayDate = isToday(date);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(addDays(date, -1))}
        className="rounded-md p-1 text-muted transition-colors hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
        title="前一天"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="flex items-center gap-1.5 text-xs">
        {label && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              isTodayDate
                ? "bg-accent/10 text-accent"
                : "bg-muted/10 text-muted"
            )}
          >
            {label}
          </span>
        )}
        <span className="text-muted">{displayDate}</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(addDays(date, 1))}
        className="rounded-md p-1 text-muted transition-colors hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
        title="后一天"
      >
        <ChevronRight size={14} />
      </button>
      {!isTodayDate && (
        <button
          type="button"
          onClick={() => onChange(new Date())}
          className="ml-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
        >
          回到今天
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   EventFormModal
   ═══════════════════════════════════════════ */

export function EventFormModal({
  open,
  onOpenChange,
  onSaved,
  prefillTask,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
        setStartTime(formatHHmmToronto(editing.startTime));
        setEndTime(formatHHmmToronto(editing.endTime));
      } else {
        setStartTime("09:00");
        setEndTime("10:00");
      }
    } else {
      setTitle(prefillTask ? prefillTask.title : "");
      setDate(formatISODateToronto(new Date()));
      setStartTime("09:00");
      setEndTime("10:00");
      setAllDay(false);
      setLocation("");
      setTaskId(prefillTask?.id || "");
    }
    setError("");

    apiFetch("/api/tasks?status=todo&status=in_progress")
      .then((r) => r.json())
      .then((raw) => {
        const data = Array.isArray(raw) ? raw : raw?.items;
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
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isEdit ? "编辑日程" : "添加日程"}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? "修改日程时间与关联信息。" : "填写标题、时间与可选地点。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            id="event-form-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="日程标题"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="event-form-date">日期</Label>
              <Input
                id="event-form-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant={allDay ? "secondary" : "outline"}
                className={cn(
                  "w-full",
                  allDay && "border-accent font-medium text-accent"
                )}
                onClick={() => setAllDay(!allDay)}
              >
                {allDay ? "✓ 全天事件" : "全天事件"}
              </Button>
            </div>
          </div>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="event-form-start">开始时间</Label>
                <Input
                  id="event-form-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-form-end">结束时间</Label>
                <Input
                  id="event-form-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}
          <Input
            id="event-form-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="地点（可选）"
          />
          <div className="space-y-2">
            <Label
              htmlFor="event-form-task"
              className="flex items-center gap-1.5"
            >
              <Link2 size={11} />
              关联任务（可选）
            </Label>
            <select
              id="event-form-task"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent/30"
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
            <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={!title.trim() || saving}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
