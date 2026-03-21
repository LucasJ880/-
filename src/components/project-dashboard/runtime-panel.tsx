"use client";

import { cn } from "@/lib/utils";
import { Cpu, CheckCircle, XCircle, Clock, Wrench, AlertTriangle } from "lucide-react";
import type { DashboardRuntime } from "@/lib/project-dashboard/types";

interface RuntimePanelProps {
  runtime: DashboardRuntime;
  projectId: string;
}

export function RuntimePanel({ runtime, projectId }: RuntimePanelProps) {
  const rateColor =
    runtime.successRate >= 95
      ? "text-[#2e7a56]"
      : runtime.successRate >= 80
        ? "text-[#b06a28]"
        : "text-[#a63d3d]";

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Cpu size={16} className="text-accent/60" />
        Runtime 健康
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox icon={Cpu} label="总运行" value={runtime.totalRuns} />
        <StatBox icon={CheckCircle} label="成功" value={runtime.successCount} color="text-[#2e7a56]" />
        <StatBox icon={XCircle} label="失败" value={runtime.failureCount} color="text-[#a63d3d]" />
        <StatBox icon={Wrench} label="Tool 调用" value={runtime.toolCallCount} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border px-3 py-2.5">
          <span className="text-xs text-muted">成功率</span>
          <div className={cn("mt-1 text-lg font-bold", rateColor)}>
            {runtime.successRate}%
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(43,96,85,0.06)]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                runtime.successRate >= 95
                  ? "bg-[#2e7a56]"
                  : runtime.successRate >= 80
                    ? "bg-[#b06a28]"
                    : "bg-[#a63d3d]"
              )}
              style={{ width: `${runtime.successRate}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg border border-border px-3 py-2.5">
          <span className="text-xs text-muted">平均延迟</span>
          <div className="mt-1 flex items-baseline gap-1">
            <Clock size={14} className="text-muted/60" />
            <span className="text-lg font-bold text-foreground">
              {runtime.avgLatencyMs != null ? runtime.avgLatencyMs : "—"}
            </span>
            <span className="text-xs text-muted">ms</span>
          </div>
        </div>
      </div>

      {runtime.recentFailures.length > 0 && (
        <div className="mt-4">
          <h5 className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <AlertTriangle size={12} className="text-[#a63d3d]" />
            近期失败
          </h5>
          <div className="mt-2 space-y-1">
            {runtime.recentFailures.map((f) => (
              <a
                key={f.id}
                href={`/projects/${projectId}/conversations/${f.id}`}
                className="block rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[rgba(43,96,85,0.04)]"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-medium text-foreground">{f.title}</span>
                  <span className="shrink-0 text-muted">
                    {new Date(f.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                </div>
                {f.error && (
                  <p className="mt-0.5 truncate text-muted">{f.error}</p>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Cpu;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-2 py-2.5">
      <Icon size={14} className={cn("text-muted/60", color)} />
      <span className={cn("text-base font-semibold", color ?? "text-foreground")}>{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}
