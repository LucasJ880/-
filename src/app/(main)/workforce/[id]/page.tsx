"use client";

/**
 * Job Detail（2D-1，READ-ONLY）
 *
 * 单个 AI 任务的完整视图：状态 / 进度 / 当前任务 / 全部任务 / 时间线 /
 * 需要你 / 最终结果 / 业务归属。只消费 user timeline——内部时间线
 * 结构性不出现在本页面（API 本就不返回，源码审计禁止引用）。
 * 无任何 mutation 入口；Needs You 仅提供跳转到已有审批中心的只读入口。
 */

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  HandHelping,
  ListChecks,
  Loader2,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type {
  WorkforceJobViewModel,
  WorkforceTaskView,
  WorkforceTimelineItem,
} from "@/lib/workforce-runtime/read-model";
import { JobProgressBar, WorkerChip } from "../job-card";
import {
  JOB_STATUS_PRESENTATION,
  UNTITLED_JOB,
  businessRefLabel,
  currentTasksHeading,
  finalResultPlaceholder,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  hasPlannedTasks,
  isActiveJobStatus,
  needsYouCardModel,
  progressPercent,
  progressText,
  taskStatusPresentation,
  timelineItemText,
  timelineKindPresentation,
} from "../presentation";

const POLL_INTERVAL_MS = 15_000;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; job: WorkforceJobViewModel }
  | { kind: "not_found" }
  | { kind: "org_selection" }
  | { kind: "no_org" }
  | { kind: "server_error" };

