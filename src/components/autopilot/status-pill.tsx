import { cn } from "@/lib/utils";

export type ObservePillTone = "neutral" | "ok" | "warn" | "unknown" | "info";

const TONE: Record<ObservePillTone, string> = {
  neutral: "bg-foreground/[0.06] text-muted",
  ok: "bg-success-bg text-success",
  warn: "bg-warning-bg text-warning",
  unknown: "bg-foreground/[0.06] text-muted",
  info: "bg-info-bg text-info",
};

export function StatusPill({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: ObservePillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-4",
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
