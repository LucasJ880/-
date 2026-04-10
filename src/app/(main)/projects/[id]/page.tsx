"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Users,
  Trash2,
  History,
  ChevronDown,
  Ban,
  BarChart3,
  FileQuestion,
  LayoutDashboard,
  FolderOpen,
  DollarSign,
  Sparkles,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { ProjectNotificationRuleCard } from "@/components/notification/project-notification-rule-card";
import { ProgressComparison } from "@/components/progress/progress-comparison";
import { StageIndicator } from "@/components/progress/stage-indicator";
import { BidToGoIntelligenceCard } from "@/components/bidtogo/intelligence-card";
import { ProjectProgressSection } from "@/components/tender/project-progress-section";
import { ProjectDiscussionSection } from "@/components/project-discussion/project-discussion-section";
import { AbandonProjectDialog } from "@/components/tender/abandon-project-dialog";
import { ProjectAiChat } from "@/components/project-ai-chat/project-ai-chat";
import { ProjectProgressSummary } from "@/components/project-progress/project-progress-summary";
import { BidChecklist } from "@/components/project-checklist/bid-checklist";
import { ProjectAiMemory } from "@/components/project-memory/project-ai-memory";
import { ProjectInquirySection } from "@/components/inquiry/project-inquiry-section";
import { ProjectQuoteSection } from "@/components/quote/project-quote-section";
import { ProjectAgentTasks } from "@/components/agent-tasks/project-agent-tasks";
import { AiBidPackageSection } from "@/components/agent-tasks/ai-bid-package";
import { ProjectFileManager } from "@/components/project-files/project-file-manager";
import { ProjectQuestionDialog } from "@/components/project-question/project-question-dialog";
import { ProjectOnboardingGuide } from "@/components/project-onboarding/project-onboarding-guide";
import { ProjectDetailHeader } from "@/components/project-detail/project-detail-header";
import { getProjectStage } from "@/lib/tender/stage";
import { ACTIVITY_TYPE_LABELS } from "@/lib/i18n/labels";
import type { FormattedActivity } from "@/lib/activity/formatter";
import type { ProjectProgress } from "@/lib/progress/types";

