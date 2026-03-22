"use client";

import {
  CheckSquare,
  Clock,
  Eye,
  AlertTriangle,
  Bell,
  Calendar,
  Star,
  FolderKanban,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "./types";
import { useState, useRef, useEffect } from "react";

const TYPE_ICONS: Record<string, typeof Bell> = {
  task_due: CheckSquare,
  calendar_event: Calendar,
  followup: Bell,
  runtime_failed: AlertTriangle,
  evaluation_low: AlertTriangle,
  feedback: Star,
  project_update: FolderKanban,
  project_dispatched: FolderKanban,
  system: Zap,
};

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "border-l-[#a63d3d]",
  high: "border-l-[#b06a28]",
  medium: "border-l-transparent",
  low: "border-l-transparent",
};

const STATUS_DOT: Record<string, string> = {
  unread: "bg-accent",
  read: "bg-transparent",
  done: "bg-[#2e7a56]",
  snoozed: "bg-[#9a6a2f]",
};

import { formatRelativeToronto } from "@/lib/time";

function formatTime(iso: string): string {
  return formatRelativeToronto(iso);
}

interface Props {
  item: NotificationItem;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onClick?: (item: NotificationItem) => void;
  onMarkRead?: (id: string) => void;
  onMarkDone?: (id: string) => void;
  onSnooze?: (id: string, preset: string) => void;
  compact?: boolean;
}

export function NotificationListItem({
  item,
  selected,
  onSelect,
  onClick,
  onMarkRead,
  onMarkDone,
  onSnooze,
  compact,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const Icon = TYPE_ICONS[item.type] ?? Bell;
  const isUnread = item.status === "unread";
  const isDone = item.status === "done";
  const isSnoozed = item.status === "snoozed";

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 border-l-2 px-4 py-3 transition-colors",
        PRIORITY_STYLES[item.priority] ?? "border-l-transparent",
        isUnread && "bg-[rgba(43,96,85,0.03)]",
        isDone && "opacity-60",
        !compact && "hover:bg-[rgba(43,96,85,0.04)]",
        compact && "py-2 px-3"
      )}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(item.id)}
          className="mt-1 shrink-0 accent-accent"
        />
      )}

      {/* status dot */}
      <div className="mt-1.5 shrink-0">
        <span className={cn("block h-2 w-2 rounded-full", STATUS_DOT[item.status] ?? "bg-transparent")} />
      </div>

      {/* icon */}
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUnread
            ? "bg-[rgba(43,96,85,0.10)] text-accent"
            : "bg-[rgba(110,125,118,0.08)] text-muted"
        )}
      >
        <Icon size={13} />
      </div>

      {/* content */}
      <button
        type="button"
        onClick={() => onClick?.(item)}
        className="min-w-0 flex-1 text-left"
      >
        <p className={cn("text-sm", isUnread ? "font-medium text-foreground" : "text-muted")}>
          {item.title}
        </p>
        {item.summary && !compact && (
          <p className="mt-0.5 truncate text-xs text-muted/70">{item.summary}</p>
        )}
        <p className="mt-0.5 text-[11px] text-muted/50">
          {formatTime(item.createdAt)}
          {isSnoozed && item.snoozeUntil && (
            <span className="ml-1.5 text-[#9a6a2f]">
              · 稍后提醒 {new Date(item.snoozeUntil).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </p>
      </button>

      {/* actions */}
      <div className={cn("flex shrink-0 items-center gap-0.5", !compact && "opacity-0 group-hover:opacity-100")}>
        {isUnread && onMarkRead && (
          <button
            type="button"
            onClick={() => onMarkRead(item.id)}
            title="标记已读"
            className="rounded p-1 text-muted transition-colors hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
          >
            <Eye size={13} />
          </button>
        )}
        {!isDone && onMarkDone && (
          <button
            type="button"
            onClick={() => onMarkDone(item.id)}
            title="标记完成"
            className="rounded p-1 text-muted transition-colors hover:bg-[rgba(46,122,86,0.08)] hover:text-[#2e7a56]"
          >
            <CheckSquare size={13} />
          </button>
        )}
        {!isDone && onSnooze && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              title="稍后提醒"
              className="rounded p-1 text-muted transition-colors hover:bg-[rgba(154,106,47,0.06)] hover:text-[#9a6a2f]"
            >
              <Clock size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
                {[
                  { key: "later_today", label: "3 小时后" },
                  { key: "tomorrow_morning", label: "明天上午" },
                  { key: "next_week", label: "下周" },
                ].map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      onSnooze(item.id, p.key);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[rgba(43,96,85,0.04)]"
                  >
                    <Clock size={12} className="text-muted" />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
