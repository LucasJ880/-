"use client";

/**
 * Tender "Our Bid"（Quote Operations Phase 2 P0-C）
 *  - TenderOurBidCard：工作台 / 标书 tab 摘要卡（Our Bid = 被选中的 Approved Quote；REVISION_PENDING 明示）
 *  - TenderBidPanel：Pricing Control Center 内「选为我方报价」
 * 权威来源 = approved/awarded 引擎报价；draft/review 永不成为 Our Bid；不自动提交任何门户。
 */

import { useCallback, useEffect, useState } from "react";
import { Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type { TenderBidResolution } from "@/lib/quote-engine/tender-bid";

type Payload = { bid: TenderBidResolution; capabilities: { canViewInternal: boolean; canApprove: boolean } };
const money = (n: number | null | undefined, ccy: string) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy, maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);
const METHOD_ZH: Record<string, string> = { MARKUP_ON_COST: "Markup on Cost（成本加成）", MARGIN_ON_REVENUE: "Margin on Selling Price（按售价毛利率）" };

export function useTenderBid(projectId: string) {
  const [data, setData] = useState<Payload | null>(null);
  const load = useCallback(async () => {
    const res = await apiJson<Payload>(`/api/projects/${projectId}/quote-engine/tender-bid`).catch(() => null);
    setData(res);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  return { data, reload: load };
}

export function TenderOurBidCard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data } = useTenderBid(projectId);
  if (!data) return null;
  const { bid } = data;
  const q = bid.quote;
  const badge = bid.status === "AUTHORITATIVE" ? { cls: "bg-emerald-100 text-emerald-800", text: bid.followedRevision ? "已跟随修订版本" : "权威来源" } : bid.status === "QUOTE_REVISION_PENDING" ? { cls: "bg-amber-100 text-amber-800", text: "QUOTE_REVISION_PENDING" } : { cls: "bg-muted/60 text-muted", text: "尚未选择" };
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="tender-our-bid-card">
      <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Target size={16} className="text-accent/60" />Our Bid · 我方报价</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.text}</span></div>
      {q ? (
        <button type="button" onClick={() => router.push(`/projects/${projectId}/quote-engine/${q.id}`)} className="mt-2 w-full text-left">
          <div className="text-2xl font-semibold text-foreground">{money(q.sellingPrice, q.currency)} <span className="text-xs font-normal text-muted">{q.currency}</span></div>
          <div className="text-[11px] text-muted">{bid.status === "QUOTE_REVISION_PENDING" ? `旧 Approved Quote V${q.version}（已被修订，新版本尚未批准）` : `Approved Quote V${q.version}`}{q.quoteNumber ? ` · ${q.quoteNumber}` : ""}{bid.pendingRevision ? ` · 待批准 V${bid.pendingRevision.version}（${bid.pendingRevision.status}）` : ""}</div>
          {data.capabilities.canViewInternal ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <div><div className="text-muted">Estimated Cost</div><div className="font-mono">{money(q.estimatedCost, q.currency)}</div></div>
              <div><div className="text-muted">Expected Gross Profit</div><div className="font-mono">{money(q.grossProfit, q.currency)}</div></div>
              <div><div className="text-muted">Gross Margin</div><div className="font-mono">{pct(q.grossMarginPct)}</div></div>
              <div><div className="text-muted">Pricing Method</div><div>{METHOD_ZH[q.pricingMethod] ?? q.pricingMethod}{q.pricingRate != null ? ` ${q.pricingRate}%` : ""}</div></div>
            </div>
          ) : null}
        </button>
      ) : (
        <p className="mt-2 text-[11px] text-muted">{bid.reason}{bid.candidates.length > 0 ? `（可选：${bid.candidates.map((c) => `V${c.version} ${money(c.sellingPrice, c.currency)}`).join(" / ")}）` : ""}</p>
      )}
      <p className="mt-2 text-[10px] text-muted">Approved Quote 是 Tender 我方报价的唯一权威来源；提交 tab 不再手填。</p>
    </div>
  );
}

export function TenderBidPanel({ projectId, quoteId, quoteStatus, canApprove, onChanged }: { projectId: string; quoteId: string; quoteStatus: string; canApprove: boolean; onChanged?: () => void }) {
  const { data, reload } = useTenderBid(projectId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return null;
  const { bid } = data;
  const isSelected = bid.selectedQuoteId === quoteId || bid.quote?.id === quoteId;
  const eligible = quoteStatus === "approved" || quoteStatus === "awarded";
  const select = async () => {
    if (!window.confirm("把本报价选为 Tender 我方报价（Our Bid）？将写入审计并同步到项目「我方报价」。")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine/${quoteId}/select-bid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const json = (await res.json()) as { error?: string; code?: string };
      setMsg(res.ok ? "已选为我方报价" : `${json.code ?? ""} ${json.error ?? "失败"}`);
      await reload(); onChanged?.();
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 text-[11px]" data-testid="tender-bid-panel">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Tender Integration · 我方报价来源</h3>
        {isSelected && bid.status === "AUTHORITATIVE" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">本报价 = Tender Our Bid</span> : canApprove && eligible ? <button type="button" disabled={busy} onClick={() => void select()} className="rounded border border-accent bg-accent/10 px-2 py-1 font-medium">选为我方报价（Our Bid）</button> : <span className="text-muted">{eligible ? "需 approve 权限" : "只有 approved 报价可选为我方报价"}</span>}</div>
      <p className="mt-1 text-muted">当前：{bid.status === "AUTHORITATIVE" && bid.quote ? `Approved Quote V${bid.quote.version}（${bid.quote.quoteNumber ?? bid.quote.id.slice(-6)}）${bid.followedRevision ? "，已自动跟随修订版本" : ""}` : bid.status === "QUOTE_REVISION_PENDING" ? `QUOTE_REVISION_PENDING — ${bid.reason}` : bid.reason}</p>
      {msg ? <p className="mt-1 text-muted">{msg}</p> : null}
    </div>
  );
}
