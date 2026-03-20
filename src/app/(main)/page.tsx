"use client";

import { Loader2 } from "lucide-react";
import { DashboardCalendarSection } from "@/components/dashboard/dashboard-calendar-section";
import { DashboardLinksRecentSection } from "@/components/dashboard/dashboard-links-recent-section";
import { DashboardProjectsSection } from "@/components/dashboard/dashboard-projects-section";
import { DashboardStatsSection } from "@/components/dashboard/dashboard-stats-section";
import { DashboardTasksSection } from "@/components/dashboard/dashboard-tasks-section";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";

export default function Dashboard() {
  const {
    stats,
    loading,
    events,
    showEventForm,
    setShowEventForm,
    editingEvent,
    setEditingEvent,
    reminderSummary,
    loadEvents,
    handleDeleteEvent,
  } = useDashboardData();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DashboardStatsSection
        stats={stats}
        reminderSummary={reminderSummary}
      />
      <DashboardCalendarSection
        events={events}
        showEventForm={showEventForm}
        editingEvent={editingEvent}
        onClose={() => {
          setShowEventForm(false);
          setEditingEvent(null);
        }}
        onSaved={loadEvents}
        onOpenAdd={() => {
          setEditingEvent(null);
          setShowEventForm(true);
        }}
        onOpenEdit={(ev) => {
          setEditingEvent(ev);
          setShowEventForm(true);
        }}
        onDelete={handleDeleteEvent}
      />
      <DashboardTasksSection
        highPriorityTasks={stats.highPriorityTasks}
        upcomingTasks={stats.upcomingTasks}
      />
      <DashboardProjectsSection projectBreakdown={stats.projectBreakdown} />
      <DashboardLinksRecentSection recentTasks={stats.recentTasks} />
    </div>
  );
}
