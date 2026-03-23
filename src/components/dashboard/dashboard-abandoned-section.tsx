"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, ChevronRight, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTimeToronto } from "@/lib/time";

interface AbandonedProject {
  id: string;
  name: string;
  color: string;
  abandonedAt: string;
  abandonedStage: string | null;
  abandonedStageLabel: string | null;
  abandonedReason: string | null;
  sourceSystem: string | null;
  clientOrganization: string | null;
  estimatedValue: number | null;
  currency: string | null;
  org: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
}

interface StageStat {
  stage: string;
  label: string;
  count: number;
}

interface AbandonedStats {
  days: number;
  total: number;
  stageStats: StageStat[];
  projects: AbandonedProject[];
}

const DAY_OPTIONS = [30, 60, 90] as const;

export function DashboardAbandonedSection({
  onProjectClick,
}: {
  onProjectClick?: (projectId: string) => void;
}) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AbandonedStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((d: number) => {
    setLoading(true);
    apiFetch(`/api/stats/abandoned?days=${d}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  if (loading && !data) return null;
  if (!data || data.total === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Ban size={15} className="text-[#a63d3d]" />
        <h2 className="font-semibold text-foreground">放弃项目统计</h2>
        <span className="ml-1 rounded-full bg-[rgba(166,61,61,0.08)] px-2 py-0.5 text-xs font-medium text-[#a63d3d]">
          {data.total}
        </span>

        {/* Day selector */}
        <div className="ml-auto flex items-center gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                days === d
                  ? "bg-[#a63d3d] text-white"
                  : "text-[#6e7d76] hover:bg-[rgba(26,36,32,0.04)]"
              )}
            >
              {d}天
            </button>
          ))}
        </div>
      </div>

      {/* Stage breakdown */}
      {data.stageStats.length > 0 && (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          {data.stageStats.map((s) => (
            <div key={s.stage} className="bg-card-bg px-4 py-3 text-center">
              <p className="text-xl font-bold text-[#a63d3d]">{s.count}</p>
              <p className="mt-0.5 text-[11px] text-muted">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Project list */}
      <div className="divide-y divide-border border-t border-border">
        {data.projects.slice(0, 8).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onProjectClick?.(p.id)}
            className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[rgba(166,61,61,0.02)]"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {p.name}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                <span className="text-[#a63d3d] font-medium">
                  {p.abandonedStageLabel ?? p.abandonedStage}
                </span>
                <span>·</span>
                <span>{formatDateTimeToronto(p.abandonedAt)}</span>
                {p.clientOrganization && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Building2 size={10} />
                      {p.clientOrganization}
                    </span>
                  </>
                )}
                {p.abandonedReason && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-[200px]">{p.abandonedReason}</span>
                  </>
                )}
              </div>
            </div>
            <ChevronRight size={14} className="shrink-0 text-muted/40" />
          </button>
        ))}
      </div>

      {data.total > 8 && (
        <div className="border-t border-border px-5 py-2 text-center">
          <span className="text-xs text-muted">还有 {data.total - 8} 个放弃项目</span>
        </div>
      )}
    </div>
  );
}
