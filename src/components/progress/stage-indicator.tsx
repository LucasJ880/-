"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { StageItem } from "@/lib/progress/types";

interface StageIndicatorProps {
  stages: StageItem[];
  compact?: boolean;
}

export function StageIndicator({ stages, compact = false }: StageIndicatorProps) {
  return (
    <div className="flex items-center gap-0">
      {stages.map((stage, i) => (
        <div key={stage.key} className="flex items-center">
          {i > 0 && (
            <div
              className={cn(
                "h-px transition-colors",
                compact ? "w-3" : "w-5",
                stage.status === "done" || stages[i - 1]?.status === "done"
                  ? "bg-[#2e7a56]"
                  : stage.status === "current"
                    ? "bg-accent/40"
                    : "bg-[rgba(110,125,118,0.15)]"
              )}
            />
          )}
          <div
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
              compact && "px-1.5",
              stage.status === "done" &&
                "border-[rgba(46,122,86,0.2)] bg-[rgba(46,122,86,0.06)] text-[#2e7a56]",
              stage.status === "current" &&
                "border-accent/30 bg-[rgba(43,96,85,0.08)] text-accent",
              stage.status === "pending" &&
                "border-[rgba(110,125,118,0.12)] bg-[rgba(110,125,118,0.03)] text-[#8a9590]"
            )}
            title={stage.label}
          >
            {stage.status === "done" && <Check size={9} strokeWidth={3} />}
            {!compact && stage.label}
            {compact && stage.label.slice(0, 1)}
          </div>
        </div>
      ))}
    </div>
  );
}
