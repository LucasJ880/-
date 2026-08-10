"use client";

/**
 * Job Card（2D-1 Job Center 列表卡片，只读）
 *
 * 展示：Title / Status / Progress / Current Task(s) / Last Activity /
 * Needs You 指示。多 currentTask 从第一天按数组渲染（2B-2 前向兼容）。
 * 不渲染任何 runtime 内部词汇与 mutation 操作。
 */

import Link from "next/link";
import { Clock, HandHelping, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkforceJobListItem } from "@/lib/workforce-runtime/read-model";
import {
  JOB_STATUS_PRESENTATION,
  UNTITLED_JOB,
  currentTasksHeading,
  formatRelativeTime,
  hasPlannedTasks,
  progressPercent,
  progressText,
  workerLabel,
} from "./presentation";

export function JobProgressBar({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) {
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07] ${className ?? ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function WorkerChip({ workerKey }: { workerKey?: string }) {
  const label = workerLabel(workerKey);
  if (!label) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-accent/[0.08] px-1.5 py-0.5 text-[10px] font-medium leading-4 text-accent">
      {label}
    </span>
  );
}

export function JobCard({ job }: { job: WorkforceJobListItem }) {
  const statusMeta = JOB_STATUS_PRESENTATION[job.status];
  const planned = hasPlannedTasks(job.progress);

  return (
    <Link
      href={`/workforce/${job.jobId}`}
      className="group block rounded-xl border border-border/60 bg-card px-4 py-3.5 transition-colors hover:border-accent/30 hover:bg-muted/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {job.title ?? UNTITLED_JOB}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <StatusBadge
              status={job.status}
              label={statusMeta.label}
              tone={statusMeta.tone}
              showDot
            />
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {formatRelativeTime(job.lastActivityAt)}
            </span>
          </div>
        </div>
        <ChevronRight
          size={16}
          className="mt-1 shrink-0 text-muted/40 transition-transform group-hover:translate-x-0.5"
        />
      </div>

      {planned ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">{progressText(job.progress)}</span>
            {job.progress.blockedTasks > 0 ? (
              <span className="text-danger">{job.progress.blockedTasks} 项受阻</span>
            ) : null}
          </div>
          <JobProgressBar percent={progressPercent(job.progress)} className="mt-1.5" />
        </div>
      ) : job.status === "QUEUED" || job.status === "WORKING" ? (
        <p className="mt-3 text-xs text-muted">正在拆解任务…</p>
      ) : null}

      {job.currentTasks.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium text-muted/80">
            {currentTasksHeading(job.currentTasks.length)}
          </p>
          <ul className="mt-1 space-y-1">
            {job.currentTasks.slice(0, 3).map((task) => (
              <li
                key={task.stepKey}
                className="flex min-w-0 items-center gap-1.5 text-xs text-foreground/90"
              >
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                <span className="truncate">{task.title}</span>
                <WorkerChip workerKey={task.workerKey} />
              </li>
            ))}
            {job.currentTasks.length > 3 ? (
              <li className="text-xs text-muted">
                还有 {job.currentTasks.length - 3} 项进行中…
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {job.needsYou ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning-bg px-2.5 py-2 text-xs text-warning">
          <HandHelping size={13} className="shrink-0" />
          <span className="min-w-0 truncate font-medium">{job.needsYou.title}</span>
        </div>
      ) : null}
    </Link>
  );
}
