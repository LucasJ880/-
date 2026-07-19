"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { PROJECT_TYPE_LABELS } from "@/lib/projects/ai-summary-types";

type SummaryResp = {
  structured: {
    currentAdvice?: string;
    biggestOpportunity?: string | null;
    biggestRisk?: string | null;
    missingInfo?: string[];
    nextSteps?: string[];
    projectTypes?: string[];
    aiAdviceStatus?: string;
  } | null;
  aiAdviceLabel: string | null;
  similarCount: number;
  summary: string | null;
};

export function ProjectAiSummaryCard({
  projectId,
}: {
  projectId: string;
}) {
  const [data, setData] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<SummaryResp>(
        `/api/projects/${projectId}/ai-summary`,
      );
      setData(res);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await apiJson(`/api/projects/${projectId}/ai-summary`, { method: "POST" });
      await load();
    } catch {
      /* ignore */
    }
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5 text-sm text-muted">
        <Loader2 size={14} className="mr-2 inline animate-spin" />
        加载 AI 摘要…
      </div>
    );
  }

  if (!data?.structured && !data?.summary) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} className="text-accent" />
            AI 项目摘要
          </h3>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs text-accent hover:underline"
          >
            从情报生成
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          尚无结构化摘要。请先在情报卡生成分析，或点击「从情报生成」。
        </p>
      </div>
    );
  }

  const s = data.structured;
  const types = (s?.projectTypes || [])
    .map((t) => PROJECT_TYPE_LABELS[t as keyof typeof PROJECT_TYPE_LABELS] || t)
    .join(" · ");

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={16} className="text-accent" />
          AI 项目摘要
          {data.aiAdviceLabel ? (
            <span className="rounded bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              {data.aiAdviceLabel}
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          {refreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          刷新
        </button>
      </div>

      <p className="mt-3 text-sm leading-relaxed">
        {s?.currentAdvice || data.summary}
      </p>

      <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="rounded-lg bg-muted/20 px-3 py-2">
          <div className="text-muted">项目类型</div>
          <div className="mt-0.5 font-medium">{types || "未识别"}</div>
        </div>
        <div className="rounded-lg bg-muted/20 px-3 py-2">
          <div className="text-muted">相似历史项目</div>
          <div className="mt-0.5 font-medium">{data.similarCount} 个</div>
        </div>
        <div className="rounded-lg bg-muted/20 px-3 py-2">
          <div className="text-muted">最大机会</div>
          <div className="mt-0.5">{s?.biggestOpportunity || "—"}</div>
        </div>
        <div className="rounded-lg bg-muted/20 px-3 py-2">
          <div className="text-muted">最大风险</div>
          <div className="mt-0.5">{s?.biggestRisk || "—"}</div>
        </div>
      </div>

      {(s?.missingInfo?.length || 0) > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-muted">缺少信息</div>
          <ul className="mt-1 list-disc pl-4 text-[12px]">
            {s!.missingInfo!.slice(0, 6).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(s?.nextSteps?.length || 0) > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-muted">下一步建议</div>
          <ul className="mt-1 list-disc pl-4 text-[12px]">
            {s!.nextSteps!.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] text-muted">
        AI 建议态不会自动覆盖项目正式状态；请人工确认后再推进。
      </p>
    </div>
  );
}
