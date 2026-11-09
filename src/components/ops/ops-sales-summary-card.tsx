"use client";

/**
 * OPS-REV：运营中心的「全公司销售额」只读卡。
 * 只显示本周 / 本月至今的成单金额、成单数、报价金额；没有客户、报价与按销售员的明细，也不链到销售页。
 * 无权（403）时整张卡不渲染。
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { formatSalesMoney } from "@/lib/sales/home/formatters";
import type { OrgRevenueSummary, RevenueSummaryWindow } from "@/lib/sales/period/revenue-summary-pure";

type State = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ready"; data: OrgRevenueSummary };

function WindowColumn({ title, w }: { title: string; w: RevenueSummaryWindow }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-[var(--muted)]">
        {title}
        <span className="ml-1 tabular-nums">
          （{w.from.slice(5)} 至 {w.to.slice(5)}）
        </span>
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-[var(--muted)]">成单金额</p>
          <p className="text-lg font-semibold tabular-nums">{formatSalesMoney(w.wonAmount)}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--muted)]">成单数</p>
          <p className="text-lg font-semibold tabular-nums">{w.wonCount} 单</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--muted)]">报价金额</p>
          <p className="text-lg font-semibold tabular-nums">{formatSalesMoney(w.quotedAmount)}</p>
        </div>
      </div>
    </div>
  );
}

export function OpsSalesSummaryCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/ops/sales-summary")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403 || res.status === 400) return setState({ kind: "hidden" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", data: (await res.json()) as OrgRevenueSummary });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "hidden" || state.kind === "loading") return null;

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-4" data-testid="ops-sales-summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">全公司销售额</h2>
        <p className="text-[11px] text-[var(--muted)]">只读汇总 · CAD 含税 · 成单按签约日、报价按发出日</p>
      </div>
      {state.kind === "error" ? (
        <p className="text-[13px] text-[var(--muted)]">销售额暂时无法加载，请稍后刷新。</p>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <WindowColumn title="本周" w={state.data.thisWeek} />
            <WindowColumn title="本月至今" w={state.data.monthToDate} />
          </div>
          {(state.data.nonCadExcludedCount > 0 || state.data.truncated) && (
            <p className="text-[11px] text-[var(--muted)]">
              {state.data.nonCadExcludedCount > 0 ? `另有 ${state.data.nonCadExcludedCount} 份非 CAD 报价未计入。` : ""}
              {state.data.truncated ? "报价较多，只统计了前一部分。" : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
