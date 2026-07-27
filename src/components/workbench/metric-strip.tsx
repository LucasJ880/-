"use client";

import type { ReminderSummaryData, Stats } from "@/components/dashboard/types";

type Props = {
  stats: Stats;
  reminderSummary: ReminderSummaryData | null;
  userName: string;
  orgEyebrow: string;
};

export function WorkbenchMetricStrip({
  stats,
  reminderSummary,
  userName,
  orgEyebrow,
}: Props) {
  const metrics = [
    {
      label: "活跃项目",
      value: stats.projectBreakdown.length,
      note: `共 ${stats.totalProjects} 个`,
    },
    {
      label: "在途事项",
      value: stats.todoCount + stats.inProgressCount,
      note: `${stats.inProgressCount} 推进中`,
    },
    {
      label: "本周闭环",
      value: stats.week.completed,
      note: `新增 ${stats.week.created}`,
    },
    {
      label: "待决策",
      value: reminderSummary?.unreadCount ?? 0,
      note:
        stats.week.overdue > 0
          ? `${stats.week.overdue} 项已逾期`
          : "暂无逾期",
      accent: stats.week.overdue > 0,
    },
  ];

  return (
    <section className="shrink-0 border-b border-border px-4 py-3 md:px-5">
      <div className="mb-3 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted">{orgEyebrow}</p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground md:text-xl">
            工作台
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted">
            {userName ? `${userName}，` : ""}今天最需要推进的事项
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-border bg-border md:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-card-bg px-3 py-2.5 md:px-4"
          >
            <p className="text-[11px] text-muted">{m.label}</p>
            <p
              className={`mt-0.5 text-xl font-semibold tabular-nums ${
                m.accent ? "text-accent" : "text-foreground"
              }`}
            >
              {m.value}
            </p>
            <p className="mt-0.5 text-[10px] text-text-quaternary">{m.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
