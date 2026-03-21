"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MessageSquare,
  TrendingDown,
  Star,
  UserCheck,
  AlertTriangle,
  XCircle,
  MessageSquareWarning,
  Bell,
  Loader2,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { ProjectDashboardData } from "@/lib/project-dashboard/types";

import { MetricCard } from "./metric-card";
import { MiniTrendChart } from "./mini-trend-chart";
import { RiskPanel } from "./risk-panel";
import { QualityPanel } from "./quality-panel";
import { RuntimePanel } from "./runtime-panel";
import { AssetSummary } from "./asset-summary";

interface ProjectDashboardProps {
  projectId: string;
}

type RangeKey = "7d" | "30d";

export function ProjectDashboard({ projectId }: ProjectDashboardProps) {
  const [data, setData] = useState<ProjectDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("7d");

  const load = useCallback(
    async (r: RangeKey) => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/projects/${projectId}/dashboard?range=${r}`);
        if (res.ok) {
          setData(await res.json());
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    load(range);
  }, [load, range]);

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <p className="py-8 text-center text-sm text-muted">仪表盘数据加载失败</p>
      </div>
    );
  }

  const { overview, trends, risks, quality, runtime, assets } = data;

  return (
    <div className="space-y-4">
      {/* header + range selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <LayoutDashboard size={16} className="text-accent/60" />
          项目仪表盘
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
          {(["7d", "30d"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                range === r
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              )}
            >
              {r === "7d" ? "近 7 天" : "近 30 天"}
            </button>
          ))}
        </div>
      </div>

      {/* metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="会话总数"
          value={overview.totalConversations.current}
          delta={overview.totalConversations.delta}
          deltaPercent={overview.totalConversations.deltaPercent}
          icon={MessageSquare}
        />
        <MetricCard
          label={`近 ${data.range.days} 天会话`}
          value={overview.recentConversations.current}
          delta={overview.recentConversations.delta}
          deltaPercent={overview.recentConversations.deltaPercent}
          icon={MessageSquare}
        />
        <MetricCard
          label="自动评估均分"
          value={overview.avgAutoScore.current || "—"}
          delta={overview.avgAutoScore.delta}
          deltaPercent={overview.avgAutoScore.deltaPercent}
          icon={Star}
          suffix="/ 5"
          warn={overview.avgAutoScore.current > 0 && overview.avgAutoScore.current < 3}
        />
        <MetricCard
          label="人工反馈均分"
          value={overview.avgHumanScore.current || "—"}
          delta={overview.avgHumanScore.delta}
          deltaPercent={overview.avgHumanScore.deltaPercent}
          icon={UserCheck}
          suffix="/ 5"
          warn={overview.avgHumanScore.current > 0 && overview.avgHumanScore.current < 3}
        />
        <MetricCard
          label="低分评估"
          value={overview.lowScoreCount.current}
          delta={overview.lowScoreCount.delta}
          deltaPercent={overview.lowScoreCount.deltaPercent}
          icon={TrendingDown}
          warn={overview.lowScoreCount.current > 0}
        />
        <MetricCard
          label="Runtime 失败"
          value={overview.runtimeFailures.current}
          delta={overview.runtimeFailures.delta}
          deltaPercent={overview.runtimeFailures.deltaPercent}
          icon={XCircle}
          warn={overview.runtimeFailures.current > 0}
        />
        <MetricCard
          label="未处理反馈"
          value={overview.openFeedbacks}
          icon={MessageSquareWarning}
          warn={overview.openFeedbacks > 5}
        />
        <MetricCard
          label="高优通知"
          value={overview.highPriorityNotifications}
          icon={Bell}
          warn={overview.highPriorityNotifications > 3}
        />
      </div>

      {/* trend charts */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniTrendChart
          data={trends.conversations}
          title="会话数量趋势"
          type="bar"
          color="var(--color-accent)"
          valueLabel="次"
        />
        <MiniTrendChart
          data={trends.evaluationScores}
          title="评估平均分趋势"
          color="#2e7a56"
          valueLabel="分"
        />
        <MiniTrendChart
          data={trends.feedbacks}
          title="反馈量趋势"
          type="bar"
          color="#9a6a2f"
          valueLabel="条"
        />
        <MiniTrendChart
          data={trends.runtimeFailures}
          title="Runtime 失败趋势"
          type="bar"
          color="#a63d3d"
          valueLabel="次"
        />
      </div>

      {/* risk + quality + runtime */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RiskPanel risks={risks} />
        <QualityPanel quality={quality} projectId={projectId} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RuntimePanel runtime={runtime} projectId={projectId} />
        <AssetSummary assets={assets} projectId={projectId} />
      </div>
    </div>
  );
}
