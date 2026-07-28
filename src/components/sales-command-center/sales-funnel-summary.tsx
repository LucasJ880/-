"use client";

import Link from "next/link";
import { formatSalesMoney } from "@/lib/sales/home";
import type { SalesHomeResponse } from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "./sales-card";

export function SalesFunnelSummary({
  funnel,
  status,
  onRetry,
}: {
  funnel: SalesHomeResponse["funnel"];
  status: "loading" | "empty" | "error" | "ready";
  onRetry?: () => void;
}) {
  const maxCount = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <SalesCard title="销售漏斗">
      {status === "loading" && <SalesCardState kind="loading" message="" />}
      {status === "error" && (
        <SalesCardState
          kind="error"
          message="销售漏斗暂时无法加载"
          onRetry={onRetry}
        />
      )}
      {status === "empty" && (
        <SalesCardState kind="empty" message="暂无商机漏斗数据。" />
      )}
      {status === "ready" && (
        <ul className="space-y-2.5">
          {funnel.map((stage) => (
            <li key={stage.stage}>
              <Link
                href={`/sales?view=pipeline&stage=${encodeURIComponent(stage.stage)}`}
                className="block rounded-xl border border-transparent px-1 py-1 hover:border-[var(--border)] hover:bg-[var(--muted)]/5"
              >
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-medium text-[var(--foreground)]">
                    {stage.label}
                  </span>
                  <span className="text-[var(--muted)]">
                    {stage.count} · {formatSalesMoney(stage.amount)}
                    {stage.conversionRate != null
                      ? ` · ${stage.conversionRate}%`
                      : ""}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]/15">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]/70"
                    style={{
                      width: `${Math.max(6, (stage.count / maxCount) * 100)}%`,
                    }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SalesCard>
  );
}
