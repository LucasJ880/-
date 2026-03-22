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

export function ProjectStageStepper({ stages }: { stages: StageInfo[] }) {
  return (
    <div className="flex items-start justify-between">
      {stages.map((stage, i) => {
        const style = STATUS_STYLES[stage.status] || STATUS_STYLES.pending;
        const isLast = i === stages.length - 1;

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
                  "mt-2 max-w-[80px] text-center text-[11px] leading-tight",
                  style.text
                )}
              >
                {stage.label}
              </span>
            </div>
            {!isLast && (
              <div className="mt-4 flex-1 px-1">
                <div
                  className={cn(
                    "h-0.5 w-full rounded-full transition-all",
                    i < stages.findIndex((s) => s.status === "current" || s.status === "overdue")
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
  );
}
