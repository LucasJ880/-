"use client";

import {
  TrendingUp,
  Bell,
  ChevronRight,
  PackageOpen,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MiniProgressBar } from "@/components/progress/mini-progress-bar";
import { RiskBadge } from "@/components/progress/risk-badge";
import type { ReminderSummaryData, ReminderItemData, Stats, ProjectProgressData, ProjectBreakdown } from "./types";

function ReminderSummaryCard({
  data,
  onItemClick,
  onConfirm,
  confirmingKey,
}: {
  data: ReminderSummaryData | null;
  onItemClick?: (item: ReminderItemData) => void;
  onConfirm?: (item: ReminderItemData) => void;
  confirmingKey?: string | null;
}) {
  if (!data || data.unreadCount === 0) return null;

  const overdueItems = data.immediate.filter((i) => i.type === "deadline");
  const todayDeadlines = data.today.filter((i) => i.type === "deadline");
  const todayEvents = [
    ...data.immediate.filter((i) => i.type === "event"),
    ...data.today.filter((i) => i.type === "event"),
  ];
  const followups = [...data.immediate, ...data.today, ...data.upcoming].filter(
    (i) => i.type === "followup"
  );

  const allItems = [...data.immediate, ...data.today].slice(0, 5);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card-bg shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Bell size={15} className="text-accent" />
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">今日提醒</h2>
        <span className="ml-auto text-[12px] text-muted tracking-[-0.01em]">
          {data.unreadCount} 条待处理
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {[
          {
            label: "逾期",
            value: overdueItems.length,
            color: overdueItems.length > 0 ? "text-danger" : "text-muted",
          },
          {
            label: "今天截止",
            value: todayDeadlines.length,
            color: todayDeadlines.length > 0 ? "text-warning" : "text-muted",
          },
          {
            label: "今日日程",
            value: todayEvents.length,
            color: todayEvents.length > 0 ? "text-accent" : "text-muted",
          },
          {
            label: "跟进",
            value: followups.length,
            color: followups.length > 0 ? "text-info" : "text-muted",
          },
        ].map((c) => (
          <div key={c.label} className="bg-card-bg px-5 py-3 text-center">
            <p className={cn("text-xl font-bold", c.color)}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-muted tracking-[-0.01em]">{c.label}</p>
          </div>
        ))}
      </div>

      {/* clickable reminder list */}
      {allItems.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {allItems.map((item) => {
            const isDeadline = item.type === "deadline";
            const isEvent = item.type === "event";
            const confirming = confirmingKey === item.sourceKey;
            return (
              <div
                key={item.sourceKey}
                className="flex w-full items-center gap-2 px-5 py-2.5 transition-all duration-150 hover:bg-accent-soft/60"
              >
                <button
                  type="button"
                  onClick={() => onItemClick?.(item)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      isDeadline && "bg-danger",
                      isEvent && "bg-accent",
                      !isDeadline && !isEvent && "bg-info"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-foreground tracking-[-0.01em]">{item.title}</p>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted tracking-[-0.01em]">
                      <span>{item.subtitle}</span>
                      {item.project && (
                        <>
                          <span>·</span>
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: item.project.color }}
                          />
                          <span>{item.project.name}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-muted/40" />
                </button>
                {onConfirm && (
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={() => onConfirm(item)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {confirming ? "…" : "知道了"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  stats: Stats;
  reminderSummary: ReminderSummaryData | null;
  onReminderClick?: (item: ReminderItemData) => void;
  onReminderConfirm?: (item: ReminderItemData) => void;
  confirmingReminderKey?: string | null;
  onProjectClick?: (projectId: string) => void;
}

export function DashboardStatsSection({
  stats,
  reminderSummary,
  onReminderClick,
  onReminderConfirm,
  confirmingReminderKey,
  onProjectClick,
}: Props) {
  const weekCards = [
    { label: "本周新增", value: stats.week.created, color: "text-accent" },
    {
      label: "本周完成",
      value: stats.week.completed,
      color: "text-success",
    },
    { label: "进行中", value: stats.week.active, color: "text-warning" },
    {
      label: "已逾期",
      value: stats.week.overdue,
      color:
        stats.week.overdue > 0 ? "text-danger" : "text-muted",
    },
  ];

  return (
    <>
      {(stats.pendingDispatchCount ?? 0) > 0 && (
        <Link
          href="/admin/project-intake"
          className="card-hover flex items-center gap-3 rounded-[var(--radius-lg)] border border-warning/25 bg-warning-bg p-4 shadow-card transition-all duration-150"
        >
          <div className="rounded-[var(--radius-md)] bg-warning-light p-2 text-warning">
            <PackageOpen size={20} />
          </div>
          <div>
            <p className="text-xl font-bold tracking-[-0.01em] text-warning">
              {stats.pendingDispatchCount}
            </p>
            <p className="text-[13px] font-medium text-muted tracking-[-0.01em]">待分发项目</p>
          </div>
          <ChevronRight size={16} className="ml-auto text-muted/40" />
        </Link>
      )}

      <div className="rounded-[var(--radius-lg)] border border-border bg-card-bg shadow-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <TrendingUp size={15} className="text-accent" />
          <h2 className="text-[13px] font-semibold tracking-[-0.01em]">经营节奏</h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {weekCards.map((w) => (
            <div key={w.label} className="bg-card-bg px-5 py-4 text-center">
              <p className={cn("text-2xl font-bold tracking-[-0.01em]", w.color)}>{w.value}</p>
              <p className="mt-0.5 text-[12px] text-muted tracking-[-0.01em]">{w.label}</p>
            </div>
          ))}
        </div>
        <WeekProjectProgress
          projectBreakdown={stats.projectBreakdown}
          projectProgress={stats.projectProgress}
          onProjectClick={onProjectClick}
        />
      </div>

      <ReminderSummaryCard
        data={reminderSummary}
        onItemClick={onReminderClick}
        onConfirm={onReminderConfirm}
        confirmingKey={confirmingReminderKey}
      />
    </>
  );
}

function WeekProjectProgress({
  projectBreakdown,
  projectProgress,
  onProjectClick,
}: {
  projectBreakdown: ProjectBreakdown[];
  projectProgress: Record<string, ProjectProgressData>;
  onProjectClick?: (projectId: string) => void;
}) {
  if (!projectProgress || Object.keys(projectProgress).length === 0) return null;

  const items = projectBreakdown
    .filter((p) => projectProgress[p.id])
    .slice(0, 6);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-border px-5 py-3">
      <p className="mb-2.5 text-[13px] font-medium text-muted tracking-[-0.01em]">项目推进</p>
      <div className="space-y-2.5">
        {items.map((p) => {
          const prog = projectProgress[p.id];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onProjectClick?.(p.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-all duration-150",
                onProjectClick && "hover:bg-accent-soft/60"
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground tracking-[-0.01em]">
                {p.name}
              </span>
              <div className="w-24 shrink-0">
                <MiniProgressBar
                  value={prog.taskProgress}
                  isOverdue={prog.isOverdue}
                  isAtRisk={prog.isAtRisk}
                />
              </div>
              {prog.weekDelta > 0 && (
                <span className="shrink-0 text-[11px] font-medium tracking-[-0.01em] text-success">
                  +{prog.weekDelta}%
                </span>
              )}
              {prog.isAtRisk && (
                <RiskBadge level={prog.riskLevel} isOverdue={prog.isOverdue} compact />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
