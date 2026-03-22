"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Loader2,
  FolderKanban,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { ProgressComparison } from "@/components/progress/progress-comparison";
import { StageIndicator } from "@/components/progress/stage-indicator";
import type { FormattedActivity } from "@/lib/activity/formatter";

interface ProgressData {
  taskProgress: number;
  completedTasks: number;
  totalTasks: number;
  timeProgress: number;
  daysRemaining: number;
  daysTotal: number;
  currentStage: string;
  stages: { key: string; label: string; status: "done" | "current" | "pending" }[];
  riskLevel: "none" | "low" | "medium" | "high";
  riskLabel: string | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  weekDelta: number;
  dueDate: string | null;
}

interface OverviewData {
  project: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    status: string;
    startDate: string | null;
    dueDate: string | null;
    createdAt: string;
    updatedAt: string;
  };
  counts: Record<string, number>;
  recentActivity: FormattedActivity[];
  progress: ProgressData | null;
}

interface ProjectQuickViewDrawerProps {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
  highlightActivityId?: string | null;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: "正常", cls: "bg-[rgba(46,122,86,0.10)] text-[#2e7a56]" },
  archived: { label: "已归档", cls: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  suspended: { label: "已停用", cls: "bg-[rgba(166,61,61,0.10)] text-[#a63d3d]" },
};

const STAT_ITEMS = [
  { key: "tasks", label: "任务", icon: FolderKanban },
  { key: "members", label: "成员", icon: Users },
] as const;

export function ProjectQuickViewDrawer({ projectId, open, onClose, highlightActivityId }: ProjectQuickViewDrawerProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    try {
      const overviewRes = await apiFetch(`/api/projects/${pid}/overview`);
      if (overviewRes.ok) {
        setData(await overviewRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && projectId) {
      load(projectId);
    }
    if (!open) {
      setData(null);
    }
  }, [open, projectId, load]);

  return (
    <Drawer open={open} onClose={onClose} title="项目概览">
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : data ? (
        <div className="space-y-5 p-5">
          {/* header */}
          <div>
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-lg font-bold text-white"
                style={{ backgroundColor: data.project.color }}
              >
                {data.project.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold text-foreground">
                  {data.project.name}
                </h3>
                <div className="mt-0.5 flex items-center gap-2">
                  {(() => {
                    const s = STATUS_MAP[data.project.status] ?? STATUS_MAP.active;
                    return (
                      <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-medium", s.cls)}>
                        {s.label}
                      </span>
                    );
                  })()}
                  <span className="text-xs text-muted">
                    更新于 {new Date(data.project.updatedAt).toLocaleDateString("zh-CN", { timeZone: "America/Toronto" })}
                  </span>
                </div>
              </div>
            </div>
            {data.project.description && (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {data.project.description}
              </p>
            )}
          </div>

          {/* progress section */}
          {data.progress && (
            <div className="rounded-lg border border-border bg-[rgba(43,96,85,0.02)] px-3.5 py-3">
              <ProgressComparison
                taskProgress={data.progress.taskProgress}
                timeProgress={data.progress.timeProgress}
                completedTasks={data.progress.completedTasks}
                totalTasks={data.progress.totalTasks}
                daysRemaining={data.progress.daysRemaining}
                daysTotal={data.progress.daysTotal}
                isOverdue={data.progress.isOverdue}
                riskLabel={data.progress.riskLabel}
                compact
              />
              {data.progress.stages.length > 0 && (
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="text-[10px] text-muted">阶段</span>
                  <StageIndicator stages={data.progress.stages} compact />
                </div>
              )}
            </div>
          )}

          {/* stats grid */}
          <div className="grid grid-cols-2 gap-2">
            {STAT_ITEMS.map((s) => {
              const count = data.counts[s.key] ?? 0;
              return (
                <div
                  key={s.key}
                  className="flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-[rgba(26,36,32,0.02)] px-2 py-2.5"
                >
                  <s.icon size={14} className="text-accent/50" />
                  <span className="text-base font-semibold text-foreground">{count}</span>
                  <span className="text-[11px] text-muted">{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* recent activity */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted">
                最近动态
              </h4>
              <Link
                href={`/projects/${data.project.id}`}
                onClick={onClose}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                查看全部 <ArrowRight size={12} />
              </Link>
            </div>
            <ActivityTimeline activities={data.recentActivity} compact highlightId={highlightActivityId} />
          </div>

          {/* full page link */}
          <Link
            href={`/projects/${data.project.id}`}
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border bg-[rgba(43,96,85,0.03)] px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-[rgba(43,96,85,0.08)]"
          >
            进入完整项目页 <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-center py-20 text-sm text-muted">
          选择一个项目查看详情
        </div>
      )}
    </Drawer>
  );
}
