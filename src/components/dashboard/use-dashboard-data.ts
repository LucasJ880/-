"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { formatISODateToronto } from "@/lib/time";
import type {
  CalendarEventItem,
  ReminderSummaryData,
  ScheduleEvent,
  Stats,
} from "./types";

function fmtDateISO(d: Date) {
  return formatISODateToronto(d);
}

export function useDashboardData() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [scheduleDate, setScheduleDate] = useState<Date>(() => new Date());
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventItem | null>(
    null
  );
  const [reminderSummary, setReminderSummary] =
    useState<ReminderSummaryData | null>(null);
  const [userName, setUserName] = useState<string>("");
  const didInit = useRef(false);
  const scheduleDateRef = useRef(scheduleDate);
  scheduleDateRef.current = scheduleDate;

  const loadStats = useCallback(() => {
    apiFetch("/api/stats")
      .then((r) => {
        if (!r.ok) throw new Error(`stats ${r.status}`);
        return r.json();
      })
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadUser = useCallback(() => {
    apiFetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.name) setUserName(d.user.name);
      })
      .catch(() => {});
  }, []);

  const loadEvents = useCallback(() => {
    const internalP = apiFetch("/api/calendar")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const googleP = apiFetch("/api/calendar/google")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);

    Promise.all([internalP, googleP]).then(([internal, google]) => {
      const internalEvents: CalendarEventItem[] = (
        Array.isArray(internal) ? internal : []
      ).map((e: CalendarEventItem) => ({
        ...e,
        source: "qingyan" as const,
      }));
      const googleEvents: CalendarEventItem[] = (
        Array.isArray(google) ? google : []
      ).map(
        (e: {
          id: string;
          title: string;
          startTime: string;
          endTime: string;
          allDay: boolean;
          location: string | null;
        }) => ({
          ...e,
          description: null,
          source: "google" as const,
          task: null,
        })
      );
      const merged = [...internalEvents, ...googleEvents].sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
      });
      setEvents(merged);
    });
  }, []);

  const loadScheduleEvents = useCallback(
    (date?: Date) => {
      const d = date ?? scheduleDateRef.current;
      const dateParam = fmtDateISO(d);
      apiFetch(`/api/schedule?date=${dateParam}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          setScheduleEvents(Array.isArray(data) ? data : []);
        })
        .catch(() => setScheduleEvents([]));
    },
    []
  );

  const goToDate = useCallback(
    (d: Date) => {
      setScheduleDate(d);
      loadScheduleEvents(d);
    },
    [loadScheduleEvents]
  );

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      await apiFetch(`/api/calendar/${id}`, { method: "DELETE" });
      loadEvents();
      loadScheduleEvents();
    },
    [loadEvents, loadScheduleEvents]
  );

  const loadReminders = useCallback(() => {
    apiFetch("/api/reminders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setReminderSummary(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    loadStats();
    loadEvents();
    loadScheduleEvents();
    loadReminders();
    loadUser();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadStats();
        loadEvents();
        loadScheduleEvents();
        loadReminders();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    stats,
    loading,
    userName,
    events,
    scheduleEvents,
    scheduleDate,
    goToDate,
    showEventForm,
    setShowEventForm,
    editingEvent,
    setEditingEvent,
    reminderSummary,
    loadEvents,
    loadScheduleEvents,
    handleDeleteEvent,
  };
}
