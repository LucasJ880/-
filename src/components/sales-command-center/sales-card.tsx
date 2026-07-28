import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SalesCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:p-5",
        "transition-[box-shadow,transform] duration-200 motion-reduce:transition-none",
        "hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? (
            <h2 className="text-[15px] font-semibold text-[var(--foreground)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SalesCardState({
  kind,
  message,
  onRetry,
}: {
  kind: "loading" | "empty" | "error";
  message: string;
  onRetry?: () => void;
}) {
  if (kind === "loading") {
    return (
      <div className="space-y-2 py-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--muted)]/25" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--muted)]/20" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-[var(--muted)]/20" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 py-6 text-[13px] text-[var(--muted)]">
      <p>{message}</p>
      {kind === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--foreground)] hover:bg-[var(--muted)]/10"
        >
          重新加载
        </button>
      )}
    </div>
  );
}
