"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { TradeQuoteSalesConversionPreviewDto } from "@/lib/trade/trade-quote-sales-quote";

type Props = {
  quoteId: string | null;
  orgId: string | null;
  ambiguous: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: () => void;
};

export function ConvertTradeQuoteToSalesQuoteDialog({
  quoteId,
  orgId,
  ambiguous,
  open,
  onOpenChange,
  onConverted,
}: Props) {
  const [preview, setPreview] = useState<TradeQuoteSalesConversionPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeItems, setIncludeItems] = useState(true);
  const [attachToOpportunity, setAttachToOpportunity] = useState(true);

  const loadPreview = useCallback(async () => {
    if (!quoteId || !orgId || ambiguous) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/trade/quotes/${quoteId}/sales-conversion-preview?orgId=${encodeURIComponent(orgId)}`,
      );
      const data = (await res.json()) as TradeQuoteSalesConversionPreviewDto & { error?: string };
      if (!res.ok) {
        setPreview(null);
        setError(data.error ?? `预览失败（${res.status}）`);
        return;
      }
      setPreview(data);
    } catch {
      setPreview(null);
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [quoteId, orgId, ambiguous]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      return;
    }
    void loadPreview();
  }, [open, loadPreview]);

  const handleConfirm = async () => {
    if (!quoteId || !orgId || ambiguous || !preview?.canConvert) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/trade/quotes/${quoteId}/convert-to-sales-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, includeItems, attachToOpportunity }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; salesQuote?: { id: string } };
      if (!res.ok) {
        setError(j.error ?? `转换失败（${res.status}）`);
        return;
      }
      onConverted?.();
      onOpenChange(false);
    } catch {
      setError("网络错误");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card-bg p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">转为销售报价</h3>
          <button
            type="button"
            className="text-xs text-muted hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </button>
        </div>

        {!orgId || ambiguous ? (
          <p className="text-xs text-muted">请选择当前组织后再操作。</p>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : (
          <>
            {error && (
              <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">{error}</p>
            )}
            {preview && (
              <div className="space-y-3 text-xs">
                {preview.alreadyConverted && preview.existingSalesQuoteId && (
                  <p className="text-emerald-400">
                    已转换。销售报价 ID：
                    <span className="ml-1 font-mono">{preview.existingSalesQuoteId}</span>
                    {preview.targetCustomer && (
                      <>
                        {" "}
                        <Link
                          href={`/sales/customers/${preview.targetCustomer.id}`}
                          className="text-violet-400 underline"
                        >
                          打开客户
                        </Link>
                      </>
                    )}
                  </p>
                )}
                <div>
                  <p className="font-medium text-foreground">外贸报价</p>
                  <p className="mt-1 text-muted">
                    {preview.tradeQuote.quoteNumber} · {preview.tradeQuote.status} ·{" "}
                    {preview.tradeQuote.currency} {preview.tradeQuote.totalAmount.toFixed(2)}
                  </p>
                </div>
                {preview.prospect && (
                  <div>
                    <p className="font-medium text-foreground">线索</p>
                    <p className="mt-1 text-muted">
                      {preview.prospect.companyName} · 阶段 {preview.prospect.stageNormalized}
                    </p>
                  </div>
                )}
                {preview.targetCustomer && (
                  <div>
                    <p className="font-medium text-foreground">目标销售客户</p>
                    <p className="mt-1 text-muted">
                      {preview.targetCustomer.name}{" "}
                      <Link
                        href={`/sales/customers/${preview.targetCustomer.id}`}
                        className="text-violet-400 underline"
                      >
                        打开
                      </Link>
                    </p>
                  </div>
                )}
                {preview.targetOpportunity && (
                  <div>
                    <p className="font-medium text-foreground">目标商机</p>
                    <p className="mt-1 text-muted">{preview.targetOpportunity.title}</p>
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground">拟创建销售报价</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 text-[10px] text-muted">
                    {JSON.stringify(preview.proposedSalesQuote, null, 2)}
                  </pre>
                </div>
                {preview.proposedItems.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">明细行预览（写入 formDataJson）</p>
                    <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-[10px] text-muted">
                      {preview.proposedItems.map((it) => (
                        <li key={it.tradeLineId}>
                          {it.productName} × {it.quantity} {it.unit} @ {it.unitPrice} → {it.totalPrice}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.warnings.length > 0 && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                    <p className="font-medium text-amber-200">提示</p>
                    <ul className="mt-1 list-inside list-disc text-amber-100/90">
                      {preview.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!preview.alreadyConverted && (
                  <>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeItems}
                        onChange={(e) => setIncludeItems(e.target.checked)}
                      />
                      将外贸行明细写入 formDataJson（推荐）
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={attachToOpportunity}
                        onChange={(e) => setAttachToOpportunity(e.target.checked)}
                      />
                      关联到已转入的商机（若有）
                    </label>
                  </>
                )}
                <div className="flex justify-end gap-2 border-t border-border/40 pt-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-1.5 text-xs"
                    onClick={() => onOpenChange(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy || !preview.canConvert || preview.alreadyConverted}
                    onClick={() => void handleConfirm()}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {busy ? "处理中…" : "确认转换"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