export default function WorkforceJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent: boolean) => {
      if (silent) setRefreshing(true);
      try {
        const res = await apiFetch(`/api/workforce/jobs/${encodeURIComponent(id)}`);
        if (res.status === 404) {
          setState({ kind: "not_found" });
          return;
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as
            | { needsSelection?: boolean }
            | null;
          setState(
            body?.needsSelection ? { kind: "org_selection" } : { kind: "no_org" },
          );
          return;
        }
        if (!res.ok) {
          setState((prev) =>
            silent && prev.kind === "ready" ? prev : { kind: "server_error" },
          );
          return;
        }
        const data = (await res.json()) as { job: WorkforceJobViewModel };
        setState({ kind: "ready", job: data.job });
      } catch {
        setState((prev) =>
          silent && prev.kind === "ready" ? prev : { kind: "server_error" },
        );
      } finally {
        setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    setState({ kind: "loading" });
    void load(false);
  }, [load]);

  // 活跃任务轻量轮询（终态停止；页面不可见时跳过）
  const active = state.kind === "ready" && isActiveJobStatus(state.job.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/workforce"
        className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={13} />
        返回 AI 任务
      </Link>

      <div className="mt-3">
        {state.kind === "loading" ? (
          <DetailSkeleton />
        ) : state.kind === "ready" ? (
          <JobDetail
            job={state.job}
            refreshing={refreshing}
            onRefresh={() => void load(true)}
          />
        ) : state.kind === "not_found" ? (
          <EmptyState
            icon={SearchX}
            size="page"
            title="任务不存在"
            description="任务可能已被移除，或不属于当前组织"
            action={<BackToCenter />}
          />
        ) : state.kind === "org_selection" ? (
          <EmptyState
            icon={Building2}
            size="page"
            title="请先选择工作组织"
            description="你属于多个组织，选择后即可查看该组织的 AI 任务"
            action={
              <Link
                href="/select-org"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                选择组织
              </Link>
            }
          />
        ) : state.kind === "no_org" ? (
          <EmptyState
            icon={Building2}
            size="page"
            title="暂无可用组织"
            description="加入组织后即可查看 AI 任务"
          />
        ) : (
          <EmptyState
            size="page"
            title="加载失败"
            description="网络或服务暂时不可用，请稍后重试"
            action={
              <button
                type="button"
                onClick={() => void load(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/5"
              >
                重试
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}

function BackToCenter() {
  return (
    <Link
      href="/workforce"
      className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/5"
    >
      返回 AI 任务
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-7 w-2/3 rounded bg-foreground/[0.07]" />
      <div className="h-4 w-1/3 rounded bg-foreground/[0.05]" />
      <div className="h-28 rounded-xl border border-border/60 bg-card" />
      <div className="h-40 rounded-xl border border-border/60 bg-card" />
    </div>
  );
}

function JobDetail({
  job,
  refreshing,
  onRefresh,
}: {
  job: WorkforceJobViewModel;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const statusMeta = JOB_STATUS_PRESENTATION[job.status];
  const duration = formatDuration(job.startedAt, job.completedAt);

  return (
    <div>
      <PageHeader
        title={job.title ?? UNTITLED_JOB}
        meta={
          <>
            <StatusBadge
              status={job.status}
              label={statusMeta.label}
              tone={statusMeta.tone}
              showDot
            />
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              创建于 {formatDateTime(job.createdAt)}
            </span>
            {duration ? <span>用时 {duration}</span> : null}
            <span>最近活动 {formatRelativeTime(job.lastActivityAt)}</span>
          </>
        }
        actions={
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-muted/5 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            刷新
          </button>
        }
      />

      {job.needsYou ? <NeedsYouCard job={job} /> : null}

      {/* 桌面双栏：主内容 + 时间线侧栏；移动端自动叠为单列 */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <ProgressSection job={job} />
          {job.currentTasks.length > 0 ? <CurrentTasksSection job={job} /> : null}
          <AllTasksSection tasks={job.tasks} />
          <FinalResultSection job={job} />
        </div>

        <div className="min-w-0 space-y-5">
          <TimelineSection timeline={job.timeline} />
          {job.businessRefs && job.businessRefs.length > 0 ? (
            <BusinessRefsSection refs={job.businessRefs} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Icon size={14} className="text-accent" />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function NeedsYouCard({ job }: { job: WorkforceJobViewModel }) {
  if (!job.needsYou) return null;
  const model = needsYouCardModel(job.needsYou);
  return (
    <div className="mt-4 rounded-xl border border-warning/30 bg-warning-bg p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15">
          <HandHelping size={15} className="text-warning" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{model.title}</p>
          {model.detail ? (
            <p className="mt-1 break-words text-[13px] leading-relaxed text-foreground/80">
              {model.detail}
            </p>
          ) : null}
          {model.pendingCount > 0 ? (
            <p className="mt-1 text-xs text-muted">
              涉及 {model.pendingCount} 项审批
            </p>
          ) : null}
        </div>
        {model.action ? (
          <Link
            href={model.action.href}
            className="shrink-0 rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {model.action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function ProgressSection({ job }: { job: WorkforceJobViewModel }) {
  const planned = hasPlannedTasks(job.progress);
  return (
    <SectionCard title="进度" icon={CheckCircle2}>
      {planned ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              {progressText(job.progress)}
            </span>
            <span className="text-xs text-muted">
              {progressPercent(job.progress)}%
            </span>
          </div>
          <JobProgressBar percent={progressPercent(job.progress)} className="mt-2" />
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {job.progress.activeTasks > 0 ? (
              <span>{job.progress.activeTasks} 项进行中</span>
            ) : null}
            {job.progress.blockedTasks > 0 ? (
              <span className="text-danger">{job.progress.blockedTasks} 项受阻</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {isActiveJobStatus(job.status) ? "正在拆解任务…" : "未产生任务拆解"}
        </p>
      )}
    </SectionCard>
  );
}

function CurrentTasksSection({ job }: { job: WorkforceJobViewModel }) {
  return (
    <SectionCard
      title={currentTasksHeading(job.currentTasks.length)}
      icon={Loader2}
    >
      <ul className="space-y-2">
        {job.currentTasks.map((task) => (
          <li
            key={task.stepKey}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-border/50 bg-muted/[0.03] px-3 py-2"
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {task.title}
            </span>
            <WorkerChip workerKey={task.workerKey} />
            {task.startedAt ? (
              <span className="shrink-0 text-[11px] text-muted">
                {formatRelativeTime(task.startedAt)}开始
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function AllTasksSection({ tasks }: { tasks: WorkforceTaskView[] }) {
  return (
    <SectionCard title="全部任务" icon={ListChecks}>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">暂无任务拆解</p>
      ) : (
        <ol className="space-y-1">
          {tasks.map((task, index) => {
            const meta = taskStatusPresentation(task.status);
            return (
              <li
                key={task.stepKey}
                className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/5"
              >
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted/60">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                  {task.title}
                </span>
                <WorkerChip workerKey={task.workerKey} />
                <StatusBadge status={task.status} label={meta.label} tone={meta.tone} />
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

const TIMELINE_TONE_DOT: Record<string, string> = {
  neutral: "bg-muted/50",
  accent: "bg-accent",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
};

function TimelineSection({ timeline }: { timeline: WorkforceTimelineItem[] }) {
  // 最新在上（sequence DESC 展示；数据本身 sequence ASC 有序）
  const items = [...timeline].reverse();
  return (
    <SectionCard title="时间线" icon={Clock}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">暂无动态</p>
      ) : (
        <ol className="relative space-y-3 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-border/60">
          {items.map((item) => {
            const meta = timelineKindPresentation(item.kind);
            return (
              <li key={item.sequence} className="relative flex gap-3 pl-4">
                <span
                  className={cn(
                    "absolute left-0 top-1.5 h-[7px] w-[7px] rounded-full",
                    TIMELINE_TONE_DOT[meta.tone] ?? TIMELINE_TONE_DOT.neutral,
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[13px] leading-snug text-foreground/90">
                    {timelineItemText(item)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {meta.label} · {formatDateTime(item.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

function FinalResultSection({ job }: { job: WorkforceJobViewModel }) {
  return (
    <SectionCard title="最终结果" icon={FileText}>
      {job.finalSummary ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
          {job.finalSummary}
        </p>
      ) : (
        <p className="text-sm text-muted">{finalResultPlaceholder(job.status)}</p>
      )}
    </SectionCard>
  );
}

function BusinessRefsSection({
  refs,
}: {
  refs: NonNullable<WorkforceJobViewModel["businessRefs"]>;
}) {
  return (
    <SectionCard title="业务归属" icon={Building2}>
      <div className="flex flex-wrap gap-1.5">
        {refs.map((ref) => (
          <span
            key={`${ref.type}:${ref.id}`}
            title={ref.id}
            className="inline-flex items-center rounded-full bg-foreground/[0.05] px-2 py-0.5 text-xs text-foreground/80"
          >
            {businessRefLabel(ref.type)}
          </span>
        ))}
      </div>
    </SectionCard>
  );
}
