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
} from "lucide-react";
import { CalendarMonthView, CalendarListView } from "./calendar-grid";
import { CalendarSidebar } from "./calendar-sidebar";
import { AppointmentDetailDialog, CreateAppointmentDialog } from "./appointment-dialog";

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

type ViewMode = "month" | "week" | "list";

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export default function SalesCalendarPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalEmail, setGcalEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([]);
  const [gcalList, setGcalList] = useState<GoogleCalendarInfo[]>([]);
  const [savingCals, setSavingCals] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    try {
      const [apptRes, gcalRes] = await Promise.all([
        apiJson<{ appointments?: Appointment[] }>(`/api/sales/appointments?start=${start}&end=${end}`),
        apiJson<GoogleEvent[]>(`/api/calendar/google?timeMin=${start}&timeMax=${end}`).catch(() => []),
      ]);
      setAppointments(apptRes.appointments ?? []);
      setGoogleEvents(Array.isArray(gcalRes) ? gcalRes : []);
    } catch {
      setAppointments([]);
      setGoogleEvents([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  useEffect(() => {
    apiJson<{ connected: boolean; email?: string }>("/api/auth/google/status").then((d) => {
      setGcalConnected(d.connected);
      setGcalEmail(d.email ?? null);
      if (d.connected) {
        apiJson<{ calendars?: GoogleCalendarInfo[] }>("/api/calendar/google/calendars").then((cal) => {
          setGcalList(cal.calendars ?? []);
        }).catch(() => {});
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

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const today = new Date();
  const todayAppts = appointments.filter((a) => isSameDay(new Date(a.startAt), today));
  const todayGEvents = googleEvents.filter((e) => isSameDay(new Date(e.startTime), today));
  const upcomingAppts = appointments
    .filter((a) => new Date(a.startAt) >= today && a.status !== "cancelled")
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="预约日历"
        description="量房 · 安装 · 回访预约管理"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            新建预约
          </button>
        }
      />

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
      <div className="grid grid-cols-5 gap-4">
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
          <button onClick={prevMonth} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-semibold min-w-[140px] text-center">
            {year}年{month + 1}月
          </h2>
          <button onClick={nextMonth} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
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
          {(["month", "week", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                viewMode === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "month" ? "月" : v === "week" ? "周" : "列表"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        {/* Calendar grid */}
        <div className="rounded-xl border border-border bg-white/60 overflow-hidden">
          {viewMode === "month" ? (
            <CalendarMonthView
              year={year}
              month={month}
              appointments={appointments}
              googleEvents={googleEvents}
              onSelectAppt={setSelectedAppt}
            />
          ) : viewMode === "list" ? (
            <CalendarListView
              appointments={upcomingAppts}
              loading={loading}
              onSelectAppt={setSelectedAppt}
            />
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
              周视图开发中
            </div>
          )}
        </div>

        {/* Side panel */}
        <CalendarSidebar
          todayAppts={todayAppts}
          todayGEvents={todayGEvents}
          upcomingAppts={upcomingAppts}
          gcalConnected={gcalConnected}
          gcalList={gcalList}
          googleEventsCount={googleEvents.length}
          savingCals={savingCals}
          onToggleCalendar={toggleCalendar}
          onSelectAppt={setSelectedAppt}
        />
      </div>

      {/* Detail dialog */}
      <AppointmentDetailDialog
        appointment={selectedAppt}
        onClose={() => setSelectedAppt(null)}
        onMarkComplete={handleMarkComplete}
        gcalConnected={gcalConnected}
        syncing={syncing}
        onSyncToGoogle={handleSyncToGoogle}
      />

      {/* Create dialog */}
      <CreateAppointmentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadAppointments(); }}
      />
    </div>
  );
}
