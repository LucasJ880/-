"use client";

import Link from "next/link";
import {
  Gauge,
  ArrowRight,
  AlertTriangle,
  Clock,
  TrendingUp,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniProgressBar } from "@/components/progress/mini-progress-bar";
import { StageIndicator } from "@/components/progress/stage-indicator";
import { RiskBadge } from "@/components/progress/risk-badge";
import type { ProjectBreakdown, ProjectProgressData } from "./types";

interface Props {
  projectBreakdown: ProjectBreakdown[];
  projectProgress: Record<string, ProjectProgressData>;
  onProjectClick?: (projectId: string) => void;
}

function DeadlineLabel({ prog }: { prog: ProjectProgressData }) {
  if (!prog.dueDate) return null;

  if (prog.isOverdue) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-[#a63d3d]">
        <AlertTriangle size={10} />
        已逾期
      </span>
    );
  }

  if (prog.daysRemaining <= 3) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-[#b06a28]">
        <Clock size={10} />
        剩 {prog.daysRemaining} 天
      </span>
    );
  }

  if (prog.daysRemaining <= 7) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted">
        <Clock size={10} />
        剩 {prog.daysRemaining} 天
      </span>
    );
  }

  return null;
}

function ProjectProgressRow({
  project,
  progress,
  onProjectClick,
}: {
  project: ProjectBreakdown;
  progress: ProjectProgressData;
  onProjectClick?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onProjectClick?.(project.id)}
      className={cn(
        "w-full px-5 py-3.5 text-left transition-colors",
        onProjectClick && "hover:bg-[rgba(43,96,85,0.03)]"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {project.name}
        </span>

        {progress.isAtRisk && (
          <RiskBadge
            level={progress.riskLevel}
            isOverdue={progress.isOverdue}
            compact
          />
        )}

        <DeadlineLabel prog={progress} />

        {progress.weekDelta > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] font-medium text-[#2e7a56]">
            <TrendingUp size={10} />
            +{progress.weekDelta}%
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <div className="w-28 shrink-0">
          <MiniProgressBar
            value={progress.taskProgress}
            isOverdue={progress.isOverdue}
            isAtRisk={progress.isAtRisk}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <StageIndicator stages={progress.stages} compact />
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted">
        <span>{progress.completedTasks}/{progress.totalTasks} 任务完成</span>
        <span>·</span>
        <span>{progress.currentStage}</span>
      </div>
    </button>
  );
}

function ProjectSimpleRow({
  project,
  onProjectClick,
}: {
  project: ProjectBreakdown;
  onProjectClick?: (id: string) => void;
}) {
  const pct = project.total > 0 ? Math.round((project.done / project.total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={() => onProjectClick?.(project.id)}
      className={cn(
        "w-full px-5 py-3 text-left transition-colors",
        onProjectClick && "hover:bg-[rgba(43,96,85,0.03)]"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {project.name}
        </span>
        <div className="w-20 shrink-0">
          <MiniProgressBar value={pct} />
        </div>
      </div>
      <div className="mt-1 pl-[22px] text-[10px] text-muted">
        {project.done}/{project.total} 任务完成
      </div>
    </button>
  );
}

export function DashboardProgressOverview({
  projectBreakdown,
  projectProgress,
  onProjectClick,
}: Props) {
  if (projectBreakdown.length === 0) return null;

  const withProgress = projectBreakdown.filter((p) => projectProgress[p.id]);
  const withoutProgress = projectBreakdown.filter((p) => !projectProgress[p.id]);

  const atRisk = withProgress.filter((p) => projectProgress[p.id].isAtRisk);
  const healthy = withProgress.filter((p) => !projectProgress[p.id].isAtRisk);

  const sorted = [...atRisk, ...healthy];

  if (sorted.length === 0 && withoutProgress.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Gauge size={15} className="text-[#805078]" />
          <h2 className="text-sm font-semibold">项目进度一览</h2>
          {atRisk.length > 0 && (
            <span className="rounded-full bg-[rgba(166,61,61,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[#a63d3d]">
              {atRisk.length} 项预警
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {sorted.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <CheckCircle2 size={10} className="text-[#2e7a56]" />
              {healthy.length}/{sorted.length} 正常
            </span>
          )}
          <Link
            href="/reports"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <FileText size={10} />
            生成周报
          </Link>
          <Link
            href="/projects"
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            全部 <ArrowRight size={10} />
          </Link>
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {sorted.slice(0, 5).map((p) => (
          <ProjectProgressRow
            key={p.id}
            project={p}
            progress={projectProgress[p.id]}
            onProjectClick={onProjectClick}
          />
        ))}
        {sorted.length < 5 && withoutProgress.slice(0, 5 - sorted.length).map((p) => (
          <ProjectSimpleRow
            key={p.id}
            project={p}
            onProjectClick={onProjectClick}
          />
        ))}
      </div>
    </div>
  );
}
