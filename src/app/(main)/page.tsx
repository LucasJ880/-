"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Loader2, MessagesSquare, Radar } from "lucide-react";
import Link from "next/link";
import { DashboardDailyBriefing } from "@/components/dashboard/dashboard-daily-briefing";
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
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { readStoredOrgId } from "@/lib/org-selection";
import { isAdmin as checkIsAdmin } from "@/lib/permissions-client";
import type { ReminderItemData } from "@/components/dashboard/types";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export default function Dashboard() {
  const { user } = useCurrentUser();
  const { organizations } = useOrganizations();
  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );
  const activeOrg =
    organizations.find((o) => o.id === storedOrgId) ?? organizations[0];
  const orgEyebrow = activeOrg?.name
    ? `${activeOrg.name} · 经营总览`
    : "经营总览";
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
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="border-b border-border pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-medium text-muted">{orgEyebrow}</p>
            <h1 className="mt-1 text-2xl font-semibold">经营总览</h1>
            <p className="mt-1 text-sm text-muted">
              {userName ? `${userName}，` : ""}以下是当前业务节奏和需要推进的重点事项。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/operations/intelligence"
              className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-white/70 px-3 text-sm font-medium text-foreground hover:bg-white"
            >
              <Radar size={15} />
              市场情报
            </Link>
            <Link
              href="/assistant"
              className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
            >
              <MessagesSquare size={15} />
              协同空间
            </Link>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 border-y border-border md:grid-cols-4">
          {[
            { label: "活跃项目", value: stats.projectBreakdown.length, note: `共 ${stats.totalProjects} 个项目` },
            { label: "在途事项", value: stats.todoCount + stats.inProgressCount, note: `${stats.inProgressCount} 项推进中` },
            { label: "本周闭环", value: stats.week.completed, note: `本周新增 ${stats.week.created}` },
            { label: "待决策", value: reminderSummary?.unreadCount ?? 0, note: stats.week.overdue > 0 ? `${stats.week.overdue} 项已逾期` : "暂无逾期事项" },
          ].map((item, index) => (
            <div
              key={item.label}
              className={`px-4 py-4 ${index % 2 === 1 ? "border-l border-border" : ""} ${index >= 2 ? "border-t border-border" : ""} md:border-l md:border-t-0 md:first:border-l-0`}
            >
              <p className="text-xs font-medium text-muted">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
              <p className="mt-1 text-[11px] text-text-quaternary">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

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
              进入商机中心
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
          <h3 className="text-sm font-semibold text-foreground mb-3">海外增长快捷操作</h3>
          <div className="flex flex-wrap gap-3">
            <a href="/trade" className="rounded-lg bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition-colors">
              进入海外业务
            </a>
            <a href="/trade/knowledge" className="rounded-lg bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition-colors">
              查看知识库
            </a>
          </div>
        </div>
      )}

      {/* ─── 经营简报（海外增长与销售域汇总） ─── */}
      {(showTradeModules || showSalesModules) && <DashboardDailyBriefing />}

      {/* ─── 策略建议（项目/销售域） ─── */}
      {showProjectModules && (
        <DashboardAiSuggestions onProjectClick={openProjectDrawer} />
      )}

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
