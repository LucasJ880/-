"use client";

/**
 * Tab 1「工作台」— Tender 操作中心（T1A）。
 * 决策摘要 / Needs You / 阶段与决定 / AI 简报 / 结论 / 情报摘要 / 团队 / 讨论 / 动态。
 * 全部复用既有数据源；没有可靠数据的项显示「暂无」而非伪造数值。
 */

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  BellRing,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  Settings,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { FinancialControlCard } from "@/components/project-detail/financial-control-card";
import { ProgressComparison } from "@/components/progress/progress-comparison";
import { StageIndicator } from "@/components/progress/stage-indicator";
import { ProjectProgressSection } from "@/components/tender/project-progress-section";
import { ProjectDiscussionSection } from "@/components/project-discussion/project-discussion-section";
import { ProjectAiSummaryCard } from "@/components/project-ai-summary/project-ai-summary-card";
import { ProjectProgressSummary } from "@/components/project-progress/project-progress-summary";
import { ProjectInsightsPanel } from "@/components/project-insights/project-insights-panel";
import { ProjectOnboardingGuide } from "@/components/project-onboarding/project-onboarding-guide";
import { TenderBenchmarkCard } from "@/components/project-detail/tender-benchmark-card";
import { StartIntelligencePanel } from "@/components/bid-workflow/start-intelligence-panel";
import { ProjectJoinBriefs } from "@/components/bid-workflow/project-join-briefs";
import { WorkbenchCommandDeck } from "@/components/tender/workbench-command-deck";
import { ProjectNotificationRuleCard } from "@/components/notification/project-notification-rule-card";
import {
  ProjectCommandOverview,
  type ProjectCommandState,
  type ProjectContextPendingAction,
  type ProjectContextTarget,
} from "@/components/project-detail/project-context-panel";
import {
  buildTenderProps,
  isTenderProject,
  type MemberRow,
  type ProjectDetail,
} from "@/components/project-detail/project-detail-types";
import { ACTIVITY_TYPE_LABELS, PROJECT_DUTY_LABELS, PROJECT_MEMBER_STATUS_LABELS } from "@/lib/i18n/labels";
import type { FormattedActivity } from "@/lib/activity/formatter";
import type { ProjectProgress } from "@/lib/progress/types";
import type { ProjectDuty } from "@/lib/projects/duty";
import type { TenderWorkbenchState } from "@/lib/tender/workbench-state";

const PROJECT_DUTIES: ProjectDuty[] = ["owner", "purchaser", "participant"];


interface WorkbenchTabProps {
  projectId: string;
  project: ProjectDetail;
  command: ProjectCommandState;
  workbenchState: TenderWorkbenchState;
  progress: ProjectProgress | null;
  pendingActions: ProjectContextPendingAction[];
  businessActivities: FormattedActivity[];
  /** 未过滤的原始活动条数（分页判断用；businessActivities 为业务视角过滤后的展示集） */
  activityCount: number;
  activityTotal: number;
  activityPage: number;
  activityLoading: boolean;
  activityFilter: string;
  onLoadActivity: (page: number, filter: string) => void;
  onActivityFilterChange: (filter: string) => void;
  highlightActivityId?: string;
  members: MemberRow[];
  canManage: boolean;
  currentUserId: string | null;
  onNavigate: (target: ProjectContextTarget) => void;
  onReload: () => void;
}

