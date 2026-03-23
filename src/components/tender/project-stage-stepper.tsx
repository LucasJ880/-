"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StageInfo } from "@/lib/tender/types";

const STATUS_STYLES: Record<string, { dot: string; line: string; text: string }> = {
  completed: {
    dot: "bg-success text-white",
    line: "bg-success",
    text: "text-success-text",
  },
  current: {
    dot: "bg-accent text-white ring-4 ring-accent/20",
    line: "bg-border",
    text: "text-accent font-semibold",
  },
  overdue: {
    dot: "bg-danger text-white ring-4 ring-danger/20",
    line: "bg-danger/30",
    text: "text-danger-text font-semibold",
  },
  pending: {
    dot: "bg-border text-muted",
    line: "bg-border",
    text: "text-muted",
  },
};

export function ProjectStageStepper({
  stages,
  completion,
}: {
  stages: StageInfo[];
  completion: number;
}) {
  const currentIdx = stages.findIndex(
    (s) => s.status === "current" || s.status === "overdue"
  );

  return (
    <div className="space-y-4">
      {/* Overall progress bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted shrink-0">完成进度</span>
        <div className="flex-1 h-2.5 rounded-full bg-[rgba(26,36,32,0.06)] overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              completion >= 100
                ? "bg-success"
                : completion > 0
                  ? "bg-accent"
                  : "bg-transparent"
            )}
            style={{ width: `${Math.min(completion, 100)}%` }}
          />
        </div>
        <span className="text-sm font-bold text-foreground shrink-0 min-w-[40px] text-right">
          {completion}%
        </span>
      </div>

      {/* Stage stepper */}
      <div className="flex items-start justify-between">
        {stages.map((stage, i) => {
          const style = STATUS_STYLES[stage.status] || STATUS_STYLES.pending;
          const isLast = i === stages.length - 1;
          const isBeforeCurrent = currentIdx >= 0 && i < currentIdx;

          return (
            <div key={stage.key} className="flex flex-1 items-start">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs transition-all",
                    style.dot,
                    stage.status === "current" && "animate-pulse"
                  )}
                >
                  {stage.status === "completed" ? (
                    <Check size={14} strokeWidth={3} />
                  ) : (
                    <span className="text-[11px] font-bold">{i + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "mt-1.5 max-w-[72px] text-center text-[11px] leading-tight",
                    style.text
                  )}
                >
                  {stage.label}
                </span>
                <span
                  className={cn(
                    "mt-0.5 text-[10px]",
                    stage.status === "completed"
                      ? "text-success-text"
                      : stage.status === "current"
                        ? "text-accent"
                        : "text-muted"
                  )}
                >
                  {stage.weight}%
                </span>
              </div>
              {!isLast && (
                <div className="mt-4 flex-1 px-1">
                  <div
                    className={cn(
                      "h-0.5 w-full rounded-full transition-all",
                      isBeforeCurrent || stage.status === "completed"
                        ? "bg-success"
                        : "bg-border"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
