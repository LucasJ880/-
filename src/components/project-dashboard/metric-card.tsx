"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: number;
  deltaPercent?: number;
  icon?: LucideIcon;
  warn?: boolean;
  suffix?: string;
}

export function MetricCard({
  label,
  value,
  delta,
  deltaPercent,
  icon: Icon,
  warn,
  suffix,
}: MetricCardProps) {
  const hasDelta = delta != null && deltaPercent != null;
  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 transition-colors",
        warn
          ? "border-[rgba(176,106,40,0.25)] bg-[rgba(176,106,40,0.03)]"
          : "border-border bg-card-bg hover:bg-[rgba(43,96,85,0.02)]"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        {Icon && <Icon size={14} className={cn("text-muted/60", warn && "text-[#b06a28]")} />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-2xl font-bold tracking-tight", warn ? "text-[#b06a28]" : "text-foreground")}>
          {value}
        </span>
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
      {hasDelta && (
        <div className="flex items-center gap-1 text-xs">
          {isUp ? (
            <TrendingUp size={12} className="text-[#2e7a56]" />
          ) : isDown ? (
            <TrendingDown size={12} className="text-[#a63d3d]" />
          ) : (
            <Minus size={12} className="text-muted" />
          )}
          <span
            className={cn(
              isUp && "text-[#2e7a56]",
              isDown && "text-[#a63d3d]",
              !isUp && !isDown && "text-muted"
            )}
          >
            {isUp ? "+" : ""}
            {deltaPercent}% vs 上周期
          </span>
        </div>
      )}
    </div>
  );
}
