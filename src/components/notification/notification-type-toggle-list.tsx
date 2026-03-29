"use client";

import { cn } from "@/lib/utils";
import { NOTIFICATION_TYPE_KEYS } from "@/lib/notifications/constants";

const LABELS: Record<string, string> = {
  task_due: "任务截止与逾期",
  calendar_event: "日程与日历提醒",
  followup: "跟进提醒",
  project_update: "项目与配置变更",
  system: "系统通知（预留）",
  agent_task: "AI 任务通知",
  agent_approval: "AI 审批通知",
};

const HIDDEN_TYPES = new Set(["runtime_failed", "evaluation_low", "feedback"]);

interface Props {
  enabledTypes: string[];
  onChange: (types: string[]) => void;
  disabled?: boolean;
}

export function NotificationTypeToggleList({ enabledTypes, onChange, disabled }: Props) {
  const set = new Set(enabledTypes);

  const toggle = (key: string) => {
    if (disabled) return;
    const next = new Set(enabledTypes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size === 0) return;
    onChange([...next]);
  };

  return (
    <ul className="space-y-2">
      {NOTIFICATION_TYPE_KEYS.filter((key) => !HIDDEN_TYPES.has(key)).map((key) => {
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
              <span>{LABELS[key] ?? key}</span>
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
