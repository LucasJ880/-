"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info, ShieldCheck } from "lucide-react";
import type { RiskItem } from "@/lib/project-dashboard/types";

interface RiskPanelProps {
  risks: RiskItem[];
}

const LEVEL_CONFIG = {
  high: {
    icon: AlertTriangle,
    badge: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]",
    border: "border-[rgba(166,61,61,0.15)]",
    label: "高风险",
  },
  medium: {
    icon: AlertCircle,
    badge: "bg-[rgba(176,106,40,0.08)] text-[#b06a28]",
    border: "border-[rgba(176,106,40,0.15)]",
    label: "中风险",
  },
  low: {
    icon: Info,
    badge: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
    border: "border-[rgba(110,125,118,0.15)]",
    label: "关注",
  },
} as const;

export function RiskPanel({ risks }: RiskPanelProps) {
  if (risks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck size={16} className="text-[#2e7a56]" />
          风险提示
        </div>
        <div className="mt-4 flex flex-col items-center gap-2 py-6 text-center">
          <ShieldCheck size={32} className="text-[#2e7a56]/40" />
          <p className="text-sm text-muted">当前无明显风险，项目运行健康</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle size={16} className="text-[#b06a28]" />
          风险提示
        </div>
        <span className="rounded-full bg-[rgba(176,106,40,0.08)] px-2 py-0.5 text-xs font-medium text-[#b06a28]">
          {risks.length} 项
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {risks.map((risk) => {
          const cfg = LEVEL_CONFIG[risk.level];
          const Icon = cfg.icon;
          return (
            <div
              key={risk.id}
              className={cn(
                "rounded-lg border px-3.5 py-3 transition-colors",
                cfg.border,
                "bg-[rgba(255,255,255,0.3)]"
              )}
            >
              <div className="flex items-start gap-2.5">
                <Icon size={15} className={cn("mt-0.5 shrink-0", cfg.badge.split(" ")[1])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{risk.title}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cfg.badge)}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {risk.description}
                  </p>
                  {risk.metric && (
                    <span className="mt-1.5 inline-block text-xs font-medium text-foreground/70">
                      {risk.metric}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
