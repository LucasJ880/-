import { type LucideIcon, Inbox } from "lucide-react";

export function EmptyState({
  icon: Icon = Inbox,
  title = "暂无数据",
  description,
  action,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[rgba(43,96,85,0.15)] bg-[rgba(43,96,85,0.02)] py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(43,96,85,0.06)]">
        <Icon size={28} className="text-[var(--accent)]/40" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
