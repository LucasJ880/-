"use client";

import Link from "next/link";
import {
  Calendar,
  ExternalLink,
  FolderKanban,
  Sparkles,
  X,
} from "lucide-react";
import { MiniProgressBar } from "@/components/progress/mini-progress-bar";
import { RiskBadge } from "@/components/progress/risk-badge";
import { cn, TASK_STATUS, type TaskStatus } from "@/lib/utils";
import { formatISODateToronto } from "@/lib/time";
import { deriveAiHint } from "./derive-ai-hint";
import type { WorkQueueItem } from "./types";

type Props = {
  item: WorkQueueItem | null;
  onClose?: () => void;
  onOpenDetail: (item: WorkQueueItem) => void;
  /** xl 常驻时隐藏关闭按钮 */
  embedded?: boolean;
  className?: string;
};

export function ContextInspector({
  item,
  onClose,
  onOpenDetail,
  embedded,
  className,
}: Props) {
  const hint = deriveAiHint(item);

  if (!item) {
    return (
      <aside
        className={cn(
          "flex h-full flex-col border-border bg-card-bg",
          className,
        )}
      >
        {!embedded && onClose && (
          <div className="flex justify-end p-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-muted hover:bg-accent-soft"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-medium text-foreground">选择一项工作</p>
          <p className="mt-1 text-xs text-muted">
            详情仅展示接口返回的真实字段
          </p>
        </div>
      </aside>
    );
  }

  const isSummary = item.entityType === "summary";
  const statusLabel =
    item.task && item.task.status in TASK_STATUS
      ? TASK_STATUS[item.task.status as TaskStatus].label
      : item.status;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-border bg-card-bg",
        className,
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {isSummary ? "汇总" : item.entityType === "project" ? "项目" : item.entityType === "reminder" ? "提醒" : "任务"}
          </p>
          <h2 className="mt-1 break-words text-base font-semibold text-foreground">
            {item.title}
          </h2>
          {item.subtitle && (
            <p className="mt-1 text-xs text-muted">{item.subtitle}</p>
          )}
        </div>
        {!embedded && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-2 text-muted hover:bg-accent-soft"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* 仅真实对象展示详情字段 */}
        {!isSummary && (
          <dl className="space-y-3 text-sm">
            {statusLabel && (
              <div>
                <dt className="text-[11px] text-muted">状态</dt>
                <dd className="mt-0.5 text-foreground">{statusLabel}</dd>
              </div>
            )}
            {item.projectName && (
              <div>
                <dt className="text-[11px] text-muted">项目</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-foreground">
                  <FolderKanban size={13} className="text-muted" />
                  {item.projectName}
                </dd>
              </div>
            )}
            {item.dueDate && (
              <div>
                <dt className="text-[11px] text-muted">截止日期</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-foreground">
                  <Calendar size={13} className="text-muted" />
                  {formatISODateToronto(item.dueDate)}
                </dd>
              </div>
            )}
            {item.progress && (
              <div>
                <dt className="mb-1.5 text-[11px] text-muted">进度</dt>
                <dd>
                  <MiniProgressBar
                    value={item.progress.taskProgress}
                    isOverdue={item.progress.isOverdue}
                    isAtRisk={item.progress.isAtRisk}
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    {item.progress.completedTasks}/{item.progress.totalTasks} 任务
                  </p>
                  <div className="mt-2">
                    <RiskBadge
                      level={item.progress.riskLevel}
                      label={item.progress.riskLabel}
                      isOverdue={item.progress.isOverdue}
                      compact
                    />
                  </div>
                </dd>
              </div>
            )}
            {item.riskLevel && !item.progress && (
              <div>
                <dt className="text-[11px] text-muted">风险</dt>
                <dd className="mt-1">
                  <RiskBadge level={item.riskLevel} compact />
                </dd>
              </div>
            )}
          </dl>
        )}

        {isSummary && (
          <p className="text-sm text-muted">
            这是数量汇总，不含单条标题或负责人。请进入列表处理。
          </p>
        )}

        {hint && (
          <div className="rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
              <Sparkles size={12} />
              建议
            </p>
            <p className="mt-1 text-xs leading-relaxed text-foreground">
              {hint}
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border p-4">
        {isSummary && item.summaryHref ? (
          <Link
            href={item.summaryHref}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
          >
            进入处理
            <ExternalLink size={14} />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onOpenDetail(item)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
          >
            打开详情
          </button>
        )}
        {item.projectId && item.entityType !== "project" && (
          <Link
            href={`/projects/${item.projectId}`}
            className="flex h-9 w-full items-center justify-center rounded-[var(--radius-md)] border border-border text-sm text-foreground hover:bg-accent-soft"
          >
            进入协同空间 / 项目
          </Link>
        )}
      </div>
    </aside>
  );
}
