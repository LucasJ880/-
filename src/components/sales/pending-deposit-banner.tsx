"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Wallet, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { RecordDepositDialog } from "./record-deposit-dialog";

interface PendingQuote {
  id: string;
  customerId: string;
  customerName: string;
  grandTotal: number;
  signedAt: string;
}

interface SummaryResp {
  count: number;
  quotes: PendingQuote[];
}

/**
 * /sales 顶部"待登记定金"提醒条。
 *   - 有 0 条时不渲染
 *   - 展示最多前 3 条，每条可直接打开登记弹窗
 *   - > 3 条时显示「查看全部 N 张」链接到 /sales/quotes?status=signed
 */
export function PendingDepositBanner() {
  const [data, setData] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<PendingQuote | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/sales/pending-deposit/summary");
      if (!res.ok) {
        setData({ count: 0, quotes: [] });
        return;
      }
      const d = (await res.json()) as SummaryResp;
      setData(d);
    } catch {
      setData({ count: 0, quotes: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data || data.count === 0) return null;

  const preview = data.quotes.slice(0, 3);
  const extra = data.count - preview.length;

  const formatSigned = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const days = Math.floor(diffMs / 86400000);
      if (days <= 0) return "今天";
      if (days === 1) return "1 天前";
      if (days <= 7) return `${days} 天前`;
      return d.toLocaleDateString("zh-CN");
    } catch {
      return "—";
    }
  };

  return (
    <>
      <div className="rounded-[var(--radius-md)] border border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm shrink-0">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-orange-900">
                有 {data.count} 张订单已签约但尚未登记定金
              </p>
              <p className="text-xs text-orange-800/80 mt-0.5">
                客户已完成签字，请在收到定金后登记金额与支付方式，系统会同步到客户档案并用于生产排期。
              </p>
            </div>
          </div>
          <Link
            href="/sales/quotes?status=signed"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-orange-300 bg-white/70 px-3 py-1.5 text-xs font-medium text-orange-800 hover:bg-white transition-colors"
          >
            全部报价
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {preview.map((q) => (
            <div
              key={q.id}
              className="rounded-md border border-orange-200 bg-white/80 p-2.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/sales/customers/${q.customerId}`}
                  className="text-sm font-medium text-foreground hover:text-orange-700 truncate block"
                >
                  {q.customerName}
                </Link>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  ${q.grandTotal.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  {" · 签约于 "}{formatSigned(q.signedAt)}
                </p>
              </div>
              <button
                onClick={() => setTarget(q)}
                className="inline-flex items-center gap-1 rounded-md bg-orange-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-orange-600 transition-colors shrink-0"
              >
                <Wallet className="h-3 w-3" />
                登记
              </button>
            </div>
          ))}
        </div>

        {extra > 0 && (
          <div className="mt-2 text-right">
            <Link
              href="/sales/quotes?status=signed"
              className="text-xs font-medium text-orange-700 hover:text-orange-900"
            >
              还有 {extra} 张 →
            </Link>
          </div>
        )}
      </div>

      {target && (
        <RecordDepositDialog
          open={!!target}
          onOpenChange={(open) => { if (!open) setTarget(null); }}
          quoteId={target.id}
          grandTotal={target.grandTotal}
          onSaved={() => {
            setTarget(null);
            load();
          }}
        />
      )}
    </>
  );
}
