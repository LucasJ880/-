"use client";

/**
 * Financial Performance（Quote Operations Phase 2 P0-D）：Budget vs Actual / 合同价值 / 完工预测 / 利润预测 / 告警 / 溯源 + advisory 分析。
 * 只读权威模型（/api/projects/[id]/finance/performance）；人工预测走 /finance/forecast。财务 dark 时自渲染 null。
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { ProjectFinancialPerformance } from "@/lib/project-finance/performance";
import type { QuoteOperationsAnalysis } from "@/lib/quote-engine/analyze-operations";

type Payload = { performance: ProjectFinancialPerformance; analysis: QuoteOperationsAnalysis };
const money = (n: number | null | undefined, ccy: string | null) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy ?? "CAD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "ok" }) {
  return <div className="rounded-lg border border-border/60 px-3 py-2"><div className="text-[10px] text-muted">{label}</div><div className={`text-sm font-semibold ${tone === "danger" ? "text-danger" : tone === "ok" ? "text-emerald-700" : "text-foreground"}`}>{value}</div>{hint ? <div className="text-[10px] text-muted">{hint}</div> : null}</div>;
}

export function FinancialPerformanceCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [data, setData] = useState<Payload | null | "disabled">(null);
  const [remaining, setRemaining] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/finance/performance`);
    if (res.status === 404) { setData("disabled"); return; }
    if (!res.ok) { setData(null); return; }
    setData((await res.json()) as Payload);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  if (!data || data === "disabled") return null;
  const p = data.performance;
  const a = data.analysis;
  if (!p.available) return null;
  const ccy = p.currency;
  const saveForecast = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/finance/forecast`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRemainingCostCad: Number(remaining), note }) });
      const json = (await res.json()) as { error?: string };
      setMsg(res.ok ? "完工预测已更新" : json.error ?? "失败");
      await load();
    } finally { setBusy(false); }
  };
  const ccyLabel = ccy ?? "CAD";
  const traceByCat = new Map<string, string>();
  for (const t of p.traceability) if (t.quoteId) traceByCat.set(t.category, t.quoteId);
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="financial-performance-card">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><BarChart3 size={16} className="text-accent/60" />Financial Performance · 预算 vs 实际</h3><span className="text-[10px] text-muted">{p.budget.hasActiveBudget ? `预算 v${p.budget.activeVersionNumber}${p.budget.hasBaseline ? ` · 基线 v${p.budget.baselineVersionNumber}` : ""}` : "无生效预算"}{p.reasons.length ? ` · ${p.reasons.join(",")}` : ""}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Original Budget" value={money(p.budget.originalBudget, ccy)} hint={p.budget.hasBaseline ? "中标基线" : "（未冻结基线）"} />
        <Tile label="Current Budget" value={money(p.budget.currentBudget, ccy)} />
        <Tile label="Actual Cost" value={money(p.actual.actualCost, ccy)} hint={p.actual.committedCost ? `已承诺 ${money(p.actual.committedCost, ccy)}` : undefined} />
        <Tile label="Remaining" value={money(p.remaining, ccy)} hint={p.usedPct != null ? `已用 ${pct(p.usedPct)}` : undefined} tone={p.remaining != null && p.remaining < 0 ? "danger" : undefined} />
        <Tile label="Forecast at Completion" value={money(p.forecast.forecastFinalCost, ccy)} hint={p.forecast.available ? (p.forecast.method === "MANUAL" ? "人工预测" : "按进度投影") : "需录入预计剩余成本（无可信进度信号）"} />
        <Tile label="Contract Value" value={money(p.contract.currentContractValue, ccy)} hint={p.contract.source === "REVENUE_LEDGER" ? `收入台账（含已批 CO ${money(p.contract.approvedChangeOrders, ccy)}）` : p.contract.source === "AWARDED_QUOTE" ? "来自 awarded 报价（收入台账未记）" : "无"} />
        <Tile label="Original Expected Profit" value={money(p.profit.originalExpectedProfit, ccy)} hint={pct(p.profit.originalExpectedMarginPct)} />
        <Tile label="Forecast Profit" value={money(p.profit.currentForecastProfit, ccy)} hint={`${pct(p.profit.currentForecastMarginPct)} · ${p.profit.costBasis === "CURRENT_BUDGET" ? "按当前预算" : p.profit.costBasis === "MANUAL_FORECAST" ? "按人工预测" : p.profit.costBasis}`} tone={p.profit.change != null && p.profit.change < 0 ? "danger" : undefined} />
        <Tile label="Profit Change" value={money(p.profit.change, ccy)} tone={p.profit.change != null && p.profit.change < 0 ? "danger" : p.profit.change != null ? "ok" : undefined} />
        <Tile label="Gross Margin" value={pct(p.profit.currentForecastMarginPct)} hint={`报价 ${pct(p.profit.originalExpectedMarginPct)}`} />
      </div>
      {p.byCategory.length > 0 ? (
        <div className="mt-3 overflow-x-auto"><table className="w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">Category</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Remaining</th><th className="text-right">Variance</th><th className="text-right">Used %</th><th className="text-left">Source</th></tr></thead>
          <tbody>{p.byCategory.map((c) => <tr key={c.category} className="border-t border-border/40"><td>{c.category}{c.overBudget ? <span className="ml-1 rounded bg-danger/10 px-1 text-[9px] text-danger">OVER_BUDGET{c.overBudgetPct != null ? ` ${c.overBudgetPct}%` : ""}</span> : null}</td><td className="text-right font-mono">{money(c.budget, ccy)}</td><td className="text-right font-mono">{money(c.actual, ccy)}</td><td className={`text-right font-mono ${c.remaining < 0 ? "text-danger" : ""}`}>{money(c.remaining, ccy)}</td><td className={`text-right font-mono ${c.varianceAmount > 0 ? "text-danger" : ""}`}>{c.varianceAmount > 0 ? "+" : ""}{money(c.varianceAmount, ccy)}</td><td className="text-right font-mono">{pct(c.usedPct)}</td><td className="text-[10px] text-muted">{traceByCat.has(c.category) ? `Quote ${traceByCat.get(c.category)!.slice(-6)}` : "—"}</td></tr>)}</tbody></table></div>
      ) : null}
      {p.warnings.length > 0 ? <ul className="mt-2 space-y-0.5 text-[11px]">{p.warnings.map((w, i) => <li key={i} className={w.severity === "HIGH" ? "text-danger" : w.severity === "MEDIUM" ? "text-warning" : "text-muted"}>[{w.code}] {w.messageZh}</li>)}</ul> : null}
      {canManage ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 text-[11px]"><label className="text-muted">预计剩余成本（人工预测，{ccyLabel}）<br /><input type="number" value={remaining} onChange={(e) => setRemaining(e.target.value)} className="mt-0.5 w-36 rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label><label className="text-muted">备注<br /><input value={note} onChange={(e) => setNote(e.target.value)} className="mt-0.5 w-48 rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label><button type="button" disabled={busy || remaining === ""} onClick={() => void saveForecast()} className="rounded border border-border px-2 py-1 disabled:opacity-50">更新完工预测</button>{p.forecast.method === "MANUAL" ? <span className="text-muted">上次 {p.forecast.updatedAt?.slice(0, 10)} · 剩余 {money(p.forecast.expectedRemainingCost, ccy)}{p.forecast.note ? ` · ${p.forecast.note}` : ""}</span> : null}</div>
      ) : null}
      <details className="mt-2 text-[11px]"><summary className="cursor-pointer text-muted">AI 解读（advisory，不改任何数据）</summary><ul className="mt-1 list-disc pl-4">{[...a.summaryZh, ...a.recommendationsZh.map((r) => `建议：${r}`)].map((s, i) => <li key={i}>{s}</li>)}</ul></details>
      {msg ? <p className="mt-1 text-[11px] text-muted">{msg}</p> : null}
      {busy ? <p className="text-[11px] text-muted"><Loader2 size={12} className="inline animate-spin" /> 处理中…</p> : null}
    </div>
  );
}
