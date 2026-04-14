"use client";

import {
  TrendingUp,
  DollarSign,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Opportunity, Customer, ViewMode } from "./types";

export function StatsCards({
  opportunities,
  customers,
  viewMode,
}: {
  opportunities: Opportunity[];
  customers: Customer[];
  viewMode: ViewMode;
}) {
  const activeOpps = opportunities.filter(
    (o) => !["signed", "completed", "lost", "on_hold"].includes(o.stage)
  );
  const totalPipeline = activeOpps.reduce(
    (sum, o) => sum + (o.estimatedValue || 0),
    0
  );
  const signedOpps = opportunities.filter((o) => ["signed", "producing", "installing", "completed"].includes(o.stage));
  const signedTotal = signedOpps.reduce((sum, o) => sum + (o.estimatedValue || 0), 0);

  const stats = [
    {
      label: "进行中",
      value: activeOpps.length,
      icon: TrendingUp,
      color: "text-blue-600",
    },
    {
      label: "Pipeline 金额",
      value: `$${(totalPipeline / 1000).toFixed(1)}k`,
      icon: DollarSign,
      color: "text-emerald-600",
    },
    {
      label: "已签单",
      value: signedOpps.length,
      sub: signedTotal > 0 ? `$${(signedTotal / 1000).toFixed(1)}k` : undefined,
      icon: TrendingUp,
      color: "text-purple-600",
    },
    {
      label: "客户总数",
      value: viewMode === "customers" ? customers.length : "–",
      icon: Users,
      color: "text-amber-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-border bg-white/70 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <s.icon className={cn("h-4 w-4", s.color)} />
            <span className="text-xs text-muted">{s.label}</span>
          </div>
          <div className="mt-1 text-xl font-semibold text-foreground">
            {s.value}
          </div>
          {s.sub && <div className="text-xs text-muted">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}
