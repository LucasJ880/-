"use client";

import { useState, useCallback } from "react";
import type { CalendarEventItem, ScheduleEvent } from "./types";
import { ScheduleEventDrawer } from "./schedule-event-drawer";
import { TodayTimelineView } from "./calendar/calendar-grid";
import { EventFormModal } from "./calendar/calendar-filters";

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
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
        onSaved={onSaved}
        editing={editingEvent}
      />
    </>
  );
}
