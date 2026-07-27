"use client";

import { useMemo } from "react";
import { formatISODateToronto, startOfDayToronto, toToronto } from "@/lib/time";
import type { ProjectBreakdown, ProjectProgressData, ScheduleEvent } from "@/components/dashboard/types";
import { cn } from "@/lib/utils";

type Props = {
  scheduleEvents: ScheduleEvent[];
  projectBreakdown: ProjectBreakdown[];
  projectProgress: Record<string, ProjectProgressData>;
  onOpenProject?: (id: string) => void;
};

/**
 * 底部轻量时间轴：今日日程 + 有截止日期的风险/活跃项目点。
 * 仅展示真实 schedule / progress 数据。
 */
export function WorkbenchTimelineStrip({
  scheduleEvents,
  projectBreakdown,
  projectProgress,
  onOpenProject,
}: Props) {
  const model = useMemo(() => {
    const today = startOfDayToronto();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return startOfDayToronto(d);
    });

    const markers: {
      id: string;
      label: string;
      dayIndex: number;
      tone: "accent" | "danger" | "muted";
      projectId?: string;
    }[] = [];

    for (const ev of scheduleEvents.slice(0, 8)) {
      const day = startOfDayToronto(new Date(ev.startAt));
      const idx = days.findIndex(
        (d) => formatISODateToronto(d) === formatISODateToronto(day),
      );
      if (idx < 0) continue;
      markers.push({
        id: `ev-${ev.id}`,
        label: ev.title,
        dayIndex: idx,
        tone: ev.type === "task_due" ? "accent" : "muted",
        projectId: ev.projectId ?? undefined,
      });
    }

    for (const p of projectBreakdown) {
      const prog = projectProgress[p.id];
      if (!prog?.dueDate) continue;
      const day = startOfDayToronto(new Date(prog.dueDate));
      const idx = days.findIndex(
        (d) => formatISODateToronto(d) === formatISODateToronto(day),
      );
      if (idx < 0) continue;
      markers.push({
        id: `proj-${p.id}`,
        label: p.name,
        dayIndex: idx,
        tone: prog.isAtRisk || prog.isOverdue ? "danger" : "accent",
        projectId: p.id,
      });
    }

    return { days, markers: markers.slice(0, 12) };
  }, [scheduleEvents, projectBreakdown, projectProgress]);

  return (
    <section className="shrink-0 border-t border-border px-4 py-3 md:px-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted">近 7 日时间轴</p>
        <p className="text-[11px] text-text-quaternary">
          {formatISODateToronto(model.days[0])} 起
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {model.days.map((d, i) => {
          const dayMarkers = model.markers.filter((m) => m.dayIndex === i);
          const dayNum = toToronto(d).getDate();
          const isToday = i === 0;
          return (
            <div key={i} className="min-w-0">
              <div
                className={cn(
                  "mb-1 text-center text-[10px] tabular-nums",
                  isToday ? "font-semibold text-accent" : "text-muted",
                )}
              >
                {dayNum}
              </div>
              <div className="flex min-h-8 flex-col gap-0.5">
                {dayMarkers.slice(0, 2).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    title={m.label}
                    onClick={() => m.projectId && onOpenProject?.(m.projectId)}
                    className={cn(
                      "truncate rounded px-1 py-0.5 text-[9px] leading-tight",
                      m.tone === "accent" && "bg-accent-soft text-accent",
                      m.tone === "danger" && "bg-danger-bg text-danger",
                      m.tone === "muted" && "bg-background text-muted",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
