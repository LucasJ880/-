"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  TrendingUp,
  Truck,
  AlertTriangle,
  ThumbsUp,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface QuoteAnalysis {
  summary: string;
  priceAnalysis: string;
  deliveryAnalysis: string;
  risks: string;
  recommendation: string;
  recommendedSupplier: string;
}

interface AnalysisResult {
  analysis: QuoteAnalysis;
  quotesCount: number;
  generatedAt: string;
}

interface Props {
  projectId: string;
  inquiryId: string;
  quotedCount: number;
}

const SECTIONS = [
  { key: "priceAnalysis" as const, label: "价格分析", icon: TrendingUp, color: "text-accent" },
  { key: "deliveryAnalysis" as const, label: "交期分析", icon: Truck, color: "text-[#2e7a56]" },
  { key: "risks" as const, label: "风险提示", icon: AlertTriangle, color: "text-[#b06a28]" },
  { key: "recommendation" as const, label: "推荐建议", icon: ThumbsUp, color: "text-[#805078]" },
];

export function QuoteAnalysisPanel({ projectId, inquiryId, quotedCount }: Props) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/inquiries/${inquiryId}/compare/analysis`,
        { method: "POST" }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "分析失败");
      }
      const data: AnalysisResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  if (quotedCount < 1) return null;

  if (!result && !loading) {
    return (
      <button
        type="button"
        onClick={runAnalysis}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
      >
        <Sparkles size={13} />
        AI 报价分析
        <span className="text-[10px] text-muted">({quotedCount} 家已报价)</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-accent/20 bg-card-bg">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-sm font-semibold">AI 报价分析</h3>
          {result && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {result.quotesCount} 家对比
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {result && !loading && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                runAnalysis();
              }}
              className="rounded p-1 text-muted hover:bg-background hover:text-foreground"
              title="重新分析"
            >
              <RefreshCw size={12} />
            </button>
          )}
          {expanded ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/60 px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted">
              <Loader2 size={16} className="animate-spin text-accent" />
              AI 正在分析 {quotedCount} 家供应商报价…
            </div>
          )}

          {error && (
            <div className="py-4 text-center">
              <p className="text-sm text-[#a63d3d]">{error}</p>
              <button
                type="button"
                onClick={runAnalysis}
                className="mt-2 text-xs text-accent hover:underline"
              >
                重试
              </button>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              <div className="rounded-lg bg-accent/5 px-3 py-2.5">
                <p className="text-sm font-medium text-accent">
                  {result.analysis.summary}
                </p>
                {result.analysis.recommendedSupplier && (
                  <p className="mt-1 text-[11px] text-muted">
                    推荐供应商：<span className="font-medium text-foreground">{result.analysis.recommendedSupplier}</span>
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {SECTIONS.map((s) => {
                  const text = result.analysis[s.key];
                  if (!text) return null;
                  return (
                    <div
                      key={s.key}
                      className="rounded-lg border border-border/60 px-3 py-2.5"
                    >
                      <div className={cn("flex items-center gap-1.5 text-xs font-semibold", s.color)}>
                        <s.icon size={12} />
                        {s.label}
                      </div>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/80">
                        {text}
                      </p>
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-muted">
                分析时间：{new Date(result.generatedAt).toLocaleString("zh-CN")}
                {" · "}AI 分析仅供参考，请结合实际情况决策
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
