"use client";

import { useCallback, useState } from "react";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { DashboardAiSuggestions } from "@/components/dashboard/dashboard-ai-suggestions";
import { DashboardAutoInspections } from "@/components/dashboard/dashboard-auto-inspections";
import { DashboardCalendarSection } from "@/components/dashboard/dashboard-calendar-section";
import { DashboardAbandonedSection } from "@/components/dashboard/dashboard-abandoned-section";
import { DashboardLinksRecentSection } from "@/components/dashboard/dashboard-links-recent-section";
import { DashboardProgressOverview } from "@/components/dashboard/dashboard-progress-overview";
import { DashboardStatsSection } from "@/components/dashboard/dashboard-stats-section";
import { DashboardTasksSection } from "@/components/dashboard/dashboard-tasks-section";
import { DashboardTodayFocus } from "@/components/dashboard/dashboard-today-focus";
import { DashboardWelcomeSection } from "@/components/dashboard/dashboard-welcome-section";
import { ProjectQuickViewDrawer } from "@/components/project/project-quick-view-drawer";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { isAdmin as checkIsAdmin } from "@/lib/permissions-client";
import type { ReminderItemData } from "@/components/dashboard/types";

export default function Dashboard() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const userRole = user?.role || "user";
  const showProjectModules = checkIsAdmin(userRole) || userRole === "user";
  const showSalesModules = checkIsAdmin(userRole) || userRole === "sales";
  const showTradeModules = checkIsAdmin(userRole) || userRole === "trade";
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

  // Task drawer state
  const [taskDrawerId, setTaskDrawerId] = useState<string | null>(null);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const openProjectDrawer = useCallback((projectId: string) => {
    setDrawerProjectId(projectId);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const openTaskDrawer = useCallback((taskId: string) => {
    setTaskDrawerId(taskId);
    setTaskDrawerOpen(true);
  }, []);

  const handleReminderClick = useCallback(
    (item: ReminderItemData) => {
      if (item.taskId) {
        openTaskDrawer(item.taskId);
      } else if (item.projectId) {
        openProjectDrawer(item.projectId);
      } else if (item.project?.id) {
        openProjectDrawer(item.project.id);
      }
    },
    [openProjectDrawer, openTaskDrawer]
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
    <div className="mx-auto max-w-5xl space-y-6 px-4 sm:px-0">
      {isNewUser && (
        <DashboardWelcomeSection stats={stats} userName={userName} />
      )}

      {/* ─── 核心区块（所有角色都看到任务统计） ─── */}
      <DashboardStatsSection
        stats={stats}
        reminderSummary={reminderSummary}
        onReminderClick={handleReminderClick}
        onProjectClick={openProjectDrawer}
      />
      <DashboardTodayFocus
        highPriorityTasks={stats.highPriorityTasks}
        upcomingTasks={stats.upcomingTasks}
        scheduleEvents={scheduleEvents}
        reminderSummary={reminderSummary}
        onProjectClick={openProjectDrawer}
      />

      {/* 项目进度（仅 admin + user） */}
      {showProjectModules && (
        <DashboardProgressOverview
          projectBreakdown={stats.projectBreakdown}
          projectProgress={stats.projectProgress ?? {}}
          onProjectClick={openProjectDrawer}
        />
      )}

      {/* sales 角色的快捷入口 */}
      {showSalesModules && !checkIsAdmin(userRole) && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">销售快捷操作</h3>
          <div className="flex flex-wrap gap-3">
            <a href="/sales" className="rounded-lg bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors">
              进入销售看板
            </a>
            <a href="/sales/knowledge" className="rounded-lg bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors">
              查看知识库
            </a>
          </div>
        </div>
      )}

      {/* trade 角色的快捷入口 */}
      {showTradeModules && !checkIsAdmin(userRole) && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">外贸快捷操作</h3>
          <div className="flex flex-wrap gap-3">
            <a href="/trade" className="rounded-lg bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition-colors">
              进入外贸看板
            </a>
            <a href="/trade/knowledge" className="rounded-lg bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition-colors">
              查看知识库
            </a>
          </div>
        </div>
      )}

      <DashboardAiSuggestions onProjectClick={openProjectDrawer} />

      {/* ─── 折叠区（仅 admin + user 角色显示项目相关） ─── */}
      {showProjectModules && (
        <div>
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card-bg px-4 py-2.5 text-xs font-medium text-muted hover:text-foreground hover:bg-card-bg/80 transition-colors"
          >
            {showMore ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showMore ? "收起更多" : "展开更多"}（日历、任务详情、巡检等）
          </button>
          {showMore && (
            <div className="mt-4 space-y-6">
              <DashboardAutoInspections onProjectClick={openProjectDrawer} />
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
              <DashboardTasksSection
                highPriorityTasks={stats.highPriorityTasks}
                upcomingTasks={stats.upcomingTasks}
                projectBreakdown={stats.projectBreakdown}
                onProjectClick={openProjectDrawer}
                onTaskClick={openTaskDrawer}
              />
              <DashboardAbandonedSection onProjectClick={openProjectDrawer} />
              <DashboardLinksRecentSection
                recentTasks={stats.recentTasks}
                onProjectClick={openProjectDrawer}
              />
            </div>
          )}
        </div>
      )}

      <ProjectQuickViewDrawer
        projectId={drawerProjectId}
        open={drawerOpen}
        onClose={closeDrawer}
      />

      <TaskDrawer
        taskId={taskDrawerId}
        open={taskDrawerOpen}
        onClose={() => { setTaskDrawerOpen(false); setTaskDrawerId(null); }}
      />
    </div>
  );
}
