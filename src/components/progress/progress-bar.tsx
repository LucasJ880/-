"use client";

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  color?: "default" | "success" | "warning" | "danger";
  showLabel?: boolean;
  label?: string;
  className?: string;
}

const SIZE_MAP = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-3.5",
};

const COLOR_MAP = {
  default: "bg-accent",
  success: "bg-[#2e7a56]",
  warning: "bg-[#b06a28]",
  danger: "bg-[#a63d3d]",
};

export function getProgressColor(value: number, riskLevel?: string): ProgressBarProps["color"] {
  if (riskLevel === "high") return "danger";
  if (riskLevel === "medium") return "warning";
  if (value >= 80) return "success";
  if (value >= 50) return "default";
  return "default";
}

export function ProgressBar({
  value,
  max = 100,
  size = "md",
  color = "default",
  showLabel = false,
  label,
  className,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;

  return (
    <div className={cn("w-full", className)}>
      {(showLabel || label) && (
        <div className="mb-1 flex items-center justify-between text-xs">
          {label && <span className="text-muted">{label}</span>}
          {showLabel && (
            <span className="font-medium text-foreground">{pct}%</span>
          )}
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-[rgba(110,125,118,0.08)]",
          SIZE_MAP[size]
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            COLOR_MAP[color]
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
