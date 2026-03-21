"use client";

import {
  CheckSquare,
  Clock,
  ListTodo,
  FolderKanban,
  TrendingUp,
  Bell,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ReminderSummaryData, ReminderItemData, Stats } from "./types";

function ReminderSummaryCard({
  data,
  onItemClick,
}: {
  data: ReminderSummaryData | null;
  onItemClick?: (item: ReminderItemData) => void;
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

  const nextEvent = [...data.immediate, ...data.today].find(
    (i) => i.type === "event"
  );

  const allItems = [...data.immediate, ...data.today].slice(0, 5);

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Bell size={15} className="text-accent" />
        <h2 className="font-semibold">今日提醒</h2>
        <span className="ml-auto text-xs text-muted">
          {data.unreadCount} 条待处理
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {[
          {
            label: "逾期",
            value: overdueItems.length,
            color: overdueItems.length > 0 ? "text-[#a63d3d]" : "text-[#8a9590]",
          },
          {
            label: "今天截止",
            value: todayDeadlines.length,
            color: todayDeadlines.length > 0 ? "text-[#b06a28]" : "text-[#8a9590]",
          },
          {
            label: "今日日程",
            value: todayEvents.length,
            color: todayEvents.length > 0 ? "text-[#2b6055]" : "text-[#8a9590]",
          },
          {
            label: "跟进",
            value: followups.length,
            color: followups.length > 0 ? "text-[#805078]" : "text-[#8a9590]",
          },
        ].map((c) => (
          <div key={c.label} className="bg-card-bg px-5 py-3 text-center">
            <p className={cn("text-xl font-bold", c.color)}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-muted">{c.label}</p>
          </div>
        ))}
      </div>

      {/* clickable reminder list */}
      {allItems.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {allItems.map((item) => {
            const isDeadline = item.type === "deadline";
            const isEvent = item.type === "event";
            const hasProject = !!(item.projectId || item.project);

            return (
              <button
                key={item.sourceKey}
                type="button"
                onClick={() => onItemClick?.(item)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[rgba(43,96,85,0.03)]"
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    isDeadline && "bg-[#a63d3d]",
                    isEvent && "bg-[#2b6055]",
                    !isDeadline && !isEvent && "bg-[#805078]"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{item.title}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted">
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
}

export function DashboardStatsSection({ stats, reminderSummary, onReminderClick }: Props) {
  const summaryCards = [
    {
      label: "全部任务",
      value: stats.totalTasks,
      icon: ListTodo,
      color: "text-[#2b6055] bg-[rgba(43,96,85,0.04)]",
      href: "/tasks",
    },
    {
      label: "待办",
      value: stats.todoCount,
      icon: Clock,
      color: "text-[#6e7d76] bg-[rgba(110,125,118,0.06)]",
      href: "/tasks?status=todo",
    },
    {
      label: "进行中",
      value: stats.inProgressCount,
      icon: CheckSquare,
      color: "text-[#9a6a2f] bg-[rgba(154,106,47,0.04)]",
      href: "/tasks?status=in_progress",
    },
    {
      label: "已完成",
      value: stats.doneCount,
      icon: CheckSquare,
      color: "text-[#2e7a56] bg-[rgba(46,122,86,0.04)]",
      href: "/tasks?status=done",
    },
    {
      label: "项目数",
      value: stats.totalProjects,
      icon: FolderKanban,
      color: "text-[#805078] bg-[rgba(128,80,120,0.04)]",
      href: "/projects",
    },
  ];

  const weekCards = [
    { label: "本周新增", value: stats.week.created, color: "text-[#2b6055]" },
    {
      label: "本周完成",
      value: stats.week.completed,
      color: "text-[#2e7a56]",
    },
    { label: "进行中", value: stats.week.active, color: "text-[#9a6a2f]" },
    {
      label: "已逾期",
      value: stats.week.overdue,
      color:
        stats.week.overdue > 0 ? "text-[#a63d3d]" : "text-[#8a9590]",
    },
  ];

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">工作台</h1>
        <p className="mt-1 text-sm text-muted">欢迎回来，这是您的工作概览</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summaryCards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border border-border bg-card-bg p-4 transition-all hover:border-[rgba(43,96,85,0.2)] hover:shadow-[var(--shadow-card)]"
          >
            <div className="flex items-center gap-3">
              <div className={cn("rounded-lg p-2", c.color)}>
                <c.icon size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold">{c.value}</p>
                <p className="text-xs text-muted">{c.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <TrendingUp size={15} className="text-accent" />
          <h2 className="font-semibold">本周进度</h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {weekCards.map((w) => (
            <div key={w.label} className="bg-card-bg px-5 py-4 text-center">
              <p className={cn("text-2xl font-bold", w.color)}>{w.value}</p>
              <p className="mt-0.5 text-xs text-muted">{w.label}</p>
            </div>
          ))}
        </div>
      </div>

      <ReminderSummaryCard data={reminderSummary} onItemClick={onReminderClick} />
    </>
  );
}
