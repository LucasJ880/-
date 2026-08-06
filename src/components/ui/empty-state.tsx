import { type LucideIcon, Inbox } from "lucide-react";

export function EmptyState({
  icon: Icon = Inbox,
  title = "暂无数据",
  description,
  action,
  secondaryAction,
  size = "default",
}: {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  /** 兼容既有单一主操作。 */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  size?: "compact" | "default" | "page";
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[rgba(43,96,85,0.15)] bg-[rgba(43,96,85,0.02)] px-4 text-center ${
        size === "compact" ? "py-8" : size === "page" ? "min-h-[360px] py-20" : "py-16"
      }`}
    >
      <div
        className={`flex items-center justify-center rounded-2xl bg-[rgba(43,96,85,0.06)] ${
          size === "compact" ? "h-10 w-10" : "h-14 w-14"
        }`}
      >
        <Icon size={size === "compact" ? 20 : 28} className="text-[var(--accent)]/50" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
        )}
      </div>
      {action || secondaryAction ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
