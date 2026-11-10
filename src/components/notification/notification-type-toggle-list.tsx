"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/notifications/constants";
import { toggleEnabledType, visibleNotificationTypes } from "@/lib/notifications/type-visibility";
import { useNavigationAccess } from "@/lib/navigation/use-navigation-access";

interface Props {
  enabledTypes: string[];
  onChange: (types: string[]) => void;
  disabled?: boolean;
}

export function NotificationTypeToggleList({ enabledTypes, onChange, disabled }: Props) {
  const set = new Set(enabledTypes);
  // VIS-1c：只列处理页面对当前用户放行的类型（notifications/type-visibility）；判定输入未就绪时不先列全量
  const { ready, failed, retry, canOpen } = useNavigationAccess();

  const toggle = (key: string) => {
    if (disabled) return;
    // 增删作用在完整的已开启集合上：列表里不出现的类型原样提交，偏好不变
    const next = toggleEnabledType(enabledTypes, key);
    if (next) onChange(next);
  };

  if (!ready && failed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm text-muted">
        <span>通知类型加载失败</span>
        <button type="button" onClick={retry} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-muted/5">
          重试
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex items-center gap-2 px-1 py-3 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        加载通知类型…
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {visibleNotificationTypes(canOpen).map((key) => {
        const on = set.has(key);
        return (
          <li key={key}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(key)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                on
                  ? "border-accent/25 bg-[rgba(43,96,85,0.04)] text-foreground"
                  : "border-border bg-background/50 text-muted",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              <span>{NOTIFICATION_TYPE_LABELS[key] ?? key}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  on ? "bg-accent/15 text-accent" : "bg-[rgba(110,125,118,0.08)] text-muted"
                )}
              >
                {on ? "已开启" : "已关闭"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
