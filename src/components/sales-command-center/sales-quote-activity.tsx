"use client";

import Link from "next/link";
import { formatSalesMoney } from "@/lib/sales/home";
import type { SalesHomeResponse } from "@/lib/sales/home";
import { cn } from "@/lib/utils";
import { SalesCard, SalesCardState } from "./sales-card";

export function SalesQuoteActivity({
  summary,
  status,
  onRetry,
}: {
  summary: SalesHomeResponse["quoteSummary"];
  status: "loading" | "empty" | "error" | "ready";
  onRetry?: () => void;
}) {
  const rows = [
    {
      key: "viewed",
      label: "已查看未签约",
      href: "/sales/quotes?status=viewed",
      ...summary.viewedNotSigned,
      emphasize: true,
    },
    {
      key: "deposit",
      label: "已签约待定金",
      href: "/sales/quotes?status=signed",
      ...summary.signedPendingDeposit,
      emphasize: true,
    },
    {
      key: "expiring",
      label: "即将过期",
      href: "/sales/quotes?status=sent",
      ...summary.expiring,
      emphasize: true,
    },
    {
      key: "draft",
      label: "草稿待发送",
      href: "/sales/quotes?status=draft",
      ...summary.draft,
      emphasize: false,
    },
    {
      key: "sent",
      label: "已发送未查看",
      href: "/sales/quotes?status=sent",
      ...summary.sentNotViewed,
      emphasize: false,
    },
  ];

  return (
    <SalesCard title="报价动态">
      {status === "loading" && <SalesCardState kind="loading" message="" />}
      {status === "error" && (
        <SalesCardState
          kind="error"
          message="报价动态暂时无法加载"
          onRetry={onRetry}
        />
      )}
      {status === "ready" && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3 py-2.5 text-[13px] transition-colors",
                  row.emphasize && row.count > 0
                    ? "border-amber-200/80 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20"
                    : "border-[var(--border)]/70 hover:bg-[var(--muted)]/5",
                )}
              >
                <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
                  {row.emphasize && row.count > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  )}
                  {row.label}
                </span>
                <span className="text-[var(--muted)]">
                  {row.count} · {formatSalesMoney(row.amount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SalesCard>
  );
}
