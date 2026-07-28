"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import {
  formatSalesMoney,
  type SalesHomeResponse,
} from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "@/components/sales-command-center/sales-card";
import { SalesMiniTrend } from "@/components/sales-command-center/sales-mini-trend";
import { SalesTargetProgress } from "@/components/sales-command-center/sales-target-progress";
import { SalesFunnelSummary } from "@/components/sales-command-center/sales-funnel-summary";
import { SalesHomeSkeleton } from "@/components/sales-command-center/sales-home-skeleton";

export default function SalesPerformancePage() {
  const [data, setData] = useState<SalesHomeResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await apiFetch("/api/sales/home");
      if (!res.ok) throw new Error("load failed");
      setData((await res.json()) as SalesHomeResponse);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1440px]">
        <SalesHomeSkeleton />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="mx-auto max-w-[1440px] py-12">
        <SalesCardState
          kind="error"
          message="我的业绩暂时无法加载"
          onRetry={load}
        />
      </div>
    );
  }

  const p = data.performance;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 pb-8">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Sales Command Center
        </p>
        <h1 className="text-[26px] font-semibold tracking-tight">我的业绩</h1>
        <p className="text-[14px] text-[var(--muted)]">
          仅展示你授权范围内的个人销售数据。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <SalesCard title="本月目标">
          <p className="text-[32px] font-semibold tracking-tight">
            {formatSalesMoney(p.signedAmount)}
          </p>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {p.targetAmount != null
              ? `目标 ${formatSalesMoney(p.targetAmount)}`
              : "尚未设置销售目标"}
          </p>
          <SalesTargetProgress rate={p.completionRate} className="mt-3" />
          <Link
            href="/sales/home"
            className="mt-3 inline-block text-[12px] text-[var(--accent)] hover:underline"
          >
            在首页设置目标
          </Link>
        </SalesCard>

        <SalesCard title="关键指标">
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            {[
              ["签单数量", `${p.signedCount} 单`],
              ["平均订单金额", formatSalesMoney(p.averageOrderValue)],
              ["本周新增", formatSalesMoney(p.weeklySignedAmount)],
              ["活跃商机", String(data.activity.activeOpportunities)],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded-xl border border-[var(--border)]/70 px-3 py-2"
              >
                <dt className="text-[11px] text-[var(--muted)]">{k}</dt>
                <dd className="mt-0.5 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <SalesMiniTrend points={data.trend} />
        </SalesCard>
      </div>

      <SalesFunnelSummary
        funnel={data.funnel}
        status={data.funnel.every((f) => f.count === 0) ? "empty" : "ready"}
        onRetry={load}
      />
    </div>
  );
}
