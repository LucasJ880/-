"use client";

import { useState } from "react";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Target,
  HelpCircle,
  Activity,
  Clock,
  MessageSquareQuote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface KeyProgress {
  item: string;
  significance: string;
}

interface Blocker {
  item: string;
  severity: "high" | "medium" | "low";
  impact: string;
}

interface NextAction {
  action: string;
  purpose: string;
  owner: string;
  deadline: string;
  priority: "high" | "medium" | "low";
}

interface ProgressSummary {
  overallStatus: "green" | "yellow" | "red";
  statusLabel: string;
  currentJudgment: string;
  keyProgress: KeyProgress[];
  blockers: Blocker[];
  stageAlignment: string;
  nextActions: NextAction[];
  pendingConfirmations: string[];
  executiveSummary: string;
  generatedAt: string;
  _meta?: Record<string, unknown>;
}

const STATUS_CONFIG = {
  green: {
    icon: CheckCircle2,
    label: "正常",
    bg: "bg-[rgba(46,122,86,0.06)]",
    border: "border-[rgba(46,122,86,0.15)]",
    text: "text-[#2e7a56]",
  },
  yellow: {
    icon: AlertTriangle,
    label: "需关注",
    bg: "bg-[rgba(154,106,47,0.06)]",
    border: "border-[rgba(154,106,47,0.15)]",
    text: "text-[#9a6a2f]",
  },
  red: {
    icon: AlertTriangle,
    label: "风险",
    bg: "bg-[rgba(166,61,61,0.06)]",
    border: "border-[rgba(166,61,61,0.15)]",
    text: "text-[#a63d3d]",
  },
} as const;

const SEVERITY_STYLE = {
  high: "text-[#a63d3d] bg-[rgba(166,61,61,0.06)]",
  medium: "text-[#9a6a2f] bg-[rgba(154,106,47,0.06)]",
  low: "text-muted bg-accent/5",
} as const;

const PRIORITY_STYLE = {
  high: "text-[#a63d3d]",
  medium: "text-[#9a6a2f]",
  low: "text-muted",
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
          {loading ? <Loader2 size={13} className="animate-spin" /> : data ? <RefreshCw size={13} /> : <TrendingUp size={13} />}
          {loading ? "生成中..." : data ? "重新生成" : "生成摘要"}
        </button>
      </div>

      {/* Loading */}
      {loading && !data && (
        <div className="flex items-center justify-center gap-2 px-5 py-12 text-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">正在分析项目数据，生成进展摘要...</span>
        </div>
      )}

      {error && <div className="px-5 py-4 text-sm text-[#a63d3d]">{error}</div>}

      {!data && !loading && !error && (
        <div className="px-5 py-8 text-center text-sm text-muted">
          点击「生成摘要」，AI 将分析项目任务、讨论、询价、文档等数据，生成结构化管理摘要
        </div>
      )}

      {data && (
        <div className="space-y-0 divide-y divide-border">
          {/* 1. Executive Summary */}
          {data.executiveSummary && (
            <div className="flex items-start gap-2.5 px-5 py-3.5 bg-accent/[0.02]">
              <MessageSquareQuote size={14} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <span className="text-[11px] font-semibold text-accent">管理层摘要</span>
                <p className="text-sm font-medium leading-relaxed text-foreground">{data.executiveSummary}</p>
              </div>
            </div>
          )}

          {/* 2. Current Judgment */}
          {data.currentJudgment && (
            <div className="px-5 py-4">
              <h4 className="mb-1.5 text-xs font-semibold text-foreground">项目当前判断</h4>
              <p className="text-sm leading-relaxed text-foreground/80">{data.currentJudgment}</p>
            </div>
          )}

          {/* 3. Key Progress */}
          {data.keyProgress.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#2e7a56]">
                <CheckCircle2 size={12} /> 关键进展
              </h4>
              <div className="space-y-2">
                {data.keyProgress.map((kp, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2e7a56]/40" />
                    <div className="text-xs leading-relaxed">
                      <span className="font-medium text-foreground">{kp.item}</span>
                      {kp.significance && (
                        <span className="text-muted"> — {kp.significance}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Blockers & Risks */}
          {data.blockers.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#9a6a2f]">
                <AlertTriangle size={12} /> 阻塞与风险
              </h4>
              <div className="space-y-2">
                {data.blockers.map((b, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0 text-[10px] font-medium", SEVERITY_STYLE[b.severity] || SEVERITY_STYLE.medium)}>
                      {b.severity === "high" ? "高" : b.severity === "medium" ? "中" : "低"}
                    </span>
                    <div className="text-xs leading-relaxed">
                      <span className="font-medium text-foreground">{b.item}</span>
                      {b.impact && <span className="text-muted"> — {b.impact}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. Stage Alignment */}
          {data.stageAlignment && (
            <div className="px-5 py-4">
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-accent">
                <Target size={12} /> 阶段目标对齐
              </h4>
              <p className="text-xs leading-relaxed text-foreground/80">{data.stageAlignment}</p>
            </div>
          )}

          {/* 6. Next Actions */}
          {data.nextActions.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
                <ArrowRight size={12} /> 建议下一步
              </h4>
              <div className="space-y-2">
                {data.nextActions.map((na, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className={cn("mt-0.5 shrink-0 font-bold", PRIORITY_STYLE[na.priority] || PRIORITY_STYLE.medium)}>
                      {i + 1}.
                    </span>
                    <div>
                      <span className="font-medium text-foreground">{na.action}</span>
                      {na.purpose && <span className="text-muted"> — {na.purpose}</span>}
                      <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-muted">
                        {na.owner && <span>负责人: {na.owner}</span>}
                        {na.deadline && <span>· 时限: {na.deadline}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. Pending Confirmations */}
          {data.pendingConfirmations.length > 0 && (
            <div className="px-5 py-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <HelpCircle size={12} /> 待确认事项
              </h4>
              <ul className="space-y-1">
                {data.pendingConfirmations.map((pc, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/70">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted/50" />
                    {pc}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-2.5 text-[11px] text-muted">
            <div className="flex items-center gap-1.5">
              <Clock size={10} />
              生成于 {new Date(data.generatedAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
            </div>
            {data._meta && (
              <span>
                {data._meta.prompt_version as string}
                {data._meta.used_fallback ? " · fallback" : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
