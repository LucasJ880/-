"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  FolderKanban,
  Users,
  Trash2,
  FileText,
  BookOpen,
  MessageSquare,
  Bot,
  Wrench,
  Star,
  BarChart3,
  Tag,
  History,
  ChevronDown,
  Ban,
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
import { getProjectStage } from "@/lib/tender/stage";
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
  } | null;
  documents?: Array<{ id: string; title: string; url: string; fileType: string }>;
}

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  status: string;
  orgRole: string | null;
  user: { id: string; email: string; name: string };
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
      const qs = new URLSearchParams({ page: String(page), pageSize: "15" });
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
    <div className="mx-auto max-w-5xl space-y-6">
      <button
        type="button"
        onClick={() => router.push("/projects")}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 项目列表
      </button>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: project.color }}
          >
            <FolderKanban size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{project.name}</h1>
              {project.sourceSystem === "bidtogo" && (
                <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                  BidToGo
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              负责人 {project.owner.name} · {project._count.tasks} 任务 ·{" "}
              {project._count.members} 成员
            </p>
            {project.description && (
              <p className="mt-2 text-sm text-muted">{project.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Link
                href={`/projects/${id}/prompts`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <FileText size={12} />
                Prompt 管理
              </Link>
              <Link
                href={`/projects/${id}/knowledge-bases`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <BookOpen size={12} />
                知识库
              </Link>
              <Link
                href={`/projects/${id}/conversations`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <MessageSquare size={12} />
                会话管理
              </Link>
              <Link
                href={`/projects/${id}/agents`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Bot size={12} />
                Agent 管理
              </Link>
              <Link
                href={`/projects/${id}/tools`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Wrench size={12} />
                工具注册
              </Link>
              <Link
                href={`/projects/${id}/feedbacks`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Star size={12} />
                评估反馈
              </Link>
              <Link
                href={`/projects/${id}/quality`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <BarChart3 size={12} />
                质量概览
              </Link>
              <Link
                href={`/projects/${id}/feedback-tags`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Tag size={12} />
                评估标签
              </Link>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  project.status === "active"
                    ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                    : project.status === "abandoned"
                      ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]"
                      : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                )}
              >
                {project.status === "active" ? "进行中" : project.status === "abandoned" ? "已放弃" : project.status}
              </span>
              {project.org ? (
                <Link
                  href={`/organizations/${project.org.id}`}
                  className="rounded-md bg-[rgba(110,125,118,0.08)] px-2 py-0.5 text-[#6e7d76] hover:bg-[rgba(110,125,118,0.12)]"
                >
                  组织：{project.org.name} ({project.org.code})
                </Link>
              ) : (
                <span className="rounded-md bg-[rgba(154,106,47,0.04)] px-2 py-0.5 text-[#9a6a2f]">
                  未绑定组织（历史项目）
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

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

      {/* Abandon button — visible from interpretation stage onward */}
      {project.status !== "abandoned" && canManage && (() => {
        const tenderProps = {
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
        };
        const stage = getProjectStage(tenderProps);
        const canAbandon = ["interpretation", "supplier_inquiry", "supplier_quote", "submission"].includes(stage);
        if (!canAbandon) return null;
        return (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowAbandonDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(166,61,61,0.2)] bg-white px-4 py-2 text-sm font-medium text-[#a63d3d] shadow-sm hover:bg-[rgba(166,61,61,0.04)] transition-colors"
            >
              <Ban size={14} />
              放弃项目
            </button>
          </div>
        );
      })()}

      {/* BidToGo intelligence */}
      {project.sourceSystem === "bidtogo" && (
        <BidToGoIntelligenceCard
          project={{
            sourceSystem: project.sourceSystem,
            sourcePlatform: project.sourcePlatform ?? null,
            clientOrganization: project.clientOrganization ?? null,
            location: project.location ?? null,
            estimatedValue: project.estimatedValue ?? null,
            currency: project.currency ?? null,
            solicitationNumber: project.solicitationNumber ?? null,
            tenderStatus: project.tenderStatus ?? null,
            dueDate: project.dueDate ?? null,
            externalRef: project.externalRef ?? null,
            intelligence: project.intelligence ?? null,
            documents: project.documents ?? [],
          }}
        />
      )}

      {/* Tender progress section — 招投标项目专用 */}
      {(project.sourceSystem === "bidtogo" || project.tenderStatus || project.category === "tender_opportunity") && (
        <ProjectProgressSection
          project={{
            createdAt: project.createdAt ?? null,
            tenderStatus: project.tenderStatus ?? null,
            publicDate: project.publicDate ?? null,
            questionCloseDate: project.questionCloseDate ?? null,
            closeDate: project.closeDate ?? null,
            dueDate: project.dueDate ?? null,
            distributedAt: project.distributedAt ?? null,
            dispatchedAt: project.dispatchedAt ?? null,
            intakeStatus: project.intakeStatus ?? null,
            interpretedAt: project.interpretedAt ?? null,
            supplierInquiredAt: project.supplierInquiredAt ?? null,
            supplierQuotedAt: project.supplierQuotedAt ?? null,
            submittedAt: project.submittedAt ?? null,
            awardDate: project.awardDate ?? null,
            sourceMetadataJson: project.sourceMetadataJson ?? null,
          }}
        />
      )}

      {/* progress section */}
      {progress && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BarChart3 size={16} className="text-accent/60" />
              项目进度
            </h3>
            {progress.stages.length > 0 && (
              <StageIndicator stages={progress.stages} />
            )}
          </div>
          <div className="mt-4">
            <ProgressComparison
              taskProgress={progress.taskProgress}
              timeProgress={progress.timeProgress}
              completedTasks={progress.completedTasks}
              totalTasks={progress.totalTasks}
              daysRemaining={progress.daysRemaining}
              daysTotal={progress.daysTotal}
              isOverdue={progress.isOverdue}
              riskLabel={progress.riskLabel}
            />
          </div>
        </div>
      )}

      {/* 项目讨论 */}
      <ProjectDiscussionSection projectId={id} canPost={canManage || members.some(m => m.status === "active")} projectStatus={project.status} />

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users size={16} />
          项目成员
        </div>
        {canManage && (
          <form onSubmit={addMember} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <input
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              placeholder="用户 ID（须已加入所属组织）"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy === "member"}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              添加
            </button>
          </form>
        )}
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="pb-2">用户</th>
              <th className="pb-2">邮箱</th>
              <th className="pb-2">项目角色</th>
              <th className="pb-2">组织角色</th>
              <th className="pb-2">状态</th>
              {canManage && <th className="pb-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="py-2">{m.user.name}</td>
                <td className="py-2 text-muted">{m.user.email}</td>
                <td className="py-2">
                  {canManage && m.status === "active" ? (
                    <select
                      value={m.role}
                      disabled={busy === m.id}
                      onChange={(e) => patchMember(m.id, e.target.value)}
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.role
                  )}
                </td>
                <td className="py-2 text-muted">{m.orgRole ?? "—"}</td>
                <td className="py-2">{m.status}</td>
                {canManage && (
                  <td className="py-2">
                    {m.status === "active" && (
                      <button
                        type="button"
                        onClick={() => removeMember(m.id)}
                        disabled={busy === m.id}
                        className="text-[#a63d3d] hover:text-[#a63d3d] disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ProjectNotificationRuleCard projectId={id} />

      {/* 项目动态时间线 */}
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History size={16} className="text-accent/60" />
            项目动态
            {activityTotal > 0 && (
              <span className="text-xs font-normal text-muted">
                共 {activityTotal} 条
              </span>
            )}
          </div>
          <select
            value={activityFilter}
            onChange={(e) => {
              setActivityFilter(e.target.value);
              loadActivity(1, e.target.value);
            }}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="">全部类型</option>
            <option value="project">项目</option>
            <option value="prompt">Prompt</option>
            <option value="knowledge_base">知识库</option>
            <option value="conversation">会话</option>
            <option value="agent">Agent</option>
            <option value="tool">工具</option>
            <option value="runtime">Runtime</option>
            <option value="conversation_feedback">反馈</option>
          </select>
        </div>

        <div className="mt-4">
          <ActivityTimeline activities={activities} loading={activityLoading && activityPage === 1} highlightId={highlightActivityId} />
        </div>

        {activities.length < activityTotal && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={activityLoading}
              onClick={() => loadActivity(activityPage + 1, activityFilter)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-[rgba(43,96,85,0.04)] hover:text-foreground disabled:opacity-50"
            >
              {activityLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ChevronDown size={12} />
              )}
              加载更多
            </button>
          </div>
        )}
      </div>

      {/* Abandon project dialog */}
      {showAbandonDialog && project && (() => {
        const tenderProps = {
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
        };
        return (
          <AbandonProjectDialog
            projectId={project.id}
            projectName={project.name}
            currentStage={getProjectStage(tenderProps)}
            onClose={() => setShowAbandonDialog(false)}
            onSuccess={() => {
              setShowAbandonDialog(false);
              load();
            }}
          />
        );
      })()}
    </div>
  );
}
