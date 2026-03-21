"use client";

import { cn } from "@/lib/utils";
import { BrainCircuit, UserCheck, AlertCircle, MessageSquareWarning } from "lucide-react";
import type { DashboardQuality } from "@/lib/project-dashboard/types";

interface QualityPanelProps {
  quality: DashboardQuality;
  projectId: string;
}

const ISSUE_LABELS: Record<string, string> = {
  accuracy: "准确性",
  hallucination: "幻觉",
  safety: "安全性",
  completeness: "完整性",
  relevance: "相关性",
  format: "格式问题",
  other: "其他",
};

export function QualityPanel({ quality, projectId }: QualityPanelProps) {
  const maxIssue = quality.issueDistribution.length > 0
    ? Math.max(...quality.issueDistribution.map((d) => d.count))
    : 0;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BrainCircuit size={16} className="text-accent/60" />
        质量健康
      </div>

      {/* score comparison */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <BrainCircuit size={12} />
            自动评估
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-xl font-bold text-foreground">
              {quality.avgAutoScore != null ? quality.avgAutoScore : "—"}
            </span>
            <span className="text-xs text-muted">/ 5</span>
          </div>
          <span className="text-[11px] text-muted">{quality.totalAutoEvaluations} 次评估</span>
        </div>
        <div className="rounded-lg border border-border px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <UserCheck size={12} />
            人工反馈
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-xl font-bold text-foreground">
              {quality.avgHumanRating != null ? quality.avgHumanRating : "—"}
            </span>
            <span className="text-xs text-muted">/ 5</span>
          </div>
          <span className="text-[11px] text-muted">{quality.totalHumanFeedbacks} 条反馈</span>
        </div>
      </div>

      {/* issue distribution */}
      {quality.issueDistribution.length > 0 && (
        <div className="mt-4">
          <h5 className="text-xs font-medium text-muted">问题分布</h5>
          <div className="mt-2 space-y-1.5">
            {quality.issueDistribution
              .sort((a, b) => b.count - a.count)
              .slice(0, 5)
              .map((d) => (
                <div key={d.type} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 truncate text-xs text-foreground">
                    {ISSUE_LABELS[d.type] ?? d.type}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(43,96,85,0.06)]">
                    <div
                      className="h-full rounded-full bg-accent/50 transition-all"
                      style={{ width: `${maxIssue > 0 ? (d.count / maxIssue) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs font-medium text-muted">{d.count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* recent low scores */}
      {quality.recentLowScores.length > 0 && (
        <div className="mt-4">
          <h5 className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <AlertCircle size={12} className="text-[#b06a28]" />
            近期低分评估
          </h5>
          <div className="mt-2 space-y-1">
            {quality.recentLowScores.map((s) => (
              <a
                key={s.id}
                href={s.conversationId ? `/projects/${projectId}/conversations/${s.conversationId}` : "#"}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[rgba(43,96,85,0.04)]"
              >
                <span className="text-muted">
                  {new Date(s.createdAt).toLocaleDateString("zh-CN")}
                </span>
                <span className={cn(
                  "rounded px-1.5 py-0.5 font-medium",
                  s.score <= 2 ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" : "bg-[rgba(176,106,40,0.08)] text-[#b06a28]"
                )}>
                  {s.score} 分
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* recent negative feedbacks */}
      {quality.recentNegativeFeedbacks.length > 0 && (
        <div className="mt-4">
          <h5 className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <MessageSquareWarning size={12} className="text-[#a63d3d]" />
            近期负面反馈
          </h5>
          <div className="mt-2 space-y-1">
            {quality.recentNegativeFeedbacks.map((f) => (
              <a
                key={f.id}
                href={`/projects/${projectId}/conversations/${f.conversationId}`}
                className="block rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[rgba(43,96,85,0.04)]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-muted">
                    {new Date(f.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <span className="rounded bg-[rgba(166,61,61,0.08)] px-1.5 py-0.5 font-medium text-[#a63d3d]">
                    {f.rating} 分
                  </span>
                </div>
                {f.note && (
                  <p className="mt-0.5 truncate text-muted">{f.note}</p>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
