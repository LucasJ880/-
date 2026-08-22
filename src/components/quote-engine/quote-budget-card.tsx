"use client";

/**
 * 工作台「报价与成本」卡（任务书 §17 最小入口，不改 Tab IA）：
 * 当前报价 / 已批准或已 award 报价 / 版本 / Bid / 估算成本 / 毛利率 / 状态 → 一键进 Pricing Control Center。
 * flag OFF → API 404 → 自渲染 null。内部 KPI 仅 internal_cost 权限可见。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { money, type QuoteEngineListPayload, type QuoteEngineRow } from "./quote-engine-section";

export function QuoteBudgetCard({ projectId, onOpenBid }: { projectId: string; onOpenBid?: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<QuoteEngineListPayload | null>(null);
  const load = useCallback(() => { apiJson<QuoteEngineListPayload>(`/api/projects/${projectId}/quote-engine`).then((d) => setData(d.enabled ? d : null)).catch(() => setData(null)); }, [projectId]);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const live = data.quotes.filter((q) => q.status !== "cancelled");
  const approved = live.find((q) => q.status === "awarded") ?? live.find((q) => q.status === "approved") ?? null;
  const current = live.find((q) => q.status === "draft" || q.status === "review") ?? approved ?? live[0] ?? null;
  const row = (label: string, q: QuoteEngineRow | null) => (
    <div className="rounded-lg border border-border/60 px-3 py-2 text-xs">
      <div className="flex items-center justify-between"><span className="text-[10px] text-muted">{label}</span>{q ? <span className="text-[10px] text-muted">v{q.version} · {q.status}</span> : null}</div>
      {q ? (
        <button type="button" onClick={() => router.push(`/projects/${projectId}/quote-engine/${q.id}`)} className="mt-0.5 w-full text-left">
          <div className="font-medium text-foreground">{q.name ?? q.quoteNumber ?? q.quoteType}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]"><span>Bid <b>{money(q.sellingPrice, q.currency)}</b></span>{data.capabilities.canViewInternal ? <><span>估算成本 {money(q.estimatedCost ?? null, q.currency)}</span><span>毛利率 {q.grossMarginPct == null ? "—" : `${q.grossMarginPct.toFixed(1)}%`}</span></> : null}</div>
        </button>
      ) : <p className="mt-0.5 text-[11px] text-muted">—</p>}
    </div>
  );
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="quote-budget-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Calculator size={16} className="text-accent/60" />报价与成本<span className="text-[10px] font-normal text-muted">Budget / Quote · 成本与卖价分离</span></h3>
        {onOpenBid ? <button type="button" onClick={onOpenBid} className="rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5">{live.length === 0 ? "去创建报价" : "打开报价区"}</button> : null}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{row("当前报价", current)}{row("已批准 / Awarded", approved)}</div>
      {live.length === 0 ? <p className="mt-2 text-[11px] text-muted">尚无招投标报价——在「投标」tab 新建 Supply + Install 或 Standing Offer。</p> : null}
    </div>
  );
}
