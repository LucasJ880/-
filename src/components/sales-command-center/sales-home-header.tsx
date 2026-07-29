"use client";

import { greetingForHour } from "@/lib/sales/home";
import { SalesQuickActions } from "./sales-quick-actions";

export function SalesHomeHeader({
  userName,
  priorityCount,
  completionRate,
}: {
  userName: string;
  priorityCount: number;
  completionRate: number | null;
}) {
  const hour = new Date().getHours();
  const greet = greetingForHour(hour);
  const rateText =
    completionRate != null
      ? `本月销售目标已完成 ${completionRate}%。`
      : "本月销售目标尚未设置。";

  return (
    <header className="space-y-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Sales Command Center
        </p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[var(--foreground)] md:text-[28px]">
          {greet}，{userName}
        </h1>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-[var(--muted)]">
          聚焦客户推进、报价跟进与销售业绩。今天有 {priorityCount}{" "}
          项需要推进，{rateText}
        </p>
      </div>
      <SalesQuickActions />
    </header>
  );
}
