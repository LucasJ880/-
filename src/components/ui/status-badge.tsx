import { cn } from "@/lib/utils";
import { statusInfo } from "@/lib/permissions-client";

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const info = statusInfo(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        info.className,
        className
      )}
    >
      {info.label}
    </span>
  );
}