export function WorkbenchTab({
  projectId,
  project,
  command,
  workbenchState,
  progress,
  pendingActions,
  businessActivities,
  activityCount,
  activityTotal,
  activityPage,
  activityLoading,
  activityFilter,
  onLoadActivity,
  onActivityFilterChange,
  highlightActivityId,
  members,
  canManage,
  currentUserId,
  onNavigate,
  onReload,
}: WorkbenchTabProps) {
  const [mentionDraft, setMentionDraft] = useState<{ userId: string; name: string } | null>(null);
  const tenderProps = buildTenderProps(project);
  const tenderish = isTenderProject(project);

  return (
    <div className="space-y-6">
      <ProjectCommandOverview
        command={command}
        pendingCount={pendingActions.length}
        recentActivity={businessActivities[0] ?? null}
        onNavigate={onNavigate}
      />

      {/* 工作台指挥台（关键信息条 / 项目摘要内联 / 情报摘要真数据）——零跳转 */}
      {tenderish ? (
        <WorkbenchCommandDeck
          projectId={projectId}
          onOpenIntel={() => onNavigate("intel")}
        />
      ) : null}

      <NeedsYouCard pendingActions={pendingActions} onOpenChat={() => onNavigate("chat")} />

      {/* Tender 工作流 Quick Start：仅招投标项目展示（canonical workDomain 判定） */}
      {tenderish ? (
        <ProjectOnboardingGuide
          state={workbenchState}
          onNavigate={(target) => onNavigate(target)}
        />
      ) : null}

      {/* FB-13：历史项目对标（团队成员进工作台即见结论；无候选/未启用时自渲染 null） */}
      {tenderish ? <TenderBenchmarkCard projectId={projectId} /> : null}

      {/* T2-P1.5 财务控制卡（feature dark 时自渲染为空） */}
      <FinancialControlCard projectId={projectId} currentUserId={currentUserId ?? undefined} />

      {/* 阶段与决定 */}
      {project.intelligenceAvailable === false ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          当前环境尚未启用投标智能（数据库未完成迁移）。项目文件、成员与询价等主链仍可用；调查需在迁移后初始化。
        </div>
      ) : (
        <StartIntelligencePanel
          projectId={projectId}
          hasRoom={!!project.intelligenceRoom}
          goDecision={project.intelligenceRoom?.goDecision ?? null}
          bidPhaseStatus={project.bidPhaseStatus ?? null}
          aiSuggestion={
            project.intelligence?.recommendation ??
            project.aiAdviceStatus ??
            null
          }
          onChanged={onReload}
        />
      )}

      {tenderish ? (
        <ProjectProgressSection
          project={tenderProps}
          projectId={projectId}
          canManage={canManage}
          onUpdated={onReload}
        />
      ) : (
        progress && (
          <div className="rounded-xl border border-border bg-card-bg p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <BarChart3 size={16} className="text-accent/60" />
                项目进度
              </h3>
              {progress.stages.length > 0 && <StageIndicator stages={progress.stages} />}
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
        )
      )}

      {/* AI 简报：泛文本摘要默认折叠（关键信息已由顶部指挥台承担，屏幕还给硬字段） */}
      <details className="group rounded-xl border border-border bg-card-bg" data-testid="workbench-ai-brief">
        <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold text-foreground sm:p-5">
          <Sparkles size={16} className="text-accent/60" />
          AI 简报（详细文字版）
          <span className="ml-auto text-[10px] font-normal text-muted group-open:hidden">
            展开
          </span>
        </summary>
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          <ProjectAiSummaryCard projectId={projectId} />
          <ProjectProgressSummary projectId={projectId} />
        </div>
      </details>

      <ProjectInsightsPanel projectId={projectId} canManage={canManage} />

      {/* 团队 */}
      <TeamCard
        projectId={projectId}
        members={members}
        canManage={canManage}
        currentUserId={currentUserId}
        onChanged={onReload}
        onMention={(draft) => {
          setMentionDraft(draft);
          setTimeout(() => {
            document.getElementById("project-discussion")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }}
      />

      {/* 项目讨论 */}
      <ProjectDiscussionSection
        projectId={projectId}
        canPost={canManage || members.some((m) => m.status === "active")}
        projectStatus={project.status}
        mentionDraft={mentionDraft}
        onMentionConsumed={() => setMentionDraft(null)}
        members={members
          .filter((m) => m.status === "active")
          .map((m) => ({ userId: m.user.id, name: m.user.name, avatar: m.user.avatar ?? null }))}
      />

      {/* 项目动态 */}
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History size={16} className="text-accent/60" />
            项目动态
            {activityTotal > 0 && (
              <span className="text-xs font-normal text-muted">共 {activityTotal} 条</span>
            )}
          </div>
          <select
            value={activityFilter}
            onChange={(e) => {
              onActivityFilterChange(e.target.value);
              onLoadActivity(1, e.target.value);
            }}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="">全部类型</option>
            {Object.entries(ACTIVITY_TYPE_LABELS).map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          <ActivityTimeline
            activities={businessActivities}
            loading={activityLoading && activityPage === 1}
            highlightId={highlightActivityId}
          />
        </div>
        {activityCount < activityTotal && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={activityLoading}
              onClick={() => onLoadActivity(activityPage + 1, activityFilter)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-accent-soft hover:text-foreground disabled:opacity-50"
            >
              {activityLoading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
              加载更多
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Needs You：AI 待确认动作汇总（数据源 = /api/ai/pending-actions，无数据不渲染假条目） */
function NeedsYouCard({
  pendingActions,
  onOpenChat,
}: {
  pendingActions: ProjectContextPendingAction[];
  onOpenChat: () => void;
}) {
  if (pendingActions.length === 0) return null;
  return (
    <section
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
      data-testid="workbench-needs-you"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BellRing size={16} className="text-amber-600" />
          需要你确认 · {pendingActions.length}
        </h3>
        <Link href="/capabilities/approvals" className="text-xs text-muted underline hover:text-foreground">
          审批中心
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted">
        AI 只提供草稿，以下动作需要有权限的用户确认后才会执行。
      </p>
      <ul className="mt-3 space-y-2">
        {pendingActions.slice(0, 3).map((action) => (
          <li key={action.id} className="rounded-lg border border-border bg-card-bg p-3">
            <p className="text-xs font-medium text-foreground">{action.title}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">{action.preview}</p>
            <p className="mt-1 flex items-center gap-1 text-[10px] text-muted">
              <Clock3 size={10} />
              有效期至 {new Date(action.expiresAt).toLocaleString("zh-CN")}
            </p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onOpenChat}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
      >
        <Sparkles size={12} />
        在对话中处理
      </button>
    </section>
  );
}

/** 团队：成员管理 + 加入简报 + 通知规则（原页面底部常驻区收敛为工作台卡片） */
function TeamCard({
  projectId,
  members,
  canManage,
  currentUserId,
  onChanged,
  onMention,
}: {
  projectId: string;
  members: MemberRow[];
  canManage: boolean;
  currentUserId: string | null;
  onChanged: () => void;
  onMention: (draft: { userId: string; name: string }) => void;
}) {
  const [addUserId, setAddUserId] = useState("");
  const [addDuty, setAddDuty] = useState<ProjectDuty>("participant");
  const [busy, setBusy] = useState<string | null>(null);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const uid = addUserId.trim();
    if (!uid) return;
    setBusy("member");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, duty: addDuty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "添加失败");
      setAddUserId("");
      setAddDuty("participant");
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(null);
    }
  }

  async function patchMemberDuty(memberId: string, duty: ProjectDuty) {
    setBusy(memberId);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "更新失败");
      onChanged();
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
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "移除失败");
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "移除失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="project-members" className="rounded-xl border border-border bg-card-bg p-5 scroll-mt-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Users size={16} />项目团队
      </div>
      <p className="mt-1 text-xs text-muted">
        主负责人与主采购人跟进各节点；参与者知情截标日；有开标日时全员通知。
      </p>
      {canManage && (
        <form onSubmit={addMember} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <input
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="用户 ID（须已加入所属组织）"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select
            value={addDuty}
            onChange={(e) => setAddDuty(e.target.value as ProjectDuty)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {PROJECT_DUTIES.map((d) => (
              <option key={d} value={d}>{PROJECT_DUTY_LABELS[d]}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy === "member"}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
          >
            添加
          </button>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="pb-2 w-10" /><th className="pb-2">用户</th><th className="pb-2">邮箱</th>
              <th className="pb-2">项目身份</th><th className="pb-2">状态</th>
              {canManage && <th className="pb-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="py-2">
                  <button
                    type="button"
                    title={`@${m.user.name}`}
                    onClick={() => onMention({ userId: m.user.id, name: m.user.name })}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent transition-colors hover:bg-accent/20 overflow-hidden"
                  >
                    {m.user.avatar ? (
                      <img src={m.user.avatar} alt={m.user.name} className="h-full w-full object-cover" />
                    ) : (
                      m.user.name.slice(0, 1).toUpperCase()
                    )}
                  </button>
                </td>
                <td className="py-2">{m.user.name}</td>
                <td className="py-2 text-muted">{m.user.email}</td>
                <td className="py-2">
                  {canManage && m.status === "active" ? (
                    <select
                      value={m.duty}
                      disabled={busy === m.id}
                      onChange={(e) => patchMemberDuty(m.id, e.target.value as ProjectDuty)}
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      {PROJECT_DUTIES.map((d) => (
                        <option key={d} value={d}>{PROJECT_DUTY_LABELS[d]}</option>
                      ))}
                    </select>
                  ) : (
                    PROJECT_DUTY_LABELS[m.duty] ?? m.duty
                  )}
                </td>
                <td className="py-2">{PROJECT_MEMBER_STATUS_LABELS[m.status] ?? m.status}</td>
                {canManage && (
                  <td className="py-2">
                    {m.status === "active" && m.duty !== "owner" && (
                      <button
                        type="button"
                        onClick={() => removeMember(m.id)}
                        disabled={busy === m.id}
                        className="text-danger hover:text-danger disabled:opacity-50"
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

      <div className="mt-4">
        <ProjectJoinBriefs projectId={projectId} currentUserId={currentUserId} />
      </div>

      <details className="mt-4 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted">
          <Settings size={12} className="mr-1 inline" />
          项目通知设置
        </summary>
        <div className="mt-2">
          <ProjectNotificationRuleCard projectId={projectId} />
        </div>
      </details>
    </div>
  );
}
