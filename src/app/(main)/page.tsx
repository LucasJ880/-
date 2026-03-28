"use client";

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { DashboardAiSuggestions } from "@/components/dashboard/dashboard-ai-suggestions";
import { DashboardCalendarSection } from "@/components/dashboard/dashboard-calendar-section";
import { DashboardAbandonedSection } from "@/components/dashboard/dashboard-abandoned-section";
import { DashboardLinksRecentSection } from "@/components/dashboard/dashboard-links-recent-section";
import { DashboardProgressOverview } from "@/components/dashboard/dashboard-progress-overview";
import { DashboardStatsSection } from "@/components/dashboard/dashboard-stats-section";
import { DashboardTasksSection } from "@/components/dashboard/dashboard-tasks-section";
import { DashboardTodayFocus } from "@/components/dashboard/dashboard-today-focus";
import { DashboardWelcomeSection } from "@/components/dashboard/dashboard-welcome-section";
import { ProjectQuickViewDrawer } from "@/components/project/project-quick-view-drawer";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import type { ReminderItemData } from "@/components/dashboard/types";

export default function Dashboard() {
  const router = useRouter();
  const {
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
  } = useDashboardData();

  const [drawerProjectId, setDrawerProjectId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openProjectDrawer = useCallback((projectId: string) => {
    setDrawerProjectId(projectId);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleReminderClick = useCallback(
    (item: ReminderItemData) => {
      if (item.projectId) {
        openProjectDrawer(item.projectId);
      } else if (item.project?.id) {
        openProjectDrawer(item.project.id);
      } else if (item.taskId) {
        router.push(`/tasks/${item.taskId}`);
      }
    },
    [openProjectDrawer, router]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!stats) return null;

  const isNewUser =
    stats.totalTasks === 0 &&
    stats.totalProjects <= 1 &&
    stats.projectBreakdown.length <= 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {isNewUser && (
        <DashboardWelcomeSection stats={stats} userName={userName} />
      )}
      <DashboardStatsSection
        stats={stats}
        reminderSummary={reminderSummary}
        onReminderClick={handleReminderClick}
        onProjectClick={openProjectDrawer}
      />
      <DashboardAiSuggestions onProjectClick={openProjectDrawer} />
      <DashboardTodayFocus
        highPriorityTasks={stats.highPriorityTasks}
        upcomingTasks={stats.upcomingTasks}
        scheduleEvents={scheduleEvents}
        reminderSummary={reminderSummary}
        onProjectClick={openProjectDrawer}
      />
      <DashboardCalendarSection
        events={events}
        scheduleEvents={scheduleEvents}
        scheduleDate={scheduleDate}
        onDateChange={goToDate}
        showEventForm={showEventForm}
        editingEvent={editingEvent}
        onClose={() => {
          setShowEventForm(false);
          setEditingEvent(null);
        }}
        onSaved={() => {
          loadEvents();
          loadScheduleEvents();
        }}
        onOpenAdd={() => {
          setEditingEvent(null);
          setShowEventForm(true);
        }}
        onOpenEdit={(ev) => {
          setEditingEvent(ev);
          setShowEventForm(true);
        }}
        onDelete={handleDeleteEvent}
        onOpenProject={openProjectDrawer}
      />
      <DashboardProgressOverview
        projectBreakdown={stats.projectBreakdown}
        projectProgress={stats.projectProgress ?? {}}
        onProjectClick={openProjectDrawer}
      />
      <DashboardTasksSection
        highPriorityTasks={stats.highPriorityTasks}
        upcomingTasks={stats.upcomingTasks}
        onProjectClick={openProjectDrawer}
      />
      <DashboardAbandonedSection onProjectClick={openProjectDrawer} />
      <DashboardLinksRecentSection
        recentTasks={stats.recentTasks}
        onProjectClick={openProjectDrawer}
      />

      <ProjectQuickViewDrawer
        projectId={drawerProjectId}
        open={drawerOpen}
        onClose={closeDrawer}
      />
    </div>
  );
}
