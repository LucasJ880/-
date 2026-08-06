import { cn } from "@/lib/utils";

/**
 * 统一页面标题区（Mobile-1：长标题可换行，操作按钮可落到下一行）。
 * 标题默认不使用 truncate / whitespace-nowrap。
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  secondaryActions,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  /** 主操作区；保留既有 actions 调用兼容。 */
  actions?: React.ReactNode;
  /** 低优先级操作；窄屏时自动换到下一行。 */
  secondaryActions?: React.ReactNode;
  /** 状态、更新时间等不触发操作的辅助信息。 */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {breadcrumbs ? (
          <div className="mb-1 min-w-0 overflow-x-auto text-xs text-muted [scrollbar-width:none]">
            <div className="inline-flex max-w-full items-center gap-1 whitespace-nowrap">
              {breadcrumbs}
            </div>
          </div>
        ) : null}
        <h1 className="break-words text-xl font-semibold leading-tight tracking-[-0.3px] text-foreground sm:text-2xl [overflow-wrap:anywhere]">
          {title}
        </h1>
        {description ? (
          <div className="mt-1 break-words text-[13px] leading-relaxed text-muted [overflow-wrap:anywhere]">
            {description}
          </div>
        ) : null}
        {meta ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
            {meta}
          </div>
        ) : null}
      </div>
      {actions || secondaryActions ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-max sm:items-end">
          {actions ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {actions}
            </div>
          ) : null}
          {secondaryActions ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {secondaryActions}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
