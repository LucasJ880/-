"use client";

import { FolderKanban, ArrowRight, Clock, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MiniProgressBar } from "@/components/progress/mini-progress-bar";
import { RiskBadge } from "@/components/progress/risk-badge";
import { StageIndicator } from "@/components/progress/stage-indicator";
import type { ProjectBreakdown, ProjectProgressData } from "./types";

interface Props {
  projectBreakdown: ProjectBreakdown[];
  projectProgress: Record<string, ProjectProgressData>;
  onProjectClick?: (projectId: string) => void;
}

export function DashboardProjectsSection({ projectBreakdown, projectProgress, onProjectClick }: Props) {
  if (projectBreakdown.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <FolderKanban size={15} className="text-[#805078]" />
          <h2 className="font-semibold">项目概览</h2>
        </div>
        <Link
          href="/projects"
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
        >
          全部项目 <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
        {projectBreakdown.map((p) => {
          const prog = projectProgress[p.id];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onProjectClick?.(p.id)}
              className={cn(
                "space-y-2.5 bg-card-bg px-5 py-4 text-left transition-colors",
                onProjectClick && "cursor-pointer hover:bg-[rgba(43,96,85,0.03)] active:bg-[rgba(43,96,85,0.06)]"
              )}
            >
              {/* title row */}
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                {prog && prog.isAtRisk && (
                  <RiskBadge
                    level={prog.riskLevel}
                    isOverdue={prog.isOverdue}
                    compact
                  />
                )}
              </div>

              {/* progress bar */}
              {prog ? (
                <MiniProgressBar
                  value={prog.taskProgress}
                  isOverdue={prog.isOverdue}
                  isAtRisk={prog.isAtRisk}
                />
              ) : (
                <MiniProgressBar
                  value={p.total > 0 ? Math.round((p.done / p.total) * 100) : 0}
                />
              )}

              {/* stats row */}
              <div className="flex items-center gap-3 text-[11px] text-muted">
                <span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2e7a56]" />{" "}
                  已完成 {p.done}
                </span>
                <span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2b6055]" />{" "}
                  进行中 {p.inProgress}
                </span>
                <span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[rgba(110,125,118,0.15)]" />{" "}
                  待办 {p.todo}
                </span>
              </div>

              {/* time & stage row */}
              {prog && (
                <div className="flex items-center justify-between gap-2">
                  {prog.dueDate && (
                    <span
                      className={cn(
                        "flex items-center gap-1 text-[10px] font-medium",
                        prog.isOverdue
                          ? "text-[#a63d3d]"
                          : prog.daysRemaining <= 3 && prog.daysRemaining >= 0
                            ? "text-[#b06a28]"
                            : "text-muted"
                      )}
                    >
                      {prog.isOverdue ? (
                        <AlertTriangle size={10} />
                      ) : (
                        <Clock size={10} />
                      )}
                      {prog.isOverdue
                        ? "已逾期"
                        : `剩余 ${prog.daysRemaining} 天`}
                    </span>
                  )}
                  {prog.weekDelta > 0 && (
                    <span className="text-[10px] font-medium text-[#2e7a56]">
                      +{prog.weekDelta}% 本周
                    </span>
                  )}
                </div>
              )}

              {/* stage indicator */}
              {prog && prog.stages.length > 0 && (
                <StageIndicator stages={prog.stages} compact />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
