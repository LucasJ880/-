"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, CheckCircle } from "lucide-react";

interface ProgressComparisonProps {
  taskProgress: number;
  timeProgress: number;
  completedTasks: number;
  totalTasks: number;
  daysRemaining: number;
  daysTotal: number;
  isOverdue: boolean;
  riskLabel: string | null;
  compact?: boolean;
}

export function ProgressComparison({
  taskProgress,
  timeProgress,
  completedTasks,
  totalTasks,
  daysRemaining,
  daysTotal,
  isOverdue,
  riskLabel,
  compact = false,
}: ProgressComparisonProps) {
  const gap = timeProgress - taskProgress;
  const isBehind = gap >= 15 && timeProgress > 0;

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {/* task progress */}
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted">
            <CheckCircle size={11} />
            完成进度
          </span>
          <span className="font-medium text-foreground">
            {taskProgress}%
            {totalTasks > 0 && (
              <span className="ml-1 font-normal text-muted">
                ({completedTasks}/{totalTasks})
              </span>
            )}
          </span>
        </div>
        <div className={cn("mt-1 w-full overflow-hidden rounded-full bg-[rgba(110,125,118,0.08)]", compact ? "h-1.5" : "h-2.5")}>
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out",
              isOverdue
                ? "bg-[#a63d3d]"
                : taskProgress >= 80
                  ? "bg-[#2e7a56]"
                  : "bg-accent"
            )}
            style={{ width: `${Math.min(taskProgress, 100)}%` }}
          />
        </div>
      </div>

      {/* time progress */}
      {(daysTotal > 0 || isOverdue) && (
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted">
              <Clock size={11} />
              时间进度
            </span>
            <span className={cn("font-medium", isOverdue ? "text-[#a63d3d]" : "text-foreground")}>
              {isOverdue ? "已逾期" : `${timeProgress}%`}
              {daysTotal > 0 && !isOverdue && (
                <span className="ml-1 font-normal text-muted">
                  (剩余 {daysRemaining} 天)
                </span>
              )}
            </span>
          </div>
          <div className={cn("mt-1 w-full overflow-hidden rounded-full bg-[rgba(110,125,118,0.08)]", compact ? "h-1.5" : "h-2.5")}>
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                isOverdue
                  ? "bg-[#a63d3d]"
                  : timeProgress >= 80
                    ? "bg-[#b06a28]"
                    : "bg-[rgba(43,96,85,0.4)]"
              )}
              style={{ width: `${Math.min(timeProgress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* risk hint */}
      {riskLabel && (
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
            isOverdue
              ? "bg-[rgba(166,61,61,0.06)] text-[#a63d3d]"
              : isBehind
                ? "bg-[rgba(176,106,40,0.06)] text-[#b06a28]"
                : "bg-[rgba(110,125,118,0.06)] text-[#6e7d76]"
          )}
        >
          <AlertTriangle size={12} />
          {riskLabel}
        </div>
      )}
    </div>
  );
}
