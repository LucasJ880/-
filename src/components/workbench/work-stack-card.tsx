"use client";

import {
  AlertTriangle,
  CheckSquare,
  ClipboardList,
  FolderKanban,
  Bell,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkQueueItem } from "./types";

const KIND_ICON = {
  task_overdue: AlertTriangle,
  task_due_today: CheckSquare,
  task_in_progress: CheckSquare,
  project_risk: FolderKanban,
  reminder_followup: Bell,
  summary_overdue: AlertTriangle,
  summary_approvals: ShieldAlert,
  summary_dispatch: ClipboardList,
} as const;

type Props = {
  item: WorkQueueItem;
  selected: boolean;
  /** 0 = 前台可读；>0 仅层级 */
  depth: number;
  onSelect: () => void;
};

export function WorkStackCard({ item, selected, depth, onSelect }: Props) {
  const Icon = KIND_ICON[item.kind];
  const isFront = depth === 0;
  const isSummary = item.entityType === "summary";

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "absolute left-0 right-0 w-full rounded-[var(--radius-lg)] border text-left outline-none transition-[transform,opacity,box-shadow] duration-200 motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        selected
          ? "border-accent/50 bg-card-bg shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent),var(--shadow-card)]"
          : "border-border bg-card-bg shadow-card",
        !isFront && "pointer-events-none select-none",
      )}
      style={{
        transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.03})`,
        opacity: isFront ? 1 : Math.max(0.28, 0.72 - depth * 0.14),
        zIndex: 20 - depth,
      }}
    >
      <div
        className={cn(
          "flex items-start gap-3 px-4 py-3.5",
          !isFront && "blur-[0.3px]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
            selected || item.kind === "task_overdue" || item.kind.startsWith("summary_")
              ? "bg-accent-soft text-accent"
              : "bg-background text-muted",
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "truncate font-medium text-foreground",
                isFront ? "text-sm" : "text-xs",
              )}
            >
              {item.title}
            </p>
            {isSummary && item.summaryCount != null && (
              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                {item.summaryCount}
              </span>
            )}
          </div>
          {isFront && item.subtitle && (
            <p className="mt-0.5 truncate text-xs text-muted">{item.subtitle}</p>
          )}
          {isFront && item.projectName && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-text-quaternary">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: item.projectColor || "var(--muted)" }}
              />
              <span className="truncate">{item.projectName}</span>
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
