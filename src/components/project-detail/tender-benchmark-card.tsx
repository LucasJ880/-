"use client";

/**
 * FB-13 — 历史项目对标卡（工作台）
 * 团队成员进入工作台即可看到：历史对标结论 + 多维对比 + 推荐目标价区间。
 * 数据 = /api/projects/[id]/tender-benchmark（存于最新 run summaryJson.benchmark）。
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Scale, RefreshCw } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type { TenderBenchmarkV1 } from "@/lib/tender-analyst/benchmark";

type Candidate = {
  id: string;
  name: string;
  tenderStatus: string | null;
  winningBidPrice: number | null;
  currency: string | null;
};

export function TenderBenchmarkCard({ projectId }: { projectId: string }) {
  const [benchmark, setBenchmark] = useState<TenderBenchmarkV1 | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [winnerName, setWinnerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{
        benchmark?: TenderBenchmarkV1 | null;
        candidates?: Candidate[];
      }>(`/api/projects/${projectId}/tender-benchmark`);
      setBenchmark(res.benchmark ?? null);
      setCandidates(res.candidates ?? []);
    } catch {
      /* 无权限/未启用时安静降级 */
    }
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-benchmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historicalProjectId: selected, winnerName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "对比失败");
      setBenchmark(json.benchmark);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (!loaded) return null;
  if (!benchmark && candidates.length === 0) return null; // 无可对标历史项目：不占版面

  const money = (v: number | null, c: string | null) =>
    v == null ? "—" : `${c ?? "CAD"} ${v.toLocaleString()}`;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5" data-testid="tender-benchmark-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Scale size={16} className="text-accent" />
          历史项目对标
        </h3>
        {benchmark ? (
          <button
            type="button"
            onClick={() => setBenchmark(null)}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <RefreshCw size={12} />
            重新对比
          </button>
        ) : null}
      </div>

      {!benchmark ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">
            选择一个已录入中标结果的历史招标项目，AI 将从要求、体量、时间、技术、商务多维对比，并给出推荐目标价区间。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">选择历史项目…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.tenderStatus === "won" ? "中标" : "未中标"} · {money(c.winningBidPrice, c.currency)}）
                </option>
              ))}
            </select>
            <input
              value={winnerName}
              onChange={(e) => setWinnerName(e.target.value)}
              placeholder="中标方名称（可选）"
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={!selected || busy}
              onClick={() => void run()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              {busy ? "对比中…" : "运行对比"}
            </button>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">
            对标：{benchmark.outcome.projectName}
            {benchmark.outcome.winnerName ? ` · 中标方 ${benchmark.outcome.winnerName}` : ""}
            {" · 中标价 "}
            {money(benchmark.outcome.winningBidPrice, benchmark.outcome.currency)}
            {benchmark.outcome.awardDate ? ` · ${benchmark.outcome.awardDate}` : ""}
          </p>
          <p className="text-sm leading-relaxed">{benchmark.similaritySummaryZh}</p>

          {/* 推荐目标价 */}
          <div className="rounded-lg border border-accent/25 bg-accent/[0.04] p-3">
            <p className="text-xs font-semibold text-muted">推荐目标价（参考建议，非最终报价）</p>
            <p className="mt-1 text-lg font-semibold text-accent">
              {benchmark.pricingInsight.recommendedTargetPriceLow != null &&
              benchmark.pricingInsight.recommendedTargetPriceHigh != null
                ? `${money(benchmark.pricingInsight.recommendedTargetPriceLow, benchmark.outcome.currency)} ~ ${money(benchmark.pricingInsight.recommendedTargetPriceHigh, benchmark.outcome.currency)}`
                : "现有资料不足以给出可辩护的目标价"}
              <span className="ml-2 align-middle text-[10px] font-medium text-muted">
                置信度 {benchmark.pricingInsight.confidence}
              </span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {benchmark.pricingInsight.rationaleZh}
            </p>
            {benchmark.pricingInsight.adjustmentsZh.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted">
                {benchmark.pricingInsight.adjustmentsZh.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* 维度对比 */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1.5 pr-2">维度</th>
                  <th className="py-1.5 pr-2">本项目</th>
                  <th className="py-1.5 pr-2">历史项目</th>
                  <th className="py-1.5 pr-2">差异</th>
                  <th className="py-1.5">对报价影响</th>
                </tr>
              </thead>
              <tbody>
                {benchmark.dimensions.map((d, i) => (
                  <tr key={i} className="border-b border-border/50 align-top">
                    <td className="py-1.5 pr-2 font-medium">{d.dimensionZh}</td>
                    <td className="py-1.5 pr-2">{d.currentZh}</td>
                    <td className="py-1.5 pr-2">{d.historicalZh}</td>
                    <td className="py-1.5 pr-2">{d.differenceZh}</td>
                    <td className="py-1.5">{d.pricingImpactZh}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {benchmark.caveatsZh.length > 0 ? (
            <p className="text-[11px] text-muted">注意：{benchmark.caveatsZh.join("；")}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
