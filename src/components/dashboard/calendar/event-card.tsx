"use client";

import { Calendar, Clock, MapPin, ListTodo, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeToronto } from "@/lib/time";
import type { ScheduleEvent } from "../types";

/* ═══════════════════════════════════════════
   Shared constants
   ═══════════════════════════════════════════ */

export interface LayoutBlock {
  event: ScheduleEvent;
  top: number;
  height: number;
  col: number;
  totalCols: number;
}

export const EVENT_TYPE_ICON: Record<string, typeof Calendar> = {
  calendar: Calendar,
  task_due: ListTodo,
  reminder: Bell,
  followup: Bell,
};

export const SOURCE_COLORS: Record<string, string> = {
  google: "border-l-[#a63d3d]/50",
  task: "border-l-warning/50",
  system: "border-l-accent/40",
  local: "border-l-accent/60",
};

/* ═══════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════ */

function formatTime(iso: string): string {
  return formatTimeToronto(iso);
}

function isPast(endTime: string): boolean {
  return new Date(endTime).getTime() < Date.now();
}

/* ═══════════════════════════════════════════
   TimelineEventBlock
   ═══════════════════════════════════════════ */

export function TimelineEventBlock({
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
