"use client";

import { useMemo, useRef, useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 时间网格视图（Google 风格）
 * - days=7：周视图
 * - days=1：日视图
 * - 0-24 小时全量渲染，顶部独立全天事件条
 */

interface GoogleEventLite {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  calendarId?: string;
  calendarName?: string;
  color?: string;
  description?: string | null;
  htmlLink?: string | null;
  recurringEventId?: string | null;
  accessRole?: string;
}

interface AppointmentLite {
  id: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  customer?: { name?: string } | null;
  status: string;
  googleEventId?: string | null;
}

const TYPE_COLOR: Record<string, string> = {
  measure: "#3b82f6",
  install: "#10b981",
  revisit: "#a855f7",
  consultation: "#f97316",
};

const HOUR_HEIGHT = 48;
const TIME_GUTTER_WIDTH = 56;
const MIN_EVENT_HEIGHT = 22;

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function minutesFromMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** 周一起还是周日起？这里用周日起（与 Google 一致） */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const diff = d.getDay(); // 0 = 周日
  d.setDate(d.getDate() - diff);
  return d;
}

export function CalendarTimeGrid<
  A extends AppointmentLite,
  G extends GoogleEventLite,
>({
  startDate,
  days,
  appointments,
  googleEvents,
  onSelectAppt,
  onSelectGoogleEvent,
}: {
  /** 起始日期（周视图应传 startOfWeek，日视图即当天） */
  startDate: Date;
  days: number;
  appointments: A[];
  googleEvents: G[];
  onSelectAppt: (appt: A) => void;
  onSelectGoogleEvent: (event: G) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const today = new Date();

  const dayList = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days],
  );

  // 自动滚动到工作时间（7 AM）附近，避免一进来空一大片
  useEffect(() => {
    if (scrollRef.current) {
      // 如果今天在范围内，滚到当前时间附近；否则滚到 7 AM
      const nowInRange = dayList.some((d) => isSameDay(d, today));
      const scrollMinutes = nowInRange
        ? today.getHours() * 60 + today.getMinutes() - 60 // 当前时间往前 1 小时
        : 7 * 60; // 7 AM
      scrollRef.current.scrollTop = Math.max(0, (scrollMinutes / 60) * HOUR_HEIGHT - 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, days]);

  // 拆分：全天 vs 按时间段
  const byDayTimed: Array<{
    appts: A[];
    gevents: G[];
  }> = dayList.map(() => ({ appts: [] as A[], gevents: [] as G[] }));
  const byDayAllDay: Array<G[]> = dayList.map(() => [] as G[]);

  for (const ap of appointments) {
    const s = new Date(ap.startAt);
    const idx = dayList.findIndex((d) => isSameDay(d, s));
    if (idx >= 0) byDayTimed[idx].appts.push(ap);
  }
  for (const ge of googleEvents) {
    const s = new Date(ge.startTime);
    const idx = dayList.findIndex((d) => isSameDay(d, s));
    if (idx < 0) continue;
    if (ge.allDay) byDayAllDay[idx].push(ge);
    else byDayTimed[idx].gevents.push(ge);
  }

  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div className="flex flex-col h-[720px]">
      {/* Header: 星期 + 日期 */}
      <div
        className="flex border-b border-border shrink-0"
        style={{ paddingLeft: TIME_GUTTER_WIDTH }}
      >
        {dayList.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div
              key={i}
              className="flex-1 min-w-0 border-l border-border/60 px-2 py-2 text-center"
            >
              <div className="text-[11px] font-medium text-muted-foreground">
                星期{weekdayLabels[d.getDay()]}
              </div>
              <div
                className={cn(
                  "mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                  isToday ? "bg-primary text-white" : "text-foreground",
                )}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* 全天事件条 */}
      {byDayAllDay.some((list) => list.length > 0) && (
        <div
          className="flex border-b border-border bg-muted/10 shrink-0"
          style={{ paddingLeft: TIME_GUTTER_WIDTH }}
        >
          {byDayAllDay.map((list, i) => (
            <div
              key={i}
              className="flex-1 min-w-0 border-l border-border/60 p-1 space-y-0.5 min-h-[30px]"
            >
              {list.map((ge) => (
                <button
                  key={ge.id}
                  onClick={() => onSelectGoogleEvent(ge)}
                  className="block w-full rounded px-1.5 py-0.5 text-left text-[11px] text-white truncate hover:brightness-110"
                  style={{ backgroundColor: ge.color || "#4285f4" }}
                  title={`${ge.calendarName || "Google"}: ${ge.title}`}
                >
                  {ge.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 时间网格主体（可滚动） */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        <div className="flex relative" style={{ height: 24 * HOUR_HEIGHT }}>
          {/* 左侧时间刻度 */}
          <div
            className="shrink-0 text-[10px] text-muted-foreground"
            style={{ width: TIME_GUTTER_WIDTH }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="relative pr-2 text-right"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute right-2 -top-1.5 bg-white/60 px-1">
                  {h === 0 ? "" : `${h}:00`}
                </span>
              </div>
            ))}
          </div>

          {/* 列 */}
          {dayList.map((d, i) => {
            const isToday = isSameDay(d, today);
            const { appts, gevents } = byDayTimed[i];
            const nowMinutes = isToday
              ? today.getHours() * 60 + today.getMinutes()
              : null;

            return (
              <div
                key={i}
                className={cn(
                  "flex-1 min-w-0 relative border-l border-border/60",
                  isToday && "bg-blue-50/30",
                )}
              >
                {/* 小时横线 */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/40"
                    style={{ top: h * HOUR_HEIGHT }}
                  />
                ))}

                {/* 预约 */}
                {appts.map((a) => {
                  const startMin = minutesFromMidnight(a.startAt);
                  const endMin = minutesFromMidnight(a.endAt);
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max(
                    MIN_EVENT_HEIGHT,
                    ((endMin - startMin) / 60) * HOUR_HEIGHT - 2,
                  );
                  const color = TYPE_COLOR[a.type] || "#3b82f6";
                  return (
                    <button
                      key={a.id}
                      onClick={() => onSelectAppt(a)}
                      className={cn(
                        "absolute left-0.5 right-0.5 rounded px-1.5 py-1 text-left text-[10px] overflow-hidden text-white shadow-sm hover:brightness-110",
                        a.status === "cancelled" && "opacity-40 line-through",
                      )}
                      style={{
                        top,
                        height,
                        backgroundColor: color,
                        zIndex: 2,
                      }}
                      title={`${a.customer?.name || ""} ${a.title}`}
                    >
                      <div className="flex items-center gap-1 font-medium truncate">
                        {a.googleEventId && (
                          <CheckCircle2 size={9} className="shrink-0 opacity-80" />
                        )}
                        {formatShortTime(a.startAt)}
                      </div>
                      <div className="truncate">
                        {a.customer?.name} {a.title}
                      </div>
                    </button>
                  );
                })}

                {/* Google 事件 */}
                {gevents.map((ge) => {
                  const startMin = minutesFromMidnight(ge.startTime);
                  const endMin = minutesFromMidnight(ge.endTime);
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max(
                    MIN_EVENT_HEIGHT,
                    ((endMin - startMin) / 60) * HOUR_HEIGHT - 2,
                  );
                  const color = ge.color || "#4285f4";
                  return (
                    <button
                      key={ge.id}
                      onClick={() => onSelectGoogleEvent(ge)}
                      className="absolute left-0.5 right-0.5 rounded px-1.5 py-1 text-left text-[10px] overflow-hidden text-white shadow-sm hover:brightness-110"
                      style={{
                        top,
                        height,
                        backgroundColor: color,
                        zIndex: 1,
                      }}
                      title={`${ge.calendarName || "Google"}: ${ge.title}${ge.location ? " @ " + ge.location : ""}`}
                    >
                      <div className="font-medium truncate">
                        {formatShortTime(ge.startTime)}
                      </div>
                      <div className="truncate">{ge.title}</div>
                    </button>
                  );
                })}

                {/* 今日当前时间红线 */}
                {nowMinutes !== null && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                      <div className="border-t border-red-500" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}
