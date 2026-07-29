"use client";

import Link from "next/link";
import type { SalesHomeAppointment } from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "./sales-card";

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function SalesTodayAppointments({
  items,
  status,
  onRetry,
}: {
  items: SalesHomeAppointment[];
  status: "loading" | "empty" | "error" | "ready";
  onRetry?: () => void;
}) {
  return (
    <SalesCard
      title="今日预约"
      action={
        <Link
          href="/sales/calendar"
          className="text-[12px] text-[var(--accent)] hover:underline"
        >
          查看完整日历
        </Link>
      }
    >
      {status === "loading" && <SalesCardState kind="loading" message="" />}
      {status === "error" && (
        <SalesCardState
          kind="error"
          message="今日预约暂时无法加载"
          onRetry={onRetry}
        />
      )}
      {status === "empty" && (
        <SalesCardState kind="empty" message="今天没有更多预约。" />
      )}
      {status === "ready" && (
        <ul className="space-y-3">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex gap-3 rounded-xl border border-[var(--border)]/70 px-3 py-2.5"
            >
              <div className="w-12 shrink-0 text-[14px] font-semibold text-[var(--foreground)]">
                {formatTime(a.startAt)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--foreground)]">
                  {a.type}
                </p>
                {a.customerId ? (
                  <Link
                    href={`/sales/customers/${a.customerId}`}
                    className="text-[12px] text-[var(--accent)] hover:underline"
                  >
                    {a.customerName}
                  </Link>
                ) : (
                  <p className="text-[12px] text-[var(--muted)]">
                    {a.customerName}
                  </p>
                )}
                {a.location && (
                  <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                    {a.location}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SalesCard>
  );
}
