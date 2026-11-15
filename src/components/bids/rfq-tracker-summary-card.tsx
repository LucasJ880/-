"use client";

/**
 * T-2 /bids 顶部「询价追踪」汇总卡：只有计数，不出现金额；点进 /bids/rfq。
 * 数字取自同一个追踪接口（summary=1：不算比价矩阵、不取审批信息，计数与整页相同）。读失败就不显示。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { summaryCardText, type TrackerSummary } from "@/lib/tender-rfq/tracker-pure";

export function RfqTrackerSummaryCard() {
  const [summary, setSummary] = useState<TrackerSummary | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/api/org/tender-rfq/tracker?summary=1")
      .then(async (res) => {
        if (!alive || !res.ok) return;
        const j = (await res.json()) as { summary?: TrackerSummary };
        if (j.summary) setSummary(j.summary);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!summary) return null;
  return <RfqTrackerSummaryCardView summary={summary} />;
}

export function RfqTrackerSummaryCardView({ summary }: { summary: TrackerSummary }) {
  return (
    <Link
      href="/bids/rfq"
      data-testid="rfq-tracker-summary-card"
      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-4 py-3 transition-colors hover:bg-[var(--background)]"
    >
      <span className="text-[14px] font-medium">{summaryCardText(summary)}</span>
      <span className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
        {summary.needsAction > 0 ? `需要我处理 ${summary.needsAction}` : "去看看"}
        <ArrowRight size={14} />
      </span>
    </Link>
  );
}
