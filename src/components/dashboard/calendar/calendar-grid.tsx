"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatTimeToronto,
  isTodayToronto,
  torontoTimeParts,
} from "@/lib/time";
import type { ScheduleEvent } from "../types";
import {
  TimelineEventBlock,
  EVENT_TYPE_ICON,
  type LayoutBlock,
} from "./event-card";
import { DateSwitcher } from "./calendar-filters";

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const HOUR_HEIGHT = 60;
const MIN_HOUR = 6;
const MAX_HOUR = 23;
const TOTAL_HOURS = MAX_HOUR - MIN_HOUR;

/* ═══════════════════════════════════════════
   Overlap layout
   ═══════════════════════════════════════════ */

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

function isToday(d: Date): boolean {
  return isTodayToronto(d);
}

/* ═══════════════════════════════════════════
   AllDayEventsRow
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
   TodayTimelineView
   ═══════════════════════════════════════════ */

export function TodayTimelineView({
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
