"use client";

import Link from "next/link";
import { formatSalesMoney, type SalesPriorityCustomer } from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "./sales-card";

export function SalesPriorityCustomers({
  items,
  status,
  onRetry,
}: {
  items: SalesPriorityCustomer[];
  status: "loading" | "empty" | "error" | "ready";
  onRetry?: () => void;
}) {
  return (
    <SalesCard title="重点客户">
      {status === "loading" && <SalesCardState kind="loading" message="" />}
      {status === "error" && (
        <SalesCardState
          kind="error"
          message="重点客户暂时无法加载"
          onRetry={onRetry}
        />
      )}
      {status === "empty" && (
        <SalesCardState
          kind="empty"
          message="暂无值得优先推进的客户。"
        />
      )}
      {status === "ready" && (
        <ul className="divide-y divide-[var(--border)]/70">
          {items.map((c) => (
            <li key={c.customerId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--foreground)]">
                    {c.customerName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                    {c.stageLabel}
                    {c.estimatedValue != null
                      ? ` · ${formatSalesMoney(c.estimatedValue)}`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                    {c.lastInteractionLabel}
                  </p>
                  {c.badge && (
                    <span className="mt-1.5 inline-flex rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">
                      {c.badge}
                    </span>
                  )}
                  <p className="mt-1 text-[12px] text-[var(--foreground)]">
                    建议：{c.suggestion}
                  </p>
                </div>
                <Link
                  href={`/sales/customers/${c.customerId}`}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--muted)]/10"
                >
                  查看
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SalesCard>
  );
}
