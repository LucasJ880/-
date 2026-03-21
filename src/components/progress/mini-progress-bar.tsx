"use client";

import { cn } from "@/lib/utils";

interface MiniProgressBarProps {
  value: number;
  isOverdue?: boolean;
  isAtRisk?: boolean;
  showPercent?: boolean;
  className?: string;
}

export function MiniProgressBar({
  value,
  isOverdue,
  isAtRisk,
  showPercent = true,
  className,
}: MiniProgressBarProps) {
  const pct = Math.min(Math.max(value, 0), 100);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(110,125,118,0.08)]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            isOverdue
              ? "bg-[#a63d3d]"
              : isAtRisk
                ? "bg-[#b06a28]"
                : pct >= 80
                  ? "bg-[#2e7a56]"
                  : "bg-accent"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showPercent && (
        <span
          className={cn(
            "shrink-0 text-[11px] font-medium tabular-nums",
            isOverdue
              ? "text-[#a63d3d]"
              : isAtRisk
                ? "text-[#b06a28]"
                : "text-muted"
          )}
        >
          {pct}%
        </span>
      )}
    </div>
  );
}
