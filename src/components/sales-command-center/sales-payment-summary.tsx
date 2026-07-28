"use client";

import { useState } from "react";
import Link from "next/link";
import { formatSalesMoney } from "@/lib/sales/home";
import type { SalesHomeResponse } from "@/lib/sales/home";
import { RecordDepositDialog } from "@/components/sales/record-deposit-dialog";
import { SalesCard, SalesCardState } from "./sales-card";

export function SalesPaymentSummary({
  summary,
  status,
  onRetry,
  onChanged,
}: {
  summary: SalesHomeResponse["paymentSummary"];
  status: "loading" | "empty" | "error" | "ready";
  onRetry?: () => void;
  onChanged?: () => void;
}) {
  const [target, setTarget] = useState<{
    id: string;
    customerId: string;
    customerName: string;
    grandTotal: number;
    agreedDepositAmount?: number | null;
  } | null>(null);

  return (
    <>
      <SalesCard title="签约与收款">
        {status === "loading" && <SalesCardState kind="loading" message="" />}
        {status === "error" && (
          <SalesCardState
            kind="error"
            message="收款摘要暂时无法加载"
            onRetry={onRetry}
          />
        )}
        {status === "ready" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "本月已签金额", value: summary.signedAmount },
                {
                  label: "待登记定金",
                  value: summary.pendingDepositAmount,
                  warn: summary.pendingDeposits.length > 0,
                },
                {
                  label: "已收定金",
                  value: summary.collectedDepositAmount,
                },
                {
                  label: "待收尾款",
                  value: summary.pendingBalanceAmount,
                },
              ].map((cell) => (
                <div
                  key={cell.label}
                  className="rounded-xl border border-[var(--border)]/70 px-3 py-2"
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                    {"warn" in cell && cell.warn && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    )}
                    {cell.label}
                  </p>
                  <p className="mt-0.5 text-[14px] font-semibold">
                    {formatSalesMoney(cell.value)}
                  </p>
                </div>
              ))}
            </div>

            {summary.pendingDeposits.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">
                暂无待登记定金。
              </p>
            ) : (
              <ul className="space-y-2">
                {summary.pendingDeposits.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)]/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {q.customerName}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {formatSalesMoney(q.grandTotal)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setTarget({
                          id: q.id,
                          customerId: q.customerId ?? "",
                          customerName: q.customerName,
                          grandTotal: q.grandTotal,
                          agreedDepositAmount: q.agreedDepositAmount,
                        })
                      }
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[12px] text-[var(--on-accent)]"
                    >
                      登记定金
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Link
              href="/sales/quotes?status=signed"
              className="inline-block text-[12px] text-[var(--accent)] hover:underline"
            >
              查看全部报价
            </Link>
          </div>
        )}
      </SalesCard>

      {target && (
        <RecordDepositDialog
          open={!!target}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          quoteId={target.id}
          grandTotal={target.grandTotal}
          agreedDepositAmount={target.agreedDepositAmount}
          onSaved={() => {
            setTarget(null);
            onChanged?.();
          }}
        />
      )}
    </>
  );
}
