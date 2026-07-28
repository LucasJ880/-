"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SalesPriorityItem as Item } from "@/lib/sales/home";

const LEVEL_META = {
  urgent: {
    label: "高优先",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
  important: {
    label: "重要",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  normal: {
    label: "普通",
    dot: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-300",
  },
} as const;

export function SalesPriorityItemRow({
  item,
  onPrimary,
}: {
  item: Item;
  onPrimary?: (item: Item) => void;
}) {
  const meta = LEVEL_META[item.level];
  const primaryIsGenerate =
    item.primaryAction.type.includes("email") ||
    item.category === "quote_pending" ||
    item.category === "viewed_not_signed" ||
    item.category === "followup_due";

  return (
    <article className="border-b border-[var(--border)]/70 py-3 last:border-0">
      <div className="flex items-start gap-2">
        <span
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.dot)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-[11px] font-medium", meta.text)}>
              {meta.label}
            </span>
            <span className="text-[13px] font-semibold text-[var(--foreground)]">
              {item.customerName}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--foreground)]">
            {item.title}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--muted)]">{item.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onPrimary?.(item)}
              className="inline-flex min-h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-[12px] font-medium text-[var(--on-accent)]"
            >
              {primaryIsGenerate ? "生成跟进消息" : item.primaryAction.label}
            </button>
            {item.secondaryAction?.href && (
              <Link
                href={item.secondaryAction.href}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] px-3 text-[12px] text-[var(--foreground)] hover:bg-[var(--muted)]/10"
              >
                {item.secondaryAction.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
