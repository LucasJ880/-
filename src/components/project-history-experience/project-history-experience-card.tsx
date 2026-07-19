"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type SimRow = {
  id: string;
  score: number;
  reasons: string[];
  impactText: string | null;
  recommendations: string[];
  similarProject: {
    name: string;
    tenderStatus: string | null;
    ourBidPrice: number | null;
    winningBidPrice: number | null;
  };
  priceGap: {
    summaryLines: string[];
    winningAsPctOfOurs: number;
    oursPremiumPctVsWinning: number;
  } | null;
};

export function ProjectHistoryExperienceCard({
  projectId,
}: {
  projectId: string;
}) {
  const [items, setItems] = useState<SimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ similarities: SimRow[] }>(
        `/api/projects/${projectId}/similarities`,
      );
      setItems(res.similarities ?? []);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recompute = async () => {
    setBusy(true);
    try {
      await apiJson(`/api/projects/${projectId}/similarities`, {
        method: "POST",
      });
      await load();
    } catch {
      /* ignore */
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <History size={16} className="text-accent/70" />
          历史项目经验
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void recompute()}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          重新检索
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-muted">加载中…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted">
          暂无相似项目。生成情报后会自动检索；也可手动重新检索。
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-border/60 px-3 py-2.5 text-[12px]"
            >
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <span>{s.similarProject.name}</span>
                <span className="text-muted">
                  相似度 {Math.round(s.score * 100)}%
                </span>
                {s.similarProject.tenderStatus ? (
                  <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px]">
                    {s.similarProject.tenderStatus}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-muted">
                相似原因：{s.reasons.join("；") || "—"}
              </p>
              {s.priceGap ? (
                <div className="mt-1 whitespace-pre-wrap text-muted">
                  {s.priceGap.summaryLines.join("\n")}
                </div>
              ) : null}
              {s.impactText ? (
                <p className="mt-1">对当前项目：{s.impactText}</p>
              ) : null}
              {s.recommendations.length > 0 ? (
                <ol className="mt-1 list-decimal pl-4">
                  {s.recommendations.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
