"use client";

/**
 * 成本报价引擎区块（投标 tab 首位）：列出引擎报价（版本/状态/售价；内部 KPI 仅 internal_cost 可见）+ 新建。
 * 数据由父级 BidQuoteArea 拉取一次（flag OFF → API 404 → 父级不渲染本区块）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

export type QuoteEngineRow = { id: string; quoteNumber: string | null; name: string | null; quoteType: string; status: string; version: number; currency: string; sellingPrice: number | null; estimatedCost?: number | null; grossMarginPct?: number | null; approvedAt: string | null; awardedAt: string | null; updatedAt: string };
export type QuoteEngineListPayload = { enabled: boolean; capabilities: { canViewInternal: boolean; canEdit: boolean; canApprove: boolean }; quotes: QuoteEngineRow[] };

export const money = (n: number | null | undefined, ccy: string) => (n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy }));

export function QuoteEngineSection({ projectId, data, onReload }: { projectId: string; data: QuoteEngineListPayload; onReload: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const create = async (quoteType: string, demo?: "A" | "B") => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteType, demo: demo ?? null }) });
      const json = (await res.json()) as { id?: string };
      if (res.ok && json.id) router.push(`/projects/${projectId}/quote-engine/${json.id}`);
      else onReload();
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="quote-engine-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Calculator size={16} className="text-accent/60" />招投标报价（成本 → 定价 → 版本）<span className="text-[10px] font-normal text-muted">成本与卖价分离 · 定价口径显式 · 历史版本不可覆盖</span></h3>
        {data.capabilities.canEdit ? <div className="flex flex-wrap gap-2 text-[11px]"><button type="button" disabled={busy} onClick={() => void create("PROJECT_SUPPLY_INSTALL")} className="rounded border border-border bg-accent/10 px-2 py-1">+ Supply + Install</button><button type="button" disabled={busy} onClick={() => void create("STANDING_OFFER")} className="rounded border border-border bg-accent/10 px-2 py-1">+ Standing Offer</button>{process.env.NODE_ENV !== "production" ? <><button type="button" disabled={busy} onClick={() => void create("PROJECT_SUPPLY_INSTALL", "A")} className="rounded border border-dashed border-border px-2 py-1 text-muted">Demo A</button><button type="button" disabled={busy} onClick={() => void create("STANDING_OFFER", "B")} className="rounded border border-dashed border-border px-2 py-1 text-muted">Demo B</button></> : null}</div> : null}
      </div>
      {data.quotes.length === 0 ? <p className="mt-2 text-[11px] text-muted">尚无报价。新建后进入 Pricing Control Center：成本行 → 定价 → 情景 → 客户预览。</p> : (
        <table className="mt-2 w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">报价</th><th>类型</th><th>状态</th><th>版本</th><th className="text-right">Bid</th>{data.capabilities.canViewInternal ? <><th className="text-right">估算成本</th><th className="text-right">毛利率</th></> : null}</tr></thead>
          <tbody>
            {data.quotes.map((q) => {
              const statusClass = q.status === "approved" || q.status === "awarded" ? "text-emerald-700" : q.status === "superseded" || q.status === "cancelled" ? "text-muted" : "";
              const label = q.name ?? q.quoteNumber ?? q.id.slice(-6);
              return (
                <tr key={q.id} className="cursor-pointer border-t border-border/40 hover:bg-accent/5" onClick={() => router.push(`/projects/${projectId}/quote-engine/${q.id}`)}>
                  <td className="py-1">{label}</td>
                  <td className="text-center">{q.quoteType}</td>
                  <td className="text-center"><span className={statusClass}>{q.status}</span></td>
                  <td className="text-center">v{q.version}</td>
                  <td className="text-right font-mono">{money(q.sellingPrice, q.currency)}</td>
                  {data.capabilities.canViewInternal ? (
                    <>
                      <td className="text-right font-mono">{money(q.estimatedCost == null ? null : q.estimatedCost, q.currency)}</td>
                      <td className="text-right font-mono">{q.grossMarginPct == null ? "—" : `${q.grossMarginPct.toFixed(1)}%`}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody></table>
      )}
    </div>
  );
}
