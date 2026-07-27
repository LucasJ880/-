"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { WorkbenchMetricStrip } from "./metric-strip";
import { ActiveWorkStack } from "./active-work-stack";
import { ContextInspector } from "./context-inspector";
import { WorkbenchTimelineStrip } from "./project-timeline-strip";
import { deriveWorkQueue } from "./derive-work-queue";
import type { WorkQueueItem } from "./types";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import { usePendingApprovalsBadge } from "@/lib/hooks/use-pending-approvals-badge";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { readStoredOrgId } from "@/lib/org-selection";
import { ProjectQuickViewDrawer } from "@/components/project/project-quick-view-drawer";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export function WorkbenchShell() {
  const router = useRouter();
  const { organizations } = useOrganizations();
  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );
  const activeOrg =
    organizations.find((o) => o.id === storedOrgId) ?? organizations[0];
  const orgEyebrow = activeOrg?.name
    ? `${activeOrg.name} · 工作台`
    : "工作台";

  const {
    stats,
    loading,
    userName,
    scheduleEvents,
    reminderSummary,
  } = useDashboardData();
  const { count: pendingApprovalCount } = usePendingApprovalsBadge();

  const queue = useMemo(
    () =>
      deriveWorkQueue({
        stats,
        reminderSummary,
        scheduleEvents,
        pendingApprovalCount,
      }),
    [stats, reminderSummary, scheduleEvents, pendingApprovalCount],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // 队列变化时保持选中；若失效则选第一项
  useEffect(() => {
    if (queue.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !queue.some((i) => i.id === selectedId)) {
      setSelectedId(queue[0].id);
    }
  }, [queue, selectedId]);

  const selectedItem: WorkQueueItem | null = useMemo(
    () => queue.find((i) => i.id === selectedId) ?? null,
    [queue, selectedId],
  );

  const [drawerProjectId, setDrawerProjectId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [taskDrawerId, setTaskDrawerId] = useState<string | null>(null);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setInspectorOpen(true);
  }, []);

  const openDetail = useCallback(
    (item: WorkQueueItem) => {
      if (item.entityType === "summary" && item.summaryHref) {
        router.push(item.summaryHref);
        return;
      }
      if (item.entityType === "task" && item.entityId) {
        setTaskDrawerId(item.entityId);
        setTaskDrawerOpen(true);
        return;
      }
      if (item.entityType === "project" && item.entityId) {
        setDrawerProjectId(item.entityId);
        setDrawerOpen(true);
        return;
      }
      if (item.entityType === "reminder") {
        if (item.reminder?.taskId) {
          setTaskDrawerId(item.reminder.taskId);
          setTaskDrawerOpen(true);
        } else if (item.projectId) {
          setDrawerProjectId(item.projectId);
          setDrawerOpen(true);
        }
      }
    },
    [router],
  );

  // Enter 打开详情
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !selectedItem) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      openDetail(selectedItem);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDetail, selectedItem]);

  // <xl Inspector 打开时锁滚动
  useEffect(() => {
    if (!inspectorOpen) return;
    return lockAppScroll("workbench-inspector");
  }, [inspectorOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 中栏 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {loading || !stats ? (
            <div className="shrink-0 border-b border-border px-4 py-3 md:px-5">
              <div className="mb-3 h-12 w-48 animate-pulse rounded bg-border/60" />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-[var(--radius-md)] bg-border/50"
                  />
                ))}
              </div>
            </div>
          ) : (
            <WorkbenchMetricStrip
              stats={stats}
              reminderSummary={reminderSummary}
              userName={userName}
              orgEyebrow={orgEyebrow}
            />
          )}

          <ActiveWorkStack
            items={queue}
            selectedId={selectedId}
            onSelect={handleSelect}
            loading={loading}
          />

          {stats && (
            <WorkbenchTimelineStrip
              scheduleEvents={scheduleEvents}
              projectBreakdown={stats.projectBreakdown}
              projectProgress={stats.projectProgress ?? {}}
              onOpenProject={(id) => {
                setDrawerProjectId(id);
                setDrawerOpen(true);
              }}
            />
          )}
        </div>

        {/* xl+ 常驻 Inspector */}
        <div className="hidden w-[340px] shrink-0 border-l border-border xl:flex xl:flex-col">
          <ContextInspector
            item={selectedItem}
            embedded
            onOpenDetail={openDetail}
          />
        </div>
      </div>

      {/* < xl：平板右侧抽屉感 / 手机全宽 Bottom Sheet */}
      <div
        className={cn(
          "fixed inset-0 z-[var(--ui-z-drawer-overlay)] xl:hidden",
          inspectorOpen && selectedItem
            ? "pointer-events-auto"
            : "pointer-events-none",
        )}
        aria-hidden={!inspectorOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/45 transition-opacity duration-200 motion-reduce:transition-none",
            inspectorOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setInspectorOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="工作详情"
          className={cn(
            "absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[var(--radius-xl)] border border-border bg-card-bg shadow-float transition-transform duration-250 motion-reduce:transition-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[360px] md:rounded-none md:border-l md:border-t-0",
            inspectorOpen ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-y-0 md:translate-x-full",
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border md:hidden" />
          <ContextInspector
            item={selectedItem}
            onClose={() => setInspectorOpen(false)}
            onOpenDetail={(item) => {
              setInspectorOpen(false);
              openDetail(item);
            }}
          />
        </div>
      </div>

      {/* 移动/平板：底栏唤起 Inspector */}
      <div className="flex shrink-0 items-center justify-between border-t border-border bg-card-bg px-4 py-2 xl:hidden">
        <p className="min-w-0 truncate text-xs text-muted">
          {selectedItem ? selectedItem.title : "选择工作项查看详情"}
        </p>
        <button
          type="button"
          disabled={!selectedItem}
          onClick={() => setInspectorOpen(true)}
          className="shrink-0 rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] disabled:opacity-40"
        >
          查看详情
        </button>
      </div>

      <ProjectQuickViewDrawer
        projectId={drawerProjectId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <TaskDrawer
        taskId={taskDrawerId}
        open={taskDrawerOpen}
        onClose={() => {
          setTaskDrawerOpen(false);
          setTaskDrawerId(null);
        }}
      />
    </div>
  );
}
