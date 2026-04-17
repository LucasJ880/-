"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { CalendarMonthView, CalendarListView } from "./calendar-grid";
import { CalendarTimeGrid, startOfWeek } from "./calendar-time-grid";
import { CalendarSidebar } from "./calendar-sidebar";
import { AppointmentDetailDialog, CreateAppointmentDialog } from "./appointment-dialog";
import { GoogleEventDialog, type EditableGoogleEvent } from "./google-event-dialog";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { PullToRefresh } from "@/components/pull-to-refresh";

interface GoogleCalendarInfo {
  id: string;
  summary: string;
  backgroundColor: string;
  primary: boolean;
  selected: boolean;
}

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
  description?: string | null;
  htmlLink?: string | null;
  recurringEventId?: string | null;
  accessRole?: string;
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

type ViewMode = "month" | "week" | "day" | "list";

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export default function SalesCalendarPage() {
  const { isMobile, mounted } = useIsMobile();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  useEffect(() => {
    if (mounted && isMobile) setViewMode("list");
  }, [mounted, isMobile]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalEmail, setGcalEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([]);
  const [gcalList, setGcalList] = useState<GoogleCalendarInfo[]>([]);
  const [savingCals, setSavingCals] = useState(false);
  const [gcalTokenExpired, setGcalTokenExpired] = useState(false);
  const [selectedGoogleEvent, setSelectedGoogleEvent] =
    useState<EditableGoogleEvent | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // 根据视图计算本次拉取的时间窗口
  const { rangeStart, rangeEnd } = (() => {
    if (viewMode === "week") {
      const ws = startOfWeek(currentDate);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 7);
      return { rangeStart: ws, rangeEnd: we };
    }
    if (viewMode === "day") {
      const s = new Date(currentDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setDate(s.getDate() + 1);
      return { rangeStart: s, rangeEnd: e };
    }
    // month / list
    const s = new Date(year, month, 1);
    const e = new Date(year, month + 1, 0, 23, 59, 59);
    return { rangeStart: s, rangeEnd: e };
  })();

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    const start = rangeStart.toISOString();
    const end = rangeEnd.toISOString();
    try {
      const apptRes = await apiJson<{ appointments?: Appointment[] }>(
        `/api/sales/appointments?start=${start}&end=${end}`,
      );
      setAppointments(apptRes.appointments ?? []);

      try {
        const gcalRes = await apiJson<GoogleEvent[]>(
          `/api/calendar/google?timeMin=${start}&timeMax=${end}`,
        );
        setGoogleEvents(Array.isArray(gcalRes) ? gcalRes : []);
        setGcalTokenExpired(false);
      } catch (err) {
        setGoogleEvents([]);
        if (err instanceof Error && err.message === "token_expired") {
          setGcalTokenExpired(true);
        }
      }
    } catch {
      setAppointments([]);
      setGoogleEvents([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime(), rangeEnd.getTime()]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  useEffect(() => {
    apiJson<{ connected: boolean; email?: string }>("/api/auth/google/status").then((d) => {
      setGcalConnected(d.connected);
      setGcalEmail(d.email ?? null);
      if (d.connected) {
        apiJson<{ calendars?: GoogleCalendarInfo[] }>("/api/calendar/google/calendars")
          .then((cal) => {
            setGcalList(cal.calendars ?? []);
            setGcalTokenExpired(false);
          })
          .catch((err) => {
            if (err instanceof Error && err.message === "token_expired") {
              setGcalTokenExpired(true);
            }
          });
      }
    }).catch(() => {});
  }, []);

  const saveCalendarSelection = async (ids: string[]) => {
    setSavingCals(true);
    try {
      await apiFetch("/api/calendar/google/calendars", {
        method: "POST",
        body: JSON.stringify({ calendarIds: ids }),
      });
      setGcalList((prev) => prev.map((c) => ({ ...c, selected: ids.includes(c.id) })));
      await loadAppointments();
    } catch { /* ignore */ }
    finally { setSavingCals(false); }
  };

  const toggleCalendar = (calId: string) => {
    const current = gcalList.filter((c) => c.selected).map((c) => c.id);
    const next = current.includes(calId) ? current.filter((id) => id !== calId) : [...current, calId];
    if (next.length === 0) return;
    saveCalendarSelection(next);
  };

  const handleSyncToGoogle = async (apptId: string) => {
    setSyncing(apptId);
    try {
      const res = await apiFetch(`/api/sales/appointments/${apptId}/sync`, { method: "POST" }).then((r) => r.json());
      if (res.synced) {
        await loadAppointments();
        if (selectedAppt?.id === apptId) {
          setSelectedAppt((prev) => prev ? { ...prev, googleEventId: res.googleEventId, googleSyncedAt: new Date().toISOString() } : null);
        }
      } else if (res.error) {
        alert(res.error);
      }
    } catch {
      alert("同步失败，请稍后重试");
    } finally {
      setSyncing(null);
    }
  };

  const handleMarkComplete = async (id: string) => {
    await apiFetch(`/api/sales/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
    setSelectedAppt(null);
    loadAppointments();
  };

  const goPrev = () => {
    if (viewMode === "week") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    } else if (viewMode === "day") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    } else {
      setCurrentDate(new Date(year, month - 1, 1));
    }
  };
  const goNext = () => {
    if (viewMode === "week") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    } else if (viewMode === "day") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    } else {
      setCurrentDate(new Date(year, month + 1, 1));
    }
  };
  const goToday = () => setCurrentDate(new Date());

  // 顶部标题：根据视图显示不同粒度
  const titleText = (() => {
    if (viewMode === "week") {
      const ws = startOfWeek(currentDate);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      const y = ws.getFullYear();
      const m = ws.getMonth() + 1;
      if (sameMonth) return `${y}年${m}月 ${ws.getDate()} - ${we.getDate()} 日`;
      return `${y}年${m}月${ws.getDate()}日 - ${we.getMonth() + 1}月${we.getDate()}日`;
    }
    if (viewMode === "day") {
      return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
    }
    return `${year}年${month + 1}月`;
  })();

  const today = new Date();
  const todayAppts = appointments.filter((a) => isSameDay(new Date(a.startAt), today));
  const todayGEvents = googleEvents.filter((e) => isSameDay(new Date(e.startTime), today));
  const upcomingAppts = appointments
    .filter((a) => new Date(a.startAt) >= today && a.status !== "cancelled")
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 10);

  return (
    <PullToRefresh onRefresh={loadAppointments} enabled={isMobile} className="space-y-6">
      <PageHeader
        title="预约日历"
        description="量房 · 安装 · 回访预约管理"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="hidden md:inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            新建预约
          </button>
        }
      />

      {/* Google Calendar token expired — 强提示，优先显示 */}
      {gcalTokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50/70 p-3 text-sm">
          <AlertTriangle size={18} className="text-red-600 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-red-800">Google 日历连接已失效</p>
            <p className="text-xs text-red-700/80 mt-0.5">
              授权令牌过期或被撤销，无法拉取事件。请到设置页重新连接。
            </p>
          </div>
          <a
            href="/settings"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm border border-red-200 hover:bg-red-50 transition-colors"
          >
            <ExternalLink size={12} />
            去重新连接
          </a>
        </div>
      )}

      {/* Google Calendar connection status */}
      <div className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-sm",
        gcalConnected
          ? "border-emerald-200 bg-emerald-50/50"
          : "border-amber-200 bg-amber-50/50",
      )}>
        <CalendarDays size={18} className={gcalConnected ? "text-emerald-600" : "text-amber-600"} />
        {gcalConnected ? (
          <span className="text-emerald-700">
            已连接 Google Calendar{gcalEmail ? ` (${gcalEmail})` : ""} — 预约将自动同步
          </span>
        ) : (
          <>
            <span className="text-amber-700">尚未连接 Google Calendar — 连接后预约自动同步到你的日历</span>
            <a
              href="/api/auth/google"
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm border border-amber-200 hover:bg-amber-50 transition-colors"
            >
              <ExternalLink size={12} />
              连接 Google Calendar
            </a>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        {[
          { label: "今日日程", value: todayAppts.length + todayGEvents.length, color: "text-blue-600" },
          { label: "本月预约", value: appointments.length, color: "text-emerald-600" },
          { label: "Google 事件", value: googleEvents.length, color: "text-indigo-600" },
          { label: "待量房", value: appointments.filter((a) => a.type === "measure" && a.status === "scheduled").length, color: "text-orange-600" },
          { label: "待安装", value: appointments.filter((a) => a.type === "install" && a.status === "scheduled").length, color: "text-purple-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white/60 p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* View controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-base md:text-lg font-semibold min-w-[180px] text-center">
            {titleText}
          </h2>
          <button onClick={goNext} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <ChevronRight size={18} />
          </button>
          <button
            onClick={goToday}
            className="ml-2 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
          >
            今天
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-white/60 p-0.5">
          {(["month", "week", "day", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                viewMode === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "month" ? "月" : v === "week" ? "周" : v === "day" ? "日" : "列表"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_300px] md:gap-6">
        {/* Calendar grid */}
        <div className="rounded-xl border border-border bg-white/60 overflow-hidden">
          {viewMode === "month" ? (
            <CalendarMonthView
              year={year}
              month={month}
              appointments={appointments}
              googleEvents={googleEvents}
              onSelectAppt={setSelectedAppt}
              onSelectGoogleEvent={setSelectedGoogleEvent}
            />
          ) : viewMode === "list" ? (
            <CalendarListView
              appointments={appointments}
              googleEvents={googleEvents}
              loading={loading}
              onSelectAppt={setSelectedAppt}
              onSelectGoogleEvent={setSelectedGoogleEvent}
            />
          ) : viewMode === "week" ? (
            <CalendarTimeGrid
              startDate={startOfWeek(currentDate)}
              days={7}
              appointments={appointments}
              googleEvents={googleEvents}
              onSelectAppt={setSelectedAppt}
              onSelectGoogleEvent={setSelectedGoogleEvent}
            />
          ) : (
            <CalendarTimeGrid
              startDate={(() => {
                const d = new Date(currentDate);
                d.setHours(0, 0, 0, 0);
                return d;
              })()}
              days={1}
              appointments={appointments}
              googleEvents={googleEvents}
              onSelectAppt={setSelectedAppt}
              onSelectGoogleEvent={setSelectedGoogleEvent}
            />
          )}
        </div>

        {/* Side panel — hidden on mobile to keep layout clean */}
        <div className="hidden md:block">
          <CalendarSidebar
            todayAppts={todayAppts}
            todayGEvents={todayGEvents}
            upcomingAppts={upcomingAppts}
            gcalConnected={gcalConnected}
            gcalList={gcalList}
            googleEventsCount={googleEvents.length}
            savingCals={savingCals}
            onToggleCalendar={toggleCalendar}
            onBulkSelectCalendars={saveCalendarSelection}
            onSelectAppt={setSelectedAppt}
          />
        </div>
      </div>

      {/* Mobile FAB — new appointment */}
      <button
        type="button"
        onClick={() => setShowCreate(true)}
        className="fab md:hidden"
        aria-label="新建预约"
      >
        <Plus size={24} strokeWidth={2.2} />
      </button>

      {/* Detail dialog */}
      <AppointmentDetailDialog
        appointment={selectedAppt}
        onClose={() => setSelectedAppt(null)}
        onMarkComplete={handleMarkComplete}
        onChanged={loadAppointments}
        gcalConnected={gcalConnected}
        syncing={syncing}
        onSyncToGoogle={handleSyncToGoogle}
      />

      {/* Google event dialog (view/edit/delete) */}
      <GoogleEventDialog
        event={selectedGoogleEvent}
        onClose={() => setSelectedGoogleEvent(null)}
        onChanged={loadAppointments}
      />

      {/* Create dialog */}
      <CreateAppointmentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadAppointments(); }}
      />
    </PullToRefresh>
  );
}
