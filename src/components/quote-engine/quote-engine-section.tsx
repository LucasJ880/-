"use client";

/** 投标 tab 最小入口：列出引擎报价（版本/状态/售价）+ 新建（Supply+Install / Standing Offer）。flag OFF → API 404 → 不渲染。 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type Row = { id: string; quoteNumber: string | null; name: string | null; quoteType: string; status: string; version: number; currency: string; sellingPrice: number | null; estimatedCost?: number | null; grossMarginPct?: number | null; approvedAt: string | null; awardedAt: string | null };
type Payload = { enabled: boolean; capabilities: { canViewInternal: boolean; canEdit: boolean; canApprove: boolean }; quotes: Row[] };

export function QuoteEngineSection({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { apiJson<Payload>(`/api/projects/${projectId}/quote-engine`).then(setData).catch(() => setData(null)); }, [projectId]);
  useEffect(() => { load(); }, [load]);
  if (!data?.enabled) return null;
  const create = async (quoteType: string, demo?: "A" | "B") => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteType, demo: demo ?? null }) });
      const json = (await res.json()) as { id?: string };
      if (res.ok && json.id) router.push(`/projects/${projectId}/quote-engine/${json.id}`);
      else load();
    } finally { setBusy(false); }
  };
  const money = (n: number | null | undefined, ccy: string) => (n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy }));
  return (
    <div className="mt-4 rounded-xl border border-border bg-card-bg p-4" data-testid="quote-engine-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">成本报价引擎（Quote & Cost Engine）</h3>
        {data.capabilities.canEdit ? <div className="flex flex-wrap gap-2 text-[11px]"><button type="button" disabled={busy} onClick={() => void create("PROJECT_SUPPLY_INSTALL")} className="rounded border border-border px-2 py-1">+ Supply + Install</button><button type="button" disabled={busy} onClick={() => void create("STANDING_OFFER")} className="rounded border border-border px-2 py-1">+ Standing Offer</button>{process.env.NODE_ENV !== "production" ? <><button type="button" disabled={busy} onClick={() => void create("PROJECT_SUPPLY_INSTALL", "A")} className="rounded border border-dashed border-border px-2 py-1 text-muted">Demo A</button><button type="button" disabled={busy} onClick={() => void create("STANDING_OFFER", "B")} className="rounded border border-dashed border-border px-2 py-1 text-muted">Demo B</button></> : null}</div> : null}
      </div>
      {data.quotes.length === 0 ? <p className="mt-2 text-[11px] text-muted">尚无引擎报价。成本与卖价分离、定价口径显式、版本可追踪。</p> : (
        <table className="mt-2 w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">报价</th><th>类型</th><th>状态</th><th>版本</th><th className="text-right">Bid</th>{data.capabilities.canViewInternal ? <><th className="text-right">成本</th><th className="text-right">毛利率</th></> : null}</tr></thead>
          <tbody>{data.quotes.map((q) => <tr key={q.id} className="cursor-pointer border-t border-border/40 hover:bg-accent/5" onClick={() => router.push(`/projects/${projectId}/quote-engine/${q.id}`)}><td className="py-1">{q.name ?? q.quoteNumber ?? q.id.slice(-6)}</td><td className="text-center">{q.quoteType}</td><td className="text-center">{q.status}</td><td className="text-center">v{q.version}</td><td className="text-right font-mono">{money(q.sellingPrice, q.currency)}</td>{data.capabilities.canViewInternal ? <><td className="text-right font-mono">{money(q.estimatedCost ?? null, q.currency)}</td><td className="text-right font-mono">{q.grossMarginPct == null ? "—" : `${q.grossMarginPct.toFixed(1)}%`}</td></> : null}</tr>)}</tbody></table>
      )}
    </div>
  );
}
