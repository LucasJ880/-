"use client";

import { useState } from "react";
import {
  MapPin,
  Loader2,
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

interface GoogleCalendarInfo {
  id: string;
  summary: string;
  backgroundColor: string;
  primary: boolean;
  selected: boolean;
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

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function CalendarSidebar({
  todayAppts,
  todayGEvents,
  upcomingAppts,
  gcalConnected,
  gcalList,
  googleEventsCount,
  savingCals,
  onToggleCalendar,
  onBulkSelectCalendars,
  onSelectAppt,
}: {
  todayAppts: Appointment[];
  todayGEvents: GoogleEvent[];
  upcomingAppts: Appointment[];
  gcalConnected: boolean;
  gcalList: GoogleCalendarInfo[];
  googleEventsCount: number;
  savingCals: boolean;
  onToggleCalendar: (calId: string) => void;
  onBulkSelectCalendars: (ids: string[]) => void;
  onSelectAppt: (appt: Appointment) => void;
}) {
  const [showCalPicker, setShowCalPicker] = useState(false);

  return (
    <div className="space-y-4">
      {/* Today */}
      <div className="rounded-xl border border-border bg-white/60 p-4">
        <h3 className="mb-3 text-sm font-semibold">今日日程 ({todayAppts.length + todayGEvents.length})</h3>
        {todayAppts.length === 0 && todayGEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">今天没有日程</p>
        ) : (
          <div className="space-y-2">
            {todayAppts.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelectAppt(a)}
                className="w-full rounded-lg border border-border/50 p-2.5 text-left hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className={cn("h-2 w-2 rounded-full", TYPE_CONFIG[a.type]?.color ?? "bg-gray-400")} />
                  <span className="text-xs font-medium">{formatTime(a.startAt)}</span>
                  <span className="text-xs text-muted-foreground">{TYPE_CONFIG[a.type]?.label}</span>
                </div>
                <p className="mt-1 text-sm font-medium truncate">{a.customer?.name}</p>
                {a.address && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                    <MapPin size={10} /> {a.address}
                  </p>
                )}
              </button>
            ))}
            {todayGEvents.map((ge) => (
              <div
                key={`g-${ge.id}`}
                className="w-full rounded-lg border p-2.5 text-left"
                style={{ borderColor: ge.color || "#4285f4", borderLeftWidth: 3 }}
              >
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: ge.color || "#4285f4" }} />
                  <span className="text-xs font-medium">{ge.allDay ? "全天" : formatTime(ge.startTime)}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{ge.calendarName}</span>
                </div>
                <p className="mt-1 text-sm font-medium truncate">{ge.title}</p>
                {ge.location && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                    <MapPin size={10} /> {ge.location}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div className="rounded-xl border border-border bg-white/60 p-4">
        <h3 className="mb-3 text-sm font-semibold">即将到来</h3>
        <div className="space-y-2">
          {upcomingAppts.slice(0, 5).map((a) => (
            <button
              key={a.id}
              onClick={() => onSelectAppt(a)}
              className="w-full rounded-lg p-2 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className={cn("h-2 w-2 rounded-full", TYPE_CONFIG[a.type]?.color ?? "bg-gray-400")} />
                <span className="text-[11px] text-muted-foreground">{formatDate(a.startAt)} {formatTime(a.startAt)}</span>
              </div>
              <p className="mt-0.5 text-xs font-medium truncate">{a.title}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Google Calendar management */}
      {gcalConnected && (
        <div className="rounded-xl border border-border bg-white/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Google 日历</h3>
            <button
              onClick={() => setShowCalPicker(!showCalPicker)}
              className="text-[11px] text-primary hover:underline"
            >
              {showCalPicker ? "收起" : "管理日历"}
            </button>
          </div>
          {!showCalPicker ? (
            <div className="space-y-1.5">
              {gcalList.filter((c) => c.selected).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: c.backgroundColor }} />
                  <span className="truncate">{c.summary}</span>
                  {c.primary && <span className="text-[10px] text-muted-foreground">(主)</span>}
                </div>
              ))}
              {gcalList.filter((c) => c.selected).length === 0 && (
                <p className="text-xs text-muted-foreground">未选择日历</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                本月 Google 事件: {googleEventsCount} 条
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {gcalList.length > 1 && (
                <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-border/60">
                  <button
                    onClick={() => onBulkSelectCalendars(gcalList.map((c) => c.id))}
                    disabled={savingCals}
                    className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
                  >
                    全选
                  </button>
                  <button
                    onClick={() => {
                      const primary = gcalList.find((c) => c.primary);
                      onBulkSelectCalendars(primary ? [primary.id] : ["primary"]);
                    }}
                    disabled={savingCals}
                    className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
                  >
                    仅主日历
                  </button>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {gcalList.filter((c) => c.selected).length}/{gcalList.length}
                  </span>
                </div>
              )}
              {gcalList.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onToggleCalendar(c.id)}
                  disabled={savingCals}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs transition-colors",
                    c.selected ? "bg-primary/5 border border-primary/20" : "hover:bg-muted/30 border border-transparent",
                  )}
                >
                  <div
                    className={cn("h-3 w-3 rounded-sm border-2 shrink-0", c.selected ? "border-transparent" : "border-border")}
                    style={c.selected ? { backgroundColor: c.backgroundColor } : undefined}
                  />
                  <span className="truncate flex-1">{c.summary}</span>
                  {c.primary && <span className="text-[10px] text-muted-foreground">(主)</span>}
                </button>
              ))}
              {savingCals && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1">
                  <Loader2 size={10} className="animate-spin" /> 保存中...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
