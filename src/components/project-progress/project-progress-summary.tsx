"use client";

import { useState } from "react";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Lightbulb,
  Activity,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface ProgressSummary {
  overallStatus: "green" | "yellow" | "red";
  statusLabel: string;
  summary: string;
  keyProgress: string[];
  risks: string[];
  nextSteps: string[];
  weekHighlight: string;
  generatedAt: string;
}

const STATUS_CONFIG = {
  green: {
    icon: CheckCircle2,
    label: "正常",
    bg: "bg-[rgba(46,122,86,0.06)]",
    border: "border-[rgba(46,122,86,0.15)]",
    text: "text-[#2e7a56]",
    dot: "bg-[#2e7a56]",
  },
  yellow: {
    icon: AlertTriangle,
    label: "需关注",
    bg: "bg-[rgba(154,106,47,0.06)]",
    border: "border-[rgba(154,106,47,0.15)]",
    text: "text-[#9a6a2f]",
    dot: "bg-[#9a6a2f]",
  },
  red: {
    icon: AlertTriangle,
    label: "风险",
    bg: "bg-[rgba(166,61,61,0.06)]",
    border: "border-[rgba(166,61,61,0.15)]",
    text: "text-[#a63d3d]",
    dot: "bg-[#a63d3d]",
  },
} as const;

export function ProjectProgressSummary({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/progress-summary`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "生成失败");
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const statusCfg = data ? STATUS_CONFIG[data.overallStatus] || STATUS_CONFIG.yellow : null;
  const StatusIcon = statusCfg?.icon || Activity;

  return (
    <div className="rounded-xl border border-border bg-card-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-accent" />
          <h3 className="text-sm font-semibold">AI 项目进展摘要</h3>
          {data && statusCfg && (
            <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", statusCfg.bg, statusCfg.border, statusCfg.text)}>
              <StatusIcon size={11} />
              {data.statusLabel}
            </span>
          )}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : data ? (
            <RefreshCw size={13} />
          ) : (
            <TrendingUp size={13} />
          )}
          {loading ? "生成中..." : data ? "重新生成" : "生成摘要"}
        </button>
      </div>

      {/* Content */}
      {loading && !data && (
        <div className="flex items-center justify-center gap-2 px-5 py-12 text-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">正在分析项目数据，生成进展摘要...</span>
        </div>
      )}

      {error && (
        <div className="px-5 py-4 text-sm text-[#a63d3d]">{error}</div>
      )}

      {!data && !loading && !error && (
        <div className="px-5 py-8 text-center text-sm text-muted">
          点击「生成摘要」，AI 将分析项目任务、讨论、询价等数据，生成结构化进展报告
        </div>
      )}

      {data && (
        <div className="space-y-0 divide-y divide-border">
          {/* Summary */}
          <div className="px-5 py-4">
            <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>
          </div>

          {/* Week Highlight */}
          {data.weekHighlight && (
            <div className="flex items-start gap-2.5 px-5 py-3.5 bg-[rgba(43,96,85,0.02)]">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <span className="text-[11px] font-semibold text-accent">本周聚焦</span>
                <p className="text-xs leading-relaxed text-foreground">{data.weekHighlight}</p>
              </div>
            </div>
          )}

          {/* Key Progress */}
          {data.keyProgress.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#2e7a56]">
                <CheckCircle2 size={12} />
                关键进展
              </h4>
              <ul className="space-y-1.5">
                {data.keyProgress.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2e7a56]/40" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {data.risks.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#9a6a2f]">
                <AlertTriangle size={12} />
                风险与关注项
              </h4>
              <ul className="space-y-1.5">
                {data.risks.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9a6a2f]/40" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next Steps */}
          {data.nextSteps.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
                <ArrowRight size={12} />
                建议下一步
              </h4>
              <ul className="space-y-1.5">
                {data.nextSteps.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                    <span className="mt-0.5 shrink-0 text-accent/60">{i + 1}.</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-1.5 px-5 py-2.5 text-[11px] text-muted">
            <Clock size={10} />
            生成于 {new Date(data.generatedAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
          </div>
        </div>
      )}
    </div>
  );
}
