import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  hint,
  unavailable,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-medium tabular-nums",
          unavailable && "text-muted",
        )}
      >
        {unavailable ? "n/a" : value}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
