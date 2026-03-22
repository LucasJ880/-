"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Link2,
  ListTodo,
  Loader2,
  MapPin,
  Plus,
  X,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { CalendarEventItem, ScheduleEvent, SimpleTask } from "./types";
import { ScheduleEventDrawer } from "./schedule-event-drawer";

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const HOUR_HEIGHT = 60;
const MIN_HOUR = 6;
const MAX_HOUR = 23;
const TOTAL_HOURS = MAX_HOUR - MIN_HOUR;

/* ═══════════════════════════════════════════
   Overlap layout (ScheduleEvent version)
   ═══════════════════════════════════════════ */

interface LayoutBlock {
  event: ScheduleEvent;
  top: number;
  height: number;
  col: number;
  totalCols: number;
}

function toMinutes(iso: string): number {
  const { hour, minute } = torontoTimeParts(new Date(iso));
  return hour * 60 + minute;
}

function computeLayout(events: ScheduleEvent[]): LayoutBlock[] {
  const timed = events
    .filter((e) => !e.allDay)
    .map((e) => ({
      event: e,
      startMin: toMinutes(e.startAt),
      endMin: Math.max(toMinutes(e.endAt), toMinutes(e.startAt) + 20),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  if (timed.length === 0) return [];

  const columns: { endMin: number }[][] = [];
  const assignments: { item: (typeof timed)[0]; col: number }[] = [];

  for (const item of timed) {
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      if (col[col.length - 1].endMin <= item.startMin) {
        col.push({ endMin: item.endMin });
        assignments.push({ item, col: c });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([{ endMin: item.endMin }]);
      assignments.push({ item, col: columns.length - 1 });
    }
  }

  const groups: { items: typeof assignments; maxCol: number }[] = [];
  let currentGroup: typeof assignments = [];
  let groupEnd = 0;

  for (const a of assignments) {
    if (currentGroup.length === 0 || a.item.startMin < groupEnd) {
      currentGroup.push(a);
      groupEnd = Math.max(groupEnd, a.item.endMin);
    } else {
      groups.push({
        items: [...currentGroup],
        maxCol: Math.max(...currentGroup.map((x) => x.col)) + 1,
      });
      currentGroup = [a];
      groupEnd = a.item.endMin;
    }
  }
  if (currentGroup.length > 0) {
    groups.push({
      items: [...currentGroup],
      maxCol: Math.max(...currentGroup.map((x) => x.col)) + 1,
    });
  }

  const blocks: LayoutBlock[] = [];
  for (const g of groups) {
    for (const a of g.items) {
      const startOffset = a.item.startMin - MIN_HOUR * 60;
      const duration = a.item.endMin - a.item.startMin;
      blocks.push({
        event: a.item.event,
        top: (startOffset / 60) * HOUR_HEIGHT,
        height: Math.max((duration / 60) * HOUR_HEIGHT, 26),
        col: a.col,
        totalCols: g.maxCol,
      });
    }
  }

  return blocks;
}

/* ═══════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════ */

import {
  formatTimeToronto,
  formatDateDisplayToronto,
  formatDateLabelToronto,
  formatISODateToronto,
  formatHHmmToronto,
  isTodayToronto,
  torontoTimeParts,
  TIMEZONE,
} from "@/lib/time";

function formatTime(iso: string): string {
  return formatTimeToronto(iso);
}

function formatNow(): string {
  return formatTimeToronto(new Date());
}

function getNowMinutes(): number {
  const { hour, minute } = torontoTimeParts();
  return hour * 60 + minute;
}

function getNowOffset(): number {
  return ((getNowMinutes() - MIN_HOUR * 60) / 60) * HOUR_HEIGHT;
}

function isPast(endTime: string): boolean {
  return new Date(endTime).getTime() < Date.now();
}

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

const EVENT_TYPE_ICON: Record<string, typeof Calendar> = {
  calendar: Calendar,
  task_due: ListTodo,
  reminder: Bell,
  followup: Bell,
};

const SOURCE_COLORS: Record<string, string> = {
  google: "border-l-[#a63d3d]/50",
  task: "border-l-warning/50",
  system: "border-l-accent/40",
  local: "border-l-accent/60",
};

/* ═══════════════════════════════════════════
   AllDayEventsRow (ScheduleEvent)
   ═══════════════════════════════════════════ */

function AllDayEventsRow({
  events,
  onSelect,
  selectedId,
}: {
  events: ScheduleEvent[];
  onSelect: (ev: ScheduleEvent) => void;
  selectedId: string | null;
}) {
  if (events.length === 0) return null;

  return (
    <div className="border-b border-border bg-[rgba(43,96,85,0.015)] px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <div className="h-1 w-1 rounded-full bg-accent/50" />
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
          全天
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {events.map((ev) => {
          const TypeIcon = EVENT_TYPE_ICON[ev.type] ?? Calendar;
          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => onSelect(ev)}
              className={cn(
                "group flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                selectedId === ev.id
                  ? "border-accent/40 bg-accent/10"
                  : "border-accent/15 bg-[rgba(43,96,85,0.05)] hover:border-accent/30 hover:bg-[rgba(43,96,85,0.10)]"
              )}
            >
              <span className="h-2 w-0.5 shrink-0 rounded-full bg-accent" />
              <TypeIcon size={10} className="shrink-0 text-muted" />
              <span className="max-w-[180px] truncate font-medium text-foreground">
                {ev.title}
              </span>
              {ev.source === "google" && (
                <span className="rounded bg-[rgba(166,61,61,0.06)] px-1 py-0.5 text-[9px] font-medium text-[#a63d3d]">
                  G
                </span>
              )}
              {ev.source === "task" && (
                <span className="rounded bg-warning/8 px-1 py-0.5 text-[9px] font-medium text-warning">
                  截止
                </span>
              )}
              {(ev.type === "followup" || ev.type === "reminder") && (
                <span className="rounded bg-accent/8 px-1 py-0.5 text-[9px] font-medium text-accent">
                  提醒
                </span>
              )}
              {ev.projectName && (
                <span className="max-w-[100px] truncate text-[10px] text-muted">
                  {ev.projectName}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CurrentTimeLine
   ═══════════════════════════════════════════ */

function CurrentTimeLine({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [offset, setOffset] = useState(getNowOffset);
  const [timeStr, setTimeStr] = useState(formatNow);
  const didScroll = useRef(false);

  useEffect(() => {
    const tick = () => {
      setOffset(getNowOffset());
      setTimeStr(formatNow());
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!didScroll.current && containerRef.current) {
      const scrollTarget = Math.max(0, offset - 140);
      containerRef.current.scrollTop = scrollTarget;
      didScroll.current = true;
    }
  }, [containerRef, offset]);

  if (offset < 0 || offset > TOTAL_HOURS * HOUR_HEIGHT) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{ top: offset }}
    >
      <div className="relative flex items-center">
        <div className="absolute -left-[5px] h-[10px] w-[10px] rounded-full border-2 border-accent bg-card-bg" />
        <div className="ml-[6px] h-[1.5px] w-full bg-accent/60" />
        <span className="absolute -top-[7px] right-1 rounded bg-accent px-1 py-[1px] text-[9px] font-semibold tabular-nums text-white shadow-sm">
          {timeStr}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TimelineEventBlock (ScheduleEvent)
   ═══════════════════════════════════════════ */

function TimelineEventBlock({
  block,
  onSelect,
  selectedId,
}: {
  block: LayoutBlock;
  onSelect: (ev: ScheduleEvent) => void;
  selectedId: string | null;
}) {
  const ev = block.event;
  const past = isPast(ev.endAt);
  const isShort = block.height < 44;
  const isTiny = block.height < 30;
  const selected = selectedId === ev.id;

  const GAP = 2;
  const colWidth = (100 - GAP * (block.totalCols - 1)) / block.totalCols;
  const leftPct = block.col * (colWidth + GAP);

  const borderColor = SOURCE_COLORS[ev.source] ?? SOURCE_COLORS.local;

  const bgMap: Record<string, string> = {
    google:
      "bg-[rgba(166,61,61,0.03)] hover:bg-[rgba(166,61,61,0.07)]",
    task: "bg-[rgba(180,120,40,0.03)] hover:bg-[rgba(180,120,40,0.07)]",
    system: "bg-[rgba(43,96,85,0.03)] hover:bg-[rgba(43,96,85,0.07)]",
    local: "bg-[rgba(43,96,85,0.04)] hover:bg-[rgba(43,96,85,0.09)]",
  };
  const bgClass = bgMap[ev.source] ?? bgMap.local;

  const borderOutline =
    ev.source === "google"
      ? "border-[rgba(166,61,61,0.12)]"
      : ev.source === "task"
        ? "border-warning/12"
        : "border-accent/10";

  const TypeIcon = EVENT_TYPE_ICON[ev.type] ?? Calendar;

  const tooltipLines = [
    ev.title,
    `${formatTime(ev.startAt)} – ${formatTime(ev.endAt)}`,
    ev.location ? `📍 ${ev.location}` : "",
    ev.taskId ? `🔗 关联任务` : "",
    ev.projectName ? `📂 ${ev.projectName}` : "",
    ev.description ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      onClick={() => onSelect(ev)}
      className={cn(
        "group absolute z-10 cursor-pointer overflow-hidden rounded-[6px] border border-l-[3px] text-left transition-all",
        borderColor,
        borderOutline,
        bgClass,
        past && !selected && "opacity-50",
        selected && "ring-2 ring-accent/40 ring-offset-1"
      )}
      style={{
        top: block.top,
        height: block.height,
        left: `${leftPct}%`,
        width: `${colWidth}%`,
      }}
      title={tooltipLines}
    >
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden px-2",
          isTiny ? "justify-center py-0" : isShort ? "py-1" : "py-1.5"
        )}
      >
        {/* title row */}
        <div className="flex items-start gap-1">
          {!isTiny && (
            <TypeIcon
              size={9}
              className="mt-0.5 shrink-0 text-muted"
            />
          )}
          <p
            className={cn(
              "min-w-0 flex-1 truncate font-medium text-foreground",
              isTiny ? "text-[9px]" : "text-[11px]"
            )}
          >
            {ev.title}
          </p>
        </div>

        {/* time */}
        {!isTiny && (
          <p className="mt-0.5 flex items-center gap-1 text-[9px] text-muted">
            <Clock size={8} />
            {formatTime(ev.startAt)} – {formatTime(ev.endAt)}
          </p>
        )}

        {/* location */}
        {!isShort && ev.location && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-muted">
            <MapPin size={8} />
            {ev.location}
          </p>
        )}

        {/* project name */}
        {!isShort && ev.projectName && (
          <p className="mt-0.5 truncate text-[9px] text-muted">
            📂 {ev.projectName}
          </p>
        )}

        {/* source badge */}
        {ev.source === "google" && !isShort && (
          <span className="mt-auto inline-flex w-fit rounded bg-[rgba(166,61,61,0.06)] px-1 py-0.5 text-[8px] font-medium text-[#a63d3d]">
            Google
          </span>
        )}
        {ev.source === "task" && !isShort && (
          <span className="mt-auto inline-flex w-fit rounded bg-warning/8 px-1 py-0.5 text-[8px] font-medium text-warning">
            截止
          </span>
        )}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════
   DateSwitcher
   ═══════════════════════════════════════════ */

function DateSwitcher({
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
   TodayTimelineView (ScheduleEvent version)
   ═══════════════════════════════════════════ */

function TodayTimelineView({
  events,
  date,
  onDateChange,
  onAdd,
  onSelectEvent,
  selectedEventId,
}: {
  events: ScheduleEvent[];
  date: Date;
  onDateChange: (d: Date) => void;
  onAdd: () => void;
  onSelectEvent: (ev: ScheduleEvent) => void;
  selectedEventId: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);
  const blocks = computeLayout(timedEvents);
  const showTimeLine = isToday(date);

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => MIN_HOUR + i);

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Calendar size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">日程</h2>
        <DateSwitcher date={date} onChange={onDateChange} />
        <span className="ml-auto rounded-full bg-[rgba(43,96,85,0.06)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-accent">
          {events.length} 项
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="ml-1 flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        >
          <Plus size={12} />
          添加
        </button>
      </div>

      {/* all-day events */}
      <AllDayEventsRow
        events={allDayEvents}
        onSelect={onSelectEvent}
        selectedId={selectedEventId}
      />

      {/* timeline */}
      {timedEvents.length > 0 ? (
        <div
          ref={scrollRef}
          className="relative max-h-[520px] overflow-y-auto scroll-smooth"
        >
          <div
            className="relative flex"
            style={{ height: TOTAL_HOURS * HOUR_HEIGHT + 40 }}
          >
            {/* time axis */}
            <div className="sticky left-0 z-10 w-[52px] shrink-0 border-r border-border/60 bg-card-bg/95 backdrop-blur-sm">
              {hours.map((h) => (
                <div
                  key={h}
                  className="relative"
                  style={{ height: HOUR_HEIGHT }}
                >
                  <span className="absolute -top-[6px] right-2.5 select-none text-[10px] font-medium tabular-nums text-muted/60">
                    {String(h).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            {/* event area */}
            <div className="relative min-w-0 flex-1">
              {/* hour + half-hour grid lines */}
              {hours.map((h) => {
                const y = (h - MIN_HOUR) * HOUR_HEIGHT;
                return (
                  <div key={h}>
                    <div
                      className="absolute left-0 right-0 border-b border-border/30"
                      style={{ top: y }}
                    />
                    <div
                      className="absolute left-0 right-0 border-b border-border/15"
                      style={{ top: y + HOUR_HEIGHT / 2 }}
                    />
                  </div>
                );
              })}

              {/* event blocks */}
              <div className="absolute inset-x-1 top-0 bottom-0">
                {blocks.map((b) => (
                  <TimelineEventBlock
                    key={b.event.id}
                    block={b}
                    onSelect={onSelectEvent}
                    selectedId={selectedEventId}
                  />
                ))}
              </div>

              {/* current time */}
              {showTimeLine && <CurrentTimeLine containerRef={scrollRef} />}
            </div>
          </div>
        </div>
      ) : allDayEvents.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(43,96,85,0.05)]">
            <Calendar size={18} className="text-accent/40" />
          </div>
          <p className="text-sm text-muted">当天暂无日程安排</p>
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 text-xs font-medium text-accent hover:underline"
          >
            添加一个日程
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════
   EventFormModal (unchanged)
   ═══════════════════════════════════════════ */

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
              {isEdit ? "保存" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main export
   ═══════════════════════════════════════════ */

export function DashboardCalendarSection({
  events,
  scheduleEvents,
  scheduleDate,
  onDateChange,
  showEventForm,
  editingEvent,
  onClose,
  onSaved,
  onOpenAdd,
  onOpenEdit,
  onDelete,
  onOpenProject,
}: {
  events: CalendarEventItem[];
  scheduleEvents: ScheduleEvent[];
  scheduleDate: Date;
  onDateChange: (date: Date) => void;
  showEventForm: boolean;
  editingEvent: CalendarEventItem | null;
  onClose: () => void;
  onSaved: () => void;
  onOpenAdd: () => void;
  onOpenEdit: (ev: CalendarEventItem) => void;
  onDelete: (id: string) => void;
  onOpenProject?: (projectId: string) => void;
}) {
  const [drawerEvent, setDrawerEvent] = useState<ScheduleEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSelectEvent = useCallback((ev: ScheduleEvent) => {
    setDrawerEvent(ev);
    setDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleEditFromDrawer = useCallback(
    (ev: ScheduleEvent) => {
      const realId = ev.id.replace(/^cal_/, "");
      const original = events.find((e) => e.id === realId);
      if (original) {
        setDrawerOpen(false);
        onOpenEdit(original);
      }
    },
    [events, onOpenEdit]
  );

  const handleDeleteFromDrawer = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete]
  );

  return (
    <>
      <TodayTimelineView
        events={scheduleEvents}
        date={scheduleDate}
        onDateChange={onDateChange}
        onAdd={onOpenAdd}
        onSelectEvent={handleSelectEvent}
        selectedEventId={drawerOpen ? drawerEvent?.id ?? null : null}
      />
      <ScheduleEventDrawer
        event={drawerEvent}
        open={drawerOpen}
        onClose={handleCloseDrawer}
        onEdit={handleEditFromDrawer}
        onDelete={handleDeleteFromDrawer}
        onOpenProject={onOpenProject}
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
