"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, ShieldCheck, AlertCircle } from "lucide-react";

interface RiskBadgeProps {
  level: "none" | "low" | "medium" | "high";
  label?: string | null;
  isOverdue?: boolean;
  compact?: boolean;
}

const CONFIG = {
  none: {
    icon: ShieldCheck,
    text: "正常",
    cls: "bg-[rgba(46,122,86,0.06)] text-[#2e7a56] border-[rgba(46,122,86,0.15)]",
  },
  low: {
    icon: Clock,
    text: "关注",
    cls: "bg-[rgba(154,106,47,0.06)] text-[#9a6a2f] border-[rgba(154,106,47,0.15)]",
  },
  medium: {
    icon: AlertCircle,
    text: "风险",
    cls: "bg-[rgba(176,106,40,0.06)] text-[#b06a28] border-[rgba(176,106,40,0.15)]",
  },
  high: {
    icon: AlertTriangle,
    text: "延期",
    cls: "bg-[rgba(166,61,61,0.06)] text-[#a63d3d] border-[rgba(166,61,61,0.15)]",
  },
} as const;

export function RiskBadge({ level, label, isOverdue, compact = false }: RiskBadgeProps) {
  const effectiveLevel = isOverdue ? "high" : level;
  const cfg = CONFIG[effectiveLevel];
  const Icon = cfg.icon;
  const displayText = isOverdue ? "已逾期" : label ?? cfg.text;

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
          cfg.cls
        )}
        title={displayText}
      >
        <Icon size={10} />
        {cfg.text}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        cfg.cls
      )}
    >
      <Icon size={12} />
      {displayText}
    </span>
  );
}
