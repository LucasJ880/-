"use client";

/**
 * Tender 项目详情（T1A 5-Tab UX Consolidation）。
 * 一级业务入口固定五个：工作台 / 招标要求 / 标书与报价 / 情报 / 提交；
 * 文件与 AI 对话为贯穿式抽屉；旧 4-tab 值经 lib/tender/detail-tabs.ts 别名解析（深链修复）。
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ClipboardCheck,
  DollarSign,
  FolderOpen,
  LayoutDashboard,
  Loader2,
  Radar,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api-fetch";
import { getProjectStage } from "@/lib/tender/stage";
import {
  TENDER_DETAIL_TAB_KEYS,
  TENDER_DETAIL_TAB_LABELS,
  resolveTenderDetailTab,
  type TenderDetailTab,
} from "@/lib/tender/detail-tabs";
import type { FormattedActivity } from "@/lib/activity/formatter";
import type { ProjectProgress } from "@/lib/progress/types";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import {
  WorkspacePageContext,
  useWorkspaceShell,
} from "@/components/workspace-shell-context";
import {
  ProjectContextPanel,
  deriveProjectCommandState,
  filterProjectContextActivities,
  type ProjectContextPendingAction,
  type ProjectContextTarget,
} from "@/components/project-detail/project-context-panel";
import {
  buildTenderProps,
  type MemberRow,
  type ProjectDetail,
  type ProjectHandoffInfo,
} from "@/components/project-detail/project-detail-types";
import { ProjectDetailHeader } from "@/components/project-detail/project-detail-header";
import { ProjectImportBanner } from "@/components/project-create/project-import-banner";
import { AutoAiPanelsRunner } from "@/components/project-create/auto-ai-panels-runner";
import { WorkbenchTab } from "@/components/project-detail/tabs/workbench-tab";
import { RequirementsTab } from "@/components/project-detail/tabs/requirements-tab";
import { BidTab } from "@/components/project-detail/tabs/bid-tab";
import { IntelTab } from "@/components/project-detail/tabs/intel-tab";
import { SubmissionTab } from "@/components/project-detail/tabs/submission-tab";
import { InternalAgentToolsSection } from "@/components/project-detail/internal-agent-tools";
import {
  ProjectChatDrawer,
  ProjectFilesDrawer,
} from "@/components/project-detail/project-utility-drawers";

const TAB_ICONS: Record<TenderDetailTab, LucideIcon> = {
  workbench: LayoutDashboard,
  requirements: ClipboardCheck,
  bid: DollarSign,
  intel: Radar,
  submission: Send,
};

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={<div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
      <ProjectDetailContent />
    </Suspense>
  );
}

function ProjectDetailContent() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const highlightActivityId = searchParams.get("activity") ?? undefined;
  const { isPlatformAdmin, user: currentUser } = useCurrentUser();
  const { setPanelOpen } = useWorkspaceShell();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activities, setActivities] = useState<FormattedActivity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState("");
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [handoffInfo, setHandoffInfo] = useState<ProjectHandoffInfo | null>(null);
  const [orgRulesRefreshKey, setOrgRulesRefreshKey] = useState(0);
  const [pendingActions, setPendingActions] = useState<ProjectContextPendingAction[]>([]);

  // ── 5-Tab 状态：URL ?tab= 优先（含旧 4-tab 别名），其次 sessionStorage，默认工作台 ──
  const [initialResolved] = useState(() => {
    const fromUrl = resolveTenderDetailTab(searchParams.get("tab"));
    if (fromUrl) return fromUrl;
    if (typeof window !== "undefined") {
      const saved = resolveTenderDetailTab(sessionStorage.getItem(`qy_proj_tab_${id}`));
      // 存储值只恢复 tab 位置，不自动弹出抽屉
      if (saved) return { tab: saved.tab };
    }
    return { tab: "workbench" as TenderDetailTab };
  });
  const [activeTab, setActiveTab] = useState<TenderDetailTab>(initialResolved.tab);
  const [filesOpen, setFilesOpen] = useState(Boolean(initialResolved.openFiles));
  const [chatOpen, setChatOpen] = useState(Boolean(initialResolved.openChat));
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
    if (typeof window !== "undefined") sessionStorage.setItem(`qy_proj_tab_${id}`, activeTab);
  }, [activeTab, id]);

  // 深链 / 前进后退 / 站内 ?tab= Link 同步（T0 审计 B4：此前 ?tab= 从不被读取）
  useEffect(() => {
    const resolved = resolveTenderDetailTab(searchParams.get("tab"));
    if (!resolved) return;
    if (resolved.tab !== activeTabRef.current) {
      setActiveTab(resolved.tab);
      if (!resolved.openFiles) setFilesOpen(false);
      if (!resolved.openChat) setChatOpen(false);
    }
    if (resolved.openFiles) setFilesOpen(true);
    if (resolved.openChat) setChatOpen(true);
  }, [searchParams]);

  const selectTab = useCallback(
    (tab: TenderDetailTab) => {
      setActiveTab(tab);
      setFilesOpen(false);
      setChatOpen(false);
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tab);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const openProjectArea = useCallback(
    (target: ProjectContextTarget) => {
      if (target === "files") {
        setFilesOpen(true);
        return;
      }
      if (target === "chat") {
        setChatOpen(true);
        return;
      }
      selectTab(target);
      setPanelOpen(false);
      window.setTimeout(() => {
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
      }, 0);
    },
    [selectTab, setPanelOpen],
  );

  /** 旧组件（AI 一键投标方案等）仍回跳 overview/files/quotes 旧值 */
  const handleLegacyTabSwitch = useCallback(
    (legacy: string) => {
      const resolved = resolveTenderDetailTab(legacy);
      if (!resolved) return;
      selectTab(resolved.tab);
      if (resolved.openFiles) setFilesOpen(true);
      if (resolved.openChat) setChatOpen(true);
    },
    [selectTab],
  );

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiJson<{
        error?: string;
        project?: ProjectDetail;
        canManage?: boolean;
      }>(`/api/projects/${id}`),
      apiJson<{ members?: MemberRow[] }>(`/api/projects/${id}/members`),
      apiJson<{ progress?: ProjectProgress }>(
        `/api/projects/${id}/overview`
      ).catch(() => null),
      apiJson<{
        handoff?: ProjectHandoffInfo | null;
      }>(`/api/projects/${id}/handoff`).catch(() => ({ handoff: null })),
    ])
      .then(([p, m, ov, ho]) => {
        if (p.error) {
          setError(p.error);
          setProject(null);
        } else {
          setProject(p.project ?? null);
          setCanManage(!!p.canManage);
          setError("");
        }
        setMembers(m.members ?? []);
        if (ov?.progress) setProgress(ov.progress);
        setHandoffInfo(ho?.handoff ?? null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const loadActivity = useCallback(
    (page = 1, targetType = "") => {
      if (!id) return;
      setActivityLoading(true);
      const qs = new URLSearchParams({ page: String(page), pageSize: "15", includeSystemEvents: "true" });
      if (targetType) qs.set("targetType", targetType);
      apiJson<{ data?: FormattedActivity[]; total?: number }>(`/api/projects/${id}/activity?${qs}`)
        .then((res) => {
          if (page === 1) {
            setActivities(res.data ?? []);
          } else {
            setActivities((prev) => [...prev, ...(res.data ?? [])]);
          }
          setActivityTotal(res.total ?? 0);
          setActivityPage(page);
        })
        .finally(() => setActivityLoading(false));
    },
    [id]
  );

  const loadPendingActions = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiJson<{
        actions?: Array<ProjectContextPendingAction & { projectId?: string | null }>;
      }>("/api/ai/pending-actions?status=pending");
      const now = Date.now();
      setPendingActions(
        (data.actions ?? []).filter(
          (action) =>
            action.projectId === id &&
            new Date(action.expiresAt).getTime() > now,
        ),
      );
    } catch {
      // 待确认摘要是辅助信息；加载失败不能阻断项目主流程。
      setPendingActions([]);
    }
  }, [id]);

  useEffect(() => {
    load();
    loadActivity(1, "");
    void loadPendingActions();
  }, [load, loadActivity, loadPendingActions]);

  useEffect(() => {
    const refresh = () => void loadPendingActions();
    window.addEventListener("pending-actions-changed", refresh);
    return () => window.removeEventListener("pending-actions-changed", refresh);
  }, [loadPendingActions]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === id) {
        load();
        loadActivity(1, activityFilter);
      }
    };
    window.addEventListener("qingyan:project-updated", handler);
    return () => window.removeEventListener("qingyan:project-updated", handler);
  }, [id, load, loadActivity, activityFilter]);

  const businessActivities = useMemo(
    () => filterProjectContextActivities(activities, isPlatformAdmin),
    [activities, isPlatformAdmin],
  );

  const tenderStage = useMemo(
    () => project ? getProjectStage(buildTenderProps(project)) : "initiation",
    [project],
  );

  const command = useMemo(
    () =>
      deriveProjectCommandState({
        status: project?.status ?? "active",
        stage: tenderStage,
        orgBound: Boolean(project?.orgId),
        documentCount: project?.documents?.length ?? 0,
        closeDate: project?.closeDate ?? project?.dueDate ?? null,
        riskLevel: project?.intelligence?.riskLevel ?? progress?.riskLevel ?? null,
        riskLabel: progress?.riskLabel ?? null,
        isOverdue: progress?.isOverdue ?? false,
        completedTasks: progress?.completedTasks ?? 0,
        totalTasks: progress?.totalTasks ?? project?._count.tasks ?? 0,
        pendingCount: pendingActions.length,
        hasIntelligence: Boolean(project?.intelligence || project?.intelligenceRoom),
      }),
    [project, progress, pendingActions.length, tenderStage],
  );

  const workspaceContext = useMemo(
    () =>
      project
        ? {
            eyebrow: "项目",
            title: project.name,
            summary: `${command.stageLabel}${pendingActions.length > 0 ? ` · ${pendingActions.length} 项待确认` : ""}`,
            panelTitle: "青砚 · 项目上下文",
            panel: (
              <ProjectContextPanel
                command={command}
                completedTasks={progress?.completedTasks ?? 0}
                totalTasks={progress?.totalTasks ?? project._count.tasks}
                pendingActions={pendingActions}
                activities={businessActivities}
                onNavigate={openProjectArea}
              />
            ),
          }
        : null,
    [
      project,
      command,
      pendingActions,
      progress?.completedTasks,
      progress?.totalTasks,
      businessActivities,
      openProjectArea,
    ],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> 返回项目列表
        </button>
        <div className="rounded-xl border border-border bg-danger-bg px-4 py-3 text-sm text-danger">
          {error || "项目不存在或无权访问"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 sm:px-0">
      {workspaceContext ? <WorkspacePageContext context={workspaceContext} /> : null}

      {/* 顶部工具行：返回 + 贯穿抽屉入口 */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> 项目列表
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilesOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
            data-testid="open-files-drawer"
          >
            <FolderOpen size={13} />
            资料
            {(project.documents ?? []).length > 0 ? (
              <span className="rounded-full bg-accent/10 px-1.5 text-[10px] font-semibold text-accent">
                {(project.documents ?? []).length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
            data-testid="open-chat-drawer"
          >
            <Sparkles size={13} />
            问青砚
          </button>
        </div>
      </div>

      <ProjectDetailHeader project={project} onOpenDocuments={() => setFilesOpen(true)} />

      <ProjectImportBanner projectId={id} onFinished={load} />
      <AutoAiPanelsRunner projectId={id} />

      {/* ═══ 5-Tab 一级导航（移动端为等宽紧凑分段，不横向溢出） ═══ */}
      <div className="rounded-lg border border-border bg-card-bg p-1" data-testid="tender-detail-tabs">
        <div className="grid grid-cols-5 gap-1">
          {TENDER_DETAIL_TAB_KEYS.map((key) => {
            const Icon = TAB_ICONS[key];
            const { label, shortLabel } = TENDER_DETAIL_TAB_LABELS[key];
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                data-tab={key}
                aria-current={isActive ? "page" : undefined}
                onClick={() => selectTab(key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-2 text-sm font-medium transition-all sm:px-3",
                  isActive
                    ? "bg-accent text-[color:var(--on-accent)] shadow-sm"
                    : "text-muted hover:bg-background hover:text-foreground"
                )}
              >
                <Icon size={14} className="hidden shrink-0 sm:block" />
                <span className="hidden sm:inline">{label}</span>
                <span className="text-[13px] sm:hidden">{shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "workbench" && (
        <WorkbenchTab
          projectId={id}
          project={project}
          command={command}
          progress={progress}
          pendingActions={pendingActions}
          businessActivities={businessActivities}
          activityCount={activities.length}
          activityTotal={activityTotal}
          activityPage={activityPage}
          activityLoading={activityLoading}
          activityFilter={activityFilter}
          onLoadActivity={loadActivity}
          onActivityFilterChange={setActivityFilter}
          highlightActivityId={highlightActivityId}
          members={members}
          canManage={canManage}
          currentUserId={currentUser?.id ?? null}
          onNavigate={openProjectArea}
          onReload={load}
        />
      )}

      {activeTab === "requirements" && (
        <RequirementsTab
          projectId={id}
          canManage={canManage}
          projectStatus={project.status}
        />
      )}

      {activeTab === "bid" && (
        <BidTab projectId={id} orgId={project.orgId} canManage={canManage} />
      )}

      {activeTab === "intel" && (
        <IntelTab
          projectId={id}
          project={project}
          orgRulesRefreshKey={orgRulesRefreshKey}
          onProjectUpdate={load}
          onNavigate={openProjectArea}
        />
      )}

      {activeTab === "submission" && (
        <SubmissionTab
          projectId={id}
          project={project}
          canManage={canManage}
          handoffInfo={handoffInfo}
          onReload={load}
          onReviewConfirmed={() => setOrgRulesRefreshKey((k) => k + 1)}
        />
      )}

      {/* 运行时内幕（AgentTask 面板 / 旧一键投标方案）：仅平台管理员可见 */}
      {isPlatformAdmin ? (
        <InternalAgentToolsSection projectId={id} onLegacyTabSwitch={handleLegacyTabSwitch} />
      ) : null}

      {/* 贯穿式抽屉 */}
      <ProjectFilesDrawer
        projectId={id}
        closeDate={project.closeDate ?? null}
        open={filesOpen}
        onClose={() => setFilesOpen(false)}
        onProjectUpdate={load}
      />
      <ProjectChatDrawer
        projectId={id}
        projectName={project.name}
        orgId={project.orgId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onProjectUpdate={load}
      />
    </div>
  );
}