const PROJECT_ROLES = [
  "project_admin",
  "operator",
  "tester",
  "viewer",
] as const;

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  orgId: string | null;
  owner: { id: string; name: string; email: string };
  org: {
    id: string;
    name: string;
    code: string;
    status: string;
  } | null;
  _count: { tasks: number; members: number };
  // BidToGo / tender fields
  category?: string | null;
  sourceSystem?: string | null;
  sourcePlatform?: string | null;
  clientOrganization?: string | null;
  location?: string | null;
  estimatedValue?: number | null;
  currency?: string | null;
  solicitationNumber?: string | null;
  tenderStatus?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  publicDate?: string | null;
  questionCloseDate?: string | null;
  closeDate?: string | null;
  distributedAt?: string | null;
  dispatchedAt?: string | null;
  intakeStatus?: string | null;
  interpretedAt?: string | null;
  supplierInquiredAt?: string | null;
  supplierQuotedAt?: string | null;
  submittedAt?: string | null;
  awardDate?: string | null;
  abandonedAt?: string | null;
  abandonedStage?: string | null;
  abandonedReason?: string | null;
  sourceMetadataJson?: string | null;
  externalRef?: { system: string; externalId: string; url: string | null } | null;
  intelligence?: {
    recommendation: string;
    riskLevel: string;
    fitScore: number;
    summary: string | null;
    fullReportUrl: string | null;
    fullReportJson: string | null;
    reportMarkdown: string | null;
    reportStatus?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewNotes?: string | null;
    reviewScore?: number | null;
  } | null;
  documents?: Array<{ id: string; title: string; url: string; fileType: string }>;
}

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  status: string;
  orgRole: string | null;
  user: { id: string; email: string; name: string; avatar?: string | null; nickname?: string | null };
}

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
  const searchParams = useSearchParams();
  const id = params.id as string;
  const highlightActivityId = searchParams.get("activity") ?? undefined;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<string>("viewer");
  const [busy, setBusy] = useState<string | null>(null);

  const [activities, setActivities] = useState<FormattedActivity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState("");
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [showAbandonDialog, setShowAbandonDialog] = useState(false);
  const [mentionDraft, setMentionDraft] = useState<{ userId: string; name: string } | null>(null);
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);

  type ProjectTab = "overview" | "files" | "quotes" | "ai";
  const [activeTab, setActiveTab] = useState<ProjectTab>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(`qy_proj_tab_${id}`);
      if (saved && ["overview", "files", "quotes", "ai"].includes(saved)) return saved as ProjectTab;
    }
    return "overview";
  });
  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.setItem(`qy_proj_tab_${id}`, activeTab);
  }, [activeTab, id]);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${id}`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/members`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/overview`).then((r) => r.json()).catch(() => null),
    ])
      .then(([p, m, ov]) => {
        if (p.error) {
          setError(p.error);
          setProject(null);
        } else {
          setProject(p.project);
          setCanManage(!!p.canManage);
          setError("");
        }
        setMembers(m.members ?? []);
        if (ov?.progress) setProgress(ov.progress);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const loadActivity = useCallback(
    (page = 1, targetType = "") => {
      if (!id) return;
      setActivityLoading(true);
      const qs = new URLSearchParams({ page: String(page), pageSize: "15", includeSystemEvents: "true" });
      if (targetType) qs.set("targetType", targetType);
      apiFetch(`/api/projects/${id}/activity?${qs}`)
        .then((r) => r.json())
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

  useEffect(() => {
    load();
    loadActivity(1, "");
  }, [load, loadActivity]);

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

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const uid = addUserId.trim();
    if (!uid) return;
    setBusy("member");
    try {
      const res = await apiFetch(`/api/projects/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, role: addRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "添加失败");
      setAddUserId("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(null);
    }
  }

  async function patchMember(memberId: string, role: string) {
    setBusy(memberId);
    try {
      const res = await apiFetch(`/api/projects/${id}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "更新失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm("从项目移除此成员？")) return;
    setBusy(memberId);
    try {
      const res = await apiFetch(`/api/projects/${id}/members/${memberId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "移除失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "移除失败");
    } finally {
      setBusy(null);
    }
  }

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
        <div className="rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
          {error || "项目不存在或无权访问"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 sm:px-0">
      <button
        type="button"
        onClick={() => router.push("/projects")}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 项目列表
      </button>

      <ProjectDetailHeader project={project} canManage={canManage} />

      {/* Abandoned banner */}
      {project.status === "abandoned" && (
        <div className="flex items-center gap-3 rounded-xl border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] px-5 py-4">
          <Ban size={20} className="shrink-0 text-[#a63d3d]" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#a63d3d]">该项目已放弃</p>
            <p className="text-xs text-[#6e7d76] mt-0.5">
              放弃阶段：{
                { initiation: "立项", distribution: "项目分发", interpretation: "项目解读", supplier_inquiry: "供应商询价", supplier_quote: "供应商报价", submission: "项目提交" }[project.abandonedStage ?? ""] ?? project.abandonedStage
              }
              {project.abandonedReason && ` · 原因：${project.abandonedReason}`}
            </p>
          </div>
        </div>
      )}

      {/* Abandon button */}
      {project.status !== "abandoned" && canManage && (() => {
        const tenderProps = buildTenderProps(project);
        const stage = getProjectStage(tenderProps);
        const canAbandon = ["interpretation", "supplier_inquiry", "supplier_quote", "submission"].includes(stage);
        if (!canAbandon) return null;
        return (
          <div className="flex justify-end">
            <button type="button" onClick={() => setShowAbandonDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(166,61,61,0.2)] bg-white px-4 py-2 text-sm font-medium text-[#a63d3d] shadow-sm hover:bg-[rgba(166,61,61,0.04)] transition-colors">
              <Ban size={14} />放弃项目
            </button>
          </div>
        );
      })()}

      {/* ═══ Tab Navigation ═══ */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card-bg p-1 min-w-max sm:min-w-0">
          {([
            { key: "overview" as const, icon: LayoutDashboard, label: "概览" },
            { key: "files" as const, icon: FolderOpen, label: "文件" },
            { key: "quotes" as const, icon: DollarSign, label: "报价" },
            { key: "ai" as const, icon: Sparkles, label: "AI" },
          ]).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-all",
                  isActive ? "bg-accent text-white shadow-sm" : "text-muted hover:bg-background hover:text-foreground"
                )}>
                <Icon size={14} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ Tab: 概览 ═══ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 新项目引导 */}
          <ProjectOnboardingGuide
            hasDocuments={(project.documents ?? []).length > 0}
            hasIntelligence={!!project.intelligence}
            onGoToFiles={() => setActiveTab("files")}
            onGoToAi={() => setActiveTab("ai")}
          />

          {/* AI 情报分析 */}
          {(project.sourceSystem === "bidtogo" || project.intelligence) && (
            <BidToGoIntelligenceCard
              project={{
                projectId: id,
                sourceSystem: project.sourceSystem === "bidtogo" ? project.sourceSystem : "upload",
                sourcePlatform: project.sourceSystem === "bidtogo" ? (project.sourcePlatform ?? null) : null,
                clientOrganization: project.clientOrganization ?? null,
                location: project.location ?? null,
                estimatedValue: project.estimatedValue ?? null,
                currency: project.currency ?? null,
                solicitationNumber: project.solicitationNumber ?? null,
                tenderStatus: project.tenderStatus ?? null,
                dueDate: project.dueDate ?? null,
                externalRef: project.sourceSystem === "bidtogo" ? (project.externalRef ?? null) : null,
                intelligence: project.intelligence ?? null,
                documents: project.documents ?? [],
              }}
              onUpdate={load}
            />
          )}

          {/* 项目进度 */}
          {progress && (
            <div className="rounded-xl border border-border bg-card-bg p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BarChart3 size={16} className="text-accent/60" />
                  项目进度
                </h3>
                {progress.stages.length > 0 && <StageIndicator stages={progress.stages} />}
              </div>
              <div className="mt-4">
                <ProgressComparison taskProgress={progress.taskProgress} timeProgress={progress.timeProgress} completedTasks={progress.completedTasks} totalTasks={progress.totalTasks} daysRemaining={progress.daysRemaining} daysTotal={progress.daysTotal} isOverdue={progress.isOverdue} riskLabel={progress.riskLabel} />
              </div>
            </div>
          )}

          {/* 招投标进度 */}
          {(project.sourceSystem === "bidtogo" || project.tenderStatus || project.category === "tender_opportunity") && (
            <ProjectProgressSection project={buildTenderProps(project)} />
          )}

          {/* 项目讨论 */}
          <ProjectDiscussionSection
            projectId={id}
            canPost={canManage || members.some(m => m.status === "active")}
            projectStatus={project.status}
            mentionDraft={mentionDraft}
            onMentionConsumed={() => setMentionDraft(null)}
            members={members.filter(m => m.status === "active").map(m => ({ userId: m.user.id, name: m.user.name, avatar: m.user.avatar ?? null }))}
          />

          {/* 项目动态 */}
          <div className="rounded-xl border border-border bg-card-bg p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <History size={16} className="text-accent/60" />
                项目动态
                {activityTotal > 0 && <span className="text-xs font-normal text-muted">共 {activityTotal} 条</span>}
              </div>
              <select value={activityFilter} onChange={(e) => { setActivityFilter(e.target.value); loadActivity(1, e.target.value); }}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent">
                <option value="">全部类型</option>
                {Object.entries(ACTIVITY_TYPE_LABELS).map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            </div>
            <div className="mt-4">
              <ActivityTimeline activities={activities} loading={activityLoading && activityPage === 1} highlightId={highlightActivityId} />
            </div>
            {activities.length < activityTotal && (
              <div className="mt-4 flex justify-center">
                <button type="button" disabled={activityLoading} onClick={() => loadActivity(activityPage + 1, activityFilter)}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-[rgba(43,96,85,0.04)] hover:text-foreground disabled:opacity-50">
                  {activityLoading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                  加载更多
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Tab: 文件与情报 ═══ */}
      {activeTab === "files" && (
        <div className="space-y-6">
          <ProjectFileManager projectId={id} closeDate={project.closeDate} onProjectUpdate={load} />
          <ProjectProgressSummary projectId={id} />
          <BidChecklist projectId={id} />
          <ProjectAiMemory projectId={id} />
        </div>
      )}

      {/* ═══ Tab: 报价与询价 ═══ */}
      {activeTab === "quotes" && (
        <div className="space-y-6">
          <ProjectInquirySection projectId={id} orgId={project.orgId} canManage={canManage} />
          <ProjectQuoteSection projectId={id} />
          {canManage && project.status !== "abandoned" && (
            <div className="rounded-xl border border-border bg-card-bg p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileQuestion size={16} className="text-accent" />
                  <h3 className="text-sm font-semibold">项目问题</h3>
                  <span className="text-xs text-muted">向业主/GC/顾问发送澄清邮件</span>
                </div>
                <button type="button" onClick={() => setShowQuestionDialog(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">
                  <FileQuestion size={12} />向业主提问
                </button>
              </div>
            </div>
          )}
          <ProjectQuestionDialog
            projectId={id}
            open={showQuestionDialog}
            onOpenChange={setShowQuestionDialog}
            onSent={() => setShowQuestionDialog(false)}
          />
        </div>
      )}

      {/* ═══ Tab: AI 工作台 ═══ */}
      {activeTab === "ai" && (
        <div className="space-y-6">
          <ProjectAiChat projectId={id} projectName={project.name} onProjectUpdate={load} />
          <AiBidPackageSection projectId={id} onTabSwitch={(tab) => setActiveTab(tab as ProjectTab)} />
          <ProjectAgentTasks projectId={id} />
        </div>
      )}

      {/* ═══ 固定底部：成员 + 通知 ═══ */}
      <div id="project-members" className="rounded-xl border border-border bg-card-bg p-5 scroll-mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users size={16} />项目成员
          </div>
          {canManage && (
            <button type="button" onClick={() => setActiveTab("overview")} className="text-xs text-muted hover:text-accent">
              <Settings size={12} className="inline mr-1" />管理
            </button>
          )}
        </div>
        {canManage && (
          <form onSubmit={addMember} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <input value={addUserId} onChange={(e) => setAddUserId(e.target.value)} placeholder="用户 ID（须已加入所属组织）"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
            <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="submit" disabled={busy === "member"} className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50">添加</button>
          </form>
        )}
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="pb-2 w-10" /><th className="pb-2">用户</th><th className="pb-2">邮箱</th>
              <th className="pb-2">项目角色</th><th className="pb-2">组织角色</th><th className="pb-2">状态</th>
              {canManage && <th className="pb-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="py-2">
                  <button type="button" title={`@${m.user.name}`}
                    onClick={() => { setMentionDraft({ userId: m.user.id, name: m.user.name }); setActiveTab("overview"); setTimeout(() => document.getElementById("project-discussion")?.scrollIntoView({ behavior: "smooth" }), 100); }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent transition-colors hover:bg-accent/20 overflow-hidden">
                    {m.user.avatar ? <img src={m.user.avatar} alt={m.user.name} className="h-full w-full object-cover" /> : m.user.name.slice(0, 1).toUpperCase()}
                  </button>
                </td>
                <td className="py-2">{m.user.name}</td>
                <td className="py-2 text-muted">{m.user.email}</td>
                <td className="py-2">
                  {canManage && m.status === "active" ? (
                    <select value={m.role} disabled={busy === m.id} onChange={(e) => patchMember(m.id, e.target.value)}
                      className="rounded border border-border bg-background px-2 py-1 text-xs">
                      {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : m.role}
                </td>
                <td className="py-2 text-muted">{m.orgRole ?? "—"}</td>
                <td className="py-2">{m.status}</td>
                {canManage && (
                  <td className="py-2">
                    {m.status === "active" && (
                      <button type="button" onClick={() => removeMember(m.id)} disabled={busy === m.id}
                        className="text-[#a63d3d] hover:text-[#a63d3d] disabled:opacity-50"><Trash2 size={14} /></button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ProjectNotificationRuleCard projectId={id} />

      {/* Abandon dialog */}
      {project && (
        <AbandonProjectDialog
          open={showAbandonDialog}
          onOpenChange={setShowAbandonDialog}
          projectId={project.id}
          projectName={project.name}
          currentStage={getProjectStage(buildTenderProps(project))}
          onSuccess={() => {
            setShowAbandonDialog(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function buildTenderProps(project: ProjectDetail) {
  return {
    createdAt: project.createdAt ?? null,
    tenderStatus: project.tenderStatus ?? null,
    publicDate: project.publicDate ?? null,
    questionCloseDate: project.questionCloseDate ?? null,
    closeDate: project.closeDate ?? null,
    dueDate: project.dueDate ?? null,
    distributedAt: project.distributedAt ?? null,
    dispatchedAt: project.dispatchedAt ?? null,
    interpretedAt: project.interpretedAt ?? null,
    supplierInquiredAt: project.supplierInquiredAt ?? null,
    supplierQuotedAt: project.supplierQuotedAt ?? null,
    submittedAt: project.submittedAt ?? null,
    awardDate: project.awardDate ?? null,
    intakeStatus: project.intakeStatus ?? null,
    sourceMetadataJson: project.sourceMetadataJson ?? null,
  };
}
