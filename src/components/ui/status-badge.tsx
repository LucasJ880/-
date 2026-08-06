import { cn } from "@/lib/utils";
import { statusInfo } from "@/lib/permissions-client";

export type StatusBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "pending"
  | "in-progress";

const TONE_STYLES: Record<StatusBadgeTone, string> = {
  neutral: "bg-foreground/[0.06] text-muted",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  pending: "bg-warning-bg text-warning",
  "in-progress": "bg-info-bg text-info",
};

const STATUS_TONES: Record<string, StatusBadgeTone> = {
  active: "success",
  completed: "success",
  executed: "success",
  approved: "success",
  inactive: "neutral",
  archived: "neutral",
  pending: "pending",
  awaiting_approval: "pending",
  queued: "pending",
  running: "in-progress",
  executing: "in-progress",
  in_progress: "in-progress",
  failed: "danger",
  rejected: "danger",
  expired: "danger",
  suspended: "danger",
  deleted: "danger",
};

export function StatusBadge({
  status,
  label,
  tone,
  showDot = false,
  className,
}: {
  status: string;
  /** 默认沿用既有 statusInfo 文案；需要展示业务别名时显式传入。 */
  label?: string;
  /** 显式语义优先于状态自动映射。 */
  tone?: StatusBadgeTone;
  showDot?: boolean;
  className?: string;
}) {
  const info = statusInfo(status);
  const resolvedTone = tone ?? STATUS_TONES[status];
  const resolvedLabel = label ?? info.label ?? status;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-4",
        resolvedTone ? TONE_STYLES[resolvedTone] : info.className,
        className
      )}
    >
      {showDot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
        />
      ) : null}
      {resolvedLabel}
    </span>
  );
}
