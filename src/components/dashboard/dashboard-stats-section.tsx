"use client";

import {
  CheckSquare,
  Clock,
  ListTodo,
  FolderKanban,
  TrendingUp,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReminderSummaryData, Stats } from "./types";

function ReminderSummaryCard({ data }: { data: ReminderSummaryData | null }) {
  if (!data || data.unreadCount === 0) return null;

  const overdueCount = data.immediate.filter((i) => i.type === "deadline")
    .length;
  const todayDeadlines = data.today.filter((i) => i.type === "deadline").length;
  const todayEvents =
    data.immediate.filter((i) => i.type === "event").length +
    data.today.filter((i) => i.type === "event").length;
  const followups = [...data.immediate, ...data.today, ...data.upcoming].filter(
    (i) => i.type === "followup"
  ).length;

  const nextEvent = [...data.immediate, ...data.today].find(
    (i) => i.type === "event"
  );

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
            value: overdueCount,
            color: overdueCount > 0 ? "text-red-600" : "text-slate-400",
          },
          {
            label: "今天截止",
            value: todayDeadlines,
            color:
              todayDeadlines > 0 ? "text-orange-600" : "text-slate-400",
          },
          {
            label: "今日日程",
            value: todayEvents,
            color: todayEvents > 0 ? "text-blue-600" : "text-slate-400",
          },
          {
            label: "跟进",
            value: followups,
            color: followups > 0 ? "text-purple-600" : "text-slate-400",
          },
        ].map((c) => (
          <div key={c.label} className="bg-card-bg px-5 py-3 text-center">
            <p className={cn("text-xl font-bold", c.color)}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-muted">{c.label}</p>
          </div>
        ))}
      </div>
      {nextEvent && (
        <div className="border-t border-border px-5 py-2.5">
          <p className="text-xs text-muted">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            下一个日程：
            <span className="font-medium text-foreground">
              {nextEvent.title}
            </span>
            <span className="ml-1.5 text-muted">{nextEvent.subtitle}</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function DashboardStatsSection({
  stats,
  reminderSummary,
}: {
  stats: Stats;
  reminderSummary: ReminderSummaryData | null;
}) {
  const summaryCards = [
    {
      label: "全部任务",
      value: stats.totalTasks,
      icon: ListTodo,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "待办",
      value: stats.todoCount,
      icon: Clock,
      color: "text-slate-600 bg-slate-50",
    },
    {
      label: "进行中",
      value: stats.inProgressCount,
      icon: CheckSquare,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "已完成",
      value: stats.doneCount,
      icon: CheckSquare,
      color: "text-green-600 bg-green-50",
    },
    {
      label: "项目数",
      value: stats.totalProjects,
      icon: FolderKanban,
      color: "text-purple-600 bg-purple-50",
    },
  ];

  const weekCards = [
    { label: "本周新增", value: stats.week.created, color: "text-blue-600" },
    {
      label: "本周完成",
      value: stats.week.completed,
      color: "text-green-600",
    },
    { label: "进行中", value: stats.week.active, color: "text-amber-600" },
    {
      label: "已逾期",
      value: stats.week.overdue,
      color:
        stats.week.overdue > 0 ? "text-red-600" : "text-slate-400",
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
          <div
            key={c.label}
            className="rounded-xl border border-border bg-card-bg p-4"
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
          </div>
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

      <ReminderSummaryCard data={reminderSummary} />
    </>
  );
}
