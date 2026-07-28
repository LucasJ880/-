"use client";

import { cn } from "@/lib/utils";

export function SalesTargetProgress({
  rate,
  className,
}: {
  rate: number | null;
  className?: string;
}) {
  const pct = rate ?? 0;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]/20">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <p className="text-[12px] text-[var(--muted)]">
        {rate != null ? `完成率 ${rate}%` : "尚未设置销售目标"}
      </p>
    </div>
  );
}
