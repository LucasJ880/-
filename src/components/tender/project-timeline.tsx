"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/lib/tender/types";
import { formatISODateToronto, formatDateTimeToronto } from "@/lib/time";

function fmtDate(d: Date): string {
  return formatISODateToronto(d);
}

function fmtDateTime(d: Date): string {
  return formatDateTimeToronto(d);
}

const EVENT_COLORS: Record<string, { dot: string; text: string }> = {
  completed: { dot: "bg-success", text: "text-success-text" },
  active: { dot: "bg-accent", text: "text-accent" },
  upcoming: { dot: "bg-warning", text: "text-warning-text" },
  overdue: { dot: "bg-danger", text: "text-danger-text" },
};

const STATUS_LABEL: Record<string, string> = {
  completed: "已完成",
  active: "进行中",
  upcoming: "待进行",
  overdue: "已逾期",
};

/**
 * 桌面端：水平真实时间轴，节点按真实日期比例定位。
 * 移动端：纵向时间轴。
 */
export function ProjectTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted">暂无时间线数据</p>
    );
  }

  return (
    <>
      <HorizontalTimeline events={events} />
      <VerticalTimeline events={events} />
    </>
  );
}

function HorizontalTimeline({ events }: { events: TimelineEvent[] }) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div className="hidden md:block">
      <div className="relative mx-4 h-40">
        {/* Track line */}
        <div className="absolute left-0 right-0 top-[60px] h-0.5 rounded-full bg-border" />

        {events.map((ev, i) => {
          const isExternal = ev.kind === "external";
          const isToday = ev.kind === "today";
          const colors = EVENT_COLORS[ev.status] || EVENT_COLORS.upcoming;
          const stagger = i % 2 === 0;

          return (
            <div
              key={ev.key}
              className="absolute"
              style={{
                left: `${ev.position * 100}%`,
                transform: "translateX(-50%)",
                top: 0,
                bottom: 0,
              }}
              onMouseEnter={() => setHoveredKey(ev.key)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              {/* Label above/below */}
              <div
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 text-center whitespace-nowrap",
                  stagger ? "top-0" : "bottom-0"
                )}
              >
                <span
                  className={cn(
                    "block text-[10px] leading-tight",
                    isExternal ? "font-semibold" : "font-normal",
                    isToday ? "font-bold text-accent" : colors.text
                  )}
                >
                  {ev.label}
                </span>
                <span className="block text-[10px] text-muted">
                  {fmtDate(ev.date)}
                </span>
              </div>

              {/* Vertical stem */}
              <div
                className={cn(
                  "absolute left-1/2 -translate-x-1/2",
                  stagger
                    ? "top-[30px] h-[30px]"
                    : "top-[62px] h-[30px]"
                )}
              >
                <div
                  className={cn(
                    "mx-auto h-full w-px",
                    isToday
                      ? "bg-accent"
                      : isExternal
                        ? colors.dot
                        : "bg-border"
                  )}
                />
              </div>

              {/* Dot on track */}
              <div
                className={cn(
                  "absolute left-1/2 top-[56px] -translate-x-1/2 rounded-full transition-transform",
                  isToday
                    ? "h-3 w-3 bg-accent ring-2 ring-accent/30"
                    : isExternal
                      ? cn("h-3.5 w-3.5", colors.dot, "ring-2 ring-white")
                      : cn("h-2.5 w-2.5", colors.dot)
                )}
              />

              {/* Tooltip */}
              {hoveredKey === ev.key && !isToday && (
                <div
                  className={cn(
                    "absolute z-20 rounded-lg border border-border bg-card-bg px-3 py-2 text-xs shadow-lg",
                    "left-1/2 -translate-x-1/2",
                    stagger ? "top-[96px]" : "bottom-[96px]"
                  )}
                >
                  <p className="font-semibold text-foreground">{ev.label}</p>
                  <p className="text-muted">{fmtDateTime(ev.date)}</p>
                  <p className={colors.text}>
                    {STATUS_LABEL[ev.status] || ev.status}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerticalTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="block md:hidden">
      <div className="relative ml-4 border-l-2 border-border pl-6">
        {events.map((ev) => {
          const isExternal = ev.kind === "external";
          const isToday = ev.kind === "today";
          const colors = EVENT_COLORS[ev.status] || EVENT_COLORS.upcoming;

          return (
            <div key={ev.key} className="relative pb-5 last:pb-0">
              {/* Dot on the line */}
              <div
                className={cn(
                  "absolute -left-[31px] top-0.5 rounded-full",
                  isToday
                    ? "h-3 w-3 bg-accent ring-2 ring-accent/30"
                    : isExternal
                      ? cn("h-3.5 w-3.5", colors.dot, "ring-2 ring-white")
                      : cn("h-2.5 w-2.5 translate-x-[1px] translate-y-[1px]", colors.dot)
                )}
              />

              <div>
                <span
                  className={cn(
                    "text-xs",
                    isToday ? "font-bold text-accent" : isExternal ? cn("font-semibold", colors.text) : colors.text
                  )}
                >
                  {ev.label}
                </span>
                {!isToday && (
                  <span className="ml-2 text-[11px] text-muted">
                    {fmtDateTime(ev.date)}
                  </span>
                )}
                {!isToday && (
                  <span className={cn("ml-2 text-[10px]", colors.text)}>
                    {STATUS_LABEL[ev.status]}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
