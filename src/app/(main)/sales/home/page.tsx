"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { SalesHomeResponse } from "@/lib/sales/home";
import { SalesHomeHeader } from "@/components/sales-command-center/sales-home-header";
import { SalesHomeSkeleton } from "@/components/sales-command-center/sales-home-skeleton";
import { SalesPerformanceHero } from "@/components/sales-command-center/sales-performance-hero";
import { SalesPriorityList } from "@/components/sales-command-center/sales-priority-list";
import { SalesPriorityCustomers } from "@/components/sales-command-center/sales-priority-customers";
import { SalesTodayAppointments } from "@/components/sales-command-center/sales-today-appointments";
import { SalesFunnelSummary } from "@/components/sales-command-center/sales-funnel-summary";
import { SalesQuoteActivity } from "@/components/sales-command-center/sales-quote-activity";
import { SalesPaymentSummary } from "@/components/sales-command-center/sales-payment-summary";

type BlockStatus = "loading" | "empty" | "error" | "ready";

export default function SalesCommandCenterPage() {
  const [data, setData] = useState<SalesHomeResponse | null>(null);
  const [status, setStatus] = useState<BlockStatus>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await apiFetch("/api/sales/home");
      if (!res.ok) throw new Error(`home ${res.status}`);
      const json = (await res.json()) as SalesHomeResponse;
      setData(json);
      setStatus("ready");
    } catch {
      setData(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading" && !data) {
    return (
      <div className="mx-auto max-w-[1440px] bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.05),transparent_32%)]">
        <SalesHomeSkeleton />
      </div>
    );
  }

  if (status === "error" && !data) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 py-16">
        <h1 className="text-xl font-semibold">Sales Command Center</h1>
        <p className="text-[14px] text-[var(--muted)]">
          首页暂时无法加载，请稍后重试。
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[13px] text-[var(--on-accent)]"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!data) return null;

  const priorityStatus: BlockStatus =
    data.priorities.length === 0 ? "empty" : "ready";
  const customerStatus: BlockStatus =
    data.priorityCustomers.length === 0 ? "empty" : "ready";
  const apptStatus: BlockStatus =
    data.appointments.length === 0 ? "empty" : "ready";
  const funnelStatus: BlockStatus =
    data.funnel.every((f) => f.count === 0) ? "empty" : "ready";

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.05),transparent_32%)] pb-8">
      <SalesHomeHeader
        userName={data.userName}
        priorityCount={data.priorityTotal}
        completionRate={data.performance.completionRate}
      />

      <SalesPerformanceHero data={data} onTargetSaved={load} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1.2fr_1.2fr]">
        <SalesPriorityList
          items={data.priorities}
          total={data.priorityTotal}
          status={priorityStatus}
          onRetry={load}
        />
        <SalesPriorityCustomers
          items={data.priorityCustomers}
          status={customerStatus}
          onRetry={load}
        />
        <SalesTodayAppointments
          items={data.appointments}
          status={apptStatus}
          onRetry={load}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SalesFunnelSummary
          funnel={data.funnel}
          status={funnelStatus}
          onRetry={load}
        />
        <SalesQuoteActivity
          summary={data.quoteSummary}
          status="ready"
          onRetry={load}
        />
        <SalesPaymentSummary
          summary={data.paymentSummary}
          status="ready"
          onRetry={load}
          onChanged={load}
        />
      </div>
    </div>
  );
}
