"use client";

import { useMemo, useCallback } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Ruler,
  Wrench,
  RotateCcw,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface GoogleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  calendarId?: string;
  calendarName?: string;
  color?: string;
}

interface Appointment {
  id: string;
  customerId: string;
  customer: { id: string; name: string; phone?: string; address?: string };
  opportunity?: { id: string; title: string; stage: string } | null;
  assignedTo: { id: string; name: string };
  type: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  address?: string;
  contactPhone?: string;
  status: string;
  notes?: string;
  googleEventId?: string | null;
  googleSyncedAt?: string | null;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof Ruler }> = {
  measure: { label: "量房", color: "bg-blue-500", icon: Ruler },
  install: { label: "安装", color: "bg-emerald-500", icon: Wrench },
  revisit: { label: "回访", color: "bg-purple-500", icon: RotateCcw },
  consultation: { label: "咨询", color: "bg-orange-500", icon: MessageSquare },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: "已排期", color: "bg-blue-100 text-blue-700" },
  confirmed: { label: "已确认", color: "bg-emerald-100 text-emerald-700" },
  in_progress: { label: "进行中", color: "bg-amber-100 text-amber-700" },
  completed: { label: "已完成", color: "bg-green-100 text-green-700" },
  cancelled: { label: "已取消", color: "bg-gray-100 text-gray-500" },
  no_show: { label: "未到", color: "bg-red-100 text-red-700" },
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

/* ── Month View ── */
export function CalendarMonthView({
  year,
  month,
  appointments,
  googleEvents,
  onSelectAppt,
}: {
  year: number;
  month: number;
  appointments: Appointment[];
  googleEvents: GoogleEvent[];
  onSelectAppt: (appt: Appointment) => void;
}) {
  const today = new Date();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const calendarDays = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [firstDay, daysInMonth]);

  const getApptsForDay = useCallback(
    (day: number) => {
      const target = new Date(year, month, day);
      return appointments.filter((a) => isSameDay(new Date(a.startAt), target));
    },
    [appointments, year, month],
  );

  const getGoogleEventsForDay = useCallback(
    (day: number) => {
      const target = new Date(year, month, day);
      return googleEvents.filter((e) => {
        const start = new Date(e.startTime);
        return start.getFullYear() === target.getFullYear() &&
          start.getMonth() === target.getMonth() &&
          start.getDate() === target.getDate();
      });
    },
    [googleEvents, year, month],
  );

  return (
    <>
      <div className="grid grid-cols-7 border-b border-border">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {calendarDays.map((day, i) => {
          const isToday = day !== null && isSameDay(new Date(year, month, day), today);
          const dayAppts = day ? getApptsForDay(day) : [];
          const dayGEvents = day ? getGoogleEventsForDay(day) : [];
          const totalItems = dayAppts.length + dayGEvents.length;
          const maxShow = 3;
          return (
            <div
              key={i}
              className={cn(
                "min-h-[100px] border-b border-r border-border/50 p-1.5",
                day === null && "bg-muted/20",
              )}
            >
              {day !== null && (
                <>
                  <div
                    className={cn(
                      "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      isToday ? "bg-primary text-white" : "text-foreground",
                    )}
                  >
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayAppts.slice(0, maxShow).map((a) => {
                      const tc = TYPE_CONFIG[a.type] ?? TYPE_CONFIG.measure;
                      return (
                        <button
                          key={a.id}
                          onClick={() => onSelectAppt(a)}
                          className={cn(
                            "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-white truncate",
                            tc.color,
                            a.status === "cancelled" && "opacity-40 line-through",
                          )}
                        >
                          {a.googleEventId && <CheckCircle2 size={8} className="shrink-0 opacity-70" />}
                          {formatTime(a.startAt)} {a.customer?.name}
                        </button>
                      );
                    })}
                    {dayGEvents.slice(0, Math.max(0, maxShow - dayAppts.length)).map((ge) => (
                      <div
                        key={`g-${ge.id}`}
                        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] truncate"
                        style={{
                          backgroundColor: ge.color || "#4285f4",
                          color: "#fff",
                        }}
                        title={`${ge.calendarName || "Google"}: ${ge.title}`}
                      >
                        {ge.allDay ? "全天" : formatTime(ge.startTime)} {ge.title}
                      </div>
                    ))}
                    {totalItems > maxShow && (
                      <p className="text-[10px] text-muted-foreground px-1">+{totalItems - maxShow} more</p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── List View ── */
function AppointmentRow({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const tc = TYPE_CONFIG[appt.type] ?? TYPE_CONFIG.measure;
  const sc = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.scheduled;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/20 transition-colors">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-white", tc.color)}>
        <tc.icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{appt.title}</p>
        <p className="text-xs text-muted-foreground">{appt.customer?.name} · {formatDate(appt.startAt)} {formatTime(appt.startAt)}</p>
      </div>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", sc.color)}>{sc.label}</span>
    </button>
  );
}

function GoogleEventRow({ event }: { event: GoogleEvent }) {
  const color = event.color || "#4285f4";
  return (
    <div
      className="flex w-full items-center gap-4 p-4 text-left"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
        style={{ backgroundColor: color }}
      >
        <CalendarDays size={18} className="text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{event.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          {event.calendarName || "Google"} ·{" "}
          {event.allDay
            ? `${formatDate(event.startTime)} 全天`
            : `${formatDate(event.startTime)} ${formatTime(event.startTime)}`}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
        Google
      </span>
    </div>
  );
}

export function CalendarListView({
  appointments,
  googleEvents = [],
  loading,
  onSelectAppt,
}: {
  appointments: Appointment[];
  googleEvents?: GoogleEvent[];
  loading: boolean;
  onSelectAppt: (appt: Appointment) => void;
}) {
  // 合并两个来源，按时间升序展示
  const merged = [
    ...appointments.map((a) => ({
      kind: "appt" as const,
      time: new Date(a.startAt).getTime(),
      appt: a,
    })),
    ...googleEvents.map((g) => ({
      kind: "google" as const,
      time: new Date(g.startTime).getTime(),
      event: g,
    })),
  ].sort((a, b) => a.time - b.time);

  return (
    <div className="divide-y divide-border/50">
      {loading ? (
        <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
      ) : merged.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
          暂无日程
        </div>
      ) : (
        merged.map((item) =>
          item.kind === "appt" ? (
            <AppointmentRow
              key={`a-${item.appt.id}`}
              appt={item.appt}
              onClick={() => onSelectAppt(item.appt)}
            />
          ) : (
            <GoogleEventRow key={`g-${item.event.id}`} event={item.event} />
          ),
        )
      )}
    </div>
  );
}
