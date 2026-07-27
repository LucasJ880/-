"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatISODateToronto,
  startOfDayToronto,
  toToronto,
} from "@/lib/time";

export type TimelineTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  project: { id: string; name: string; color: string } | null;
};

type Props = {
  tasks: TimelineTask[];
  onOpenTask?: (id: string) => void;
  /** 最多展示条数，避免拥挤 */
  maxBars?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "qy_task_timeline_open";
const LABEL_W = "w-[7.5rem] shrink-0 md:w-40";

function readOpen(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "0") return false;
  return true;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function shortMd(d: Date): string {
  const t = toToronto(d);
  return `${t.getMonth() + 1}.${String(t.getDate()).padStart(2, "0")}`;
}

function barTone(task: TimelineTask, today: Date): string {
  if (task.status === "done" || task.status === "cancelled") {
    return "bg-muted/30 border-border text-muted";
  }
  if (task.dueDate) {
    const due = startOfDayToronto(new Date(task.dueDate));
    if (due.getTime() < today.getTime()) {
      return "bg-danger/70 border-danger/40 text-white shadow-[0_0_12px_rgba(255,107,107,0.22)]";
    }
  }
  if (task.status === "in_progress" || task.priority === "urgent") {
    return "bg-accent border-accent/50 text-[color:var(--background)] shadow-[0_0_16px_color-mix(in_srgb,var(--accent)_40%,transparent)]";
  }
  if (task.priority === "high") {
    return "bg-warning/75 border-warning/40 text-[color:var(--background)]";
  }
  return "bg-[color:var(--text-secondary)]/25 border-border/80 text-foreground";
}

/**
 * 任务页横向时间表（参考甘特月份条）。
 * 数据现实：任务仅有 dueDate 点，条形用 createdAt→dueDate 作为可视化区间（非严格工期）。
 */
export function TaskTimelineStrip({
  tasks,
  onOpenTask,
  maxBars = 8,
}: Props) {
  const [open, setOpen] = useState(readOpen);

  const model = useMemo(() => {
    const today = startOfDayToronto();
    // 窗口：今天前 7 天 → 后 21 天（约一个月视野）
    const rangeStart = addDays(today, -7);
    const rangeEnd = addDays(today, 21);
    const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
    const dayCount = Math.round(rangeMs / DAY_MS) + 1;

    const dated = tasks
      .filter((t) => t.dueDate)
      .map((t) => {
        const due = startOfDayToronto(new Date(t.dueDate!));
        const created = startOfDayToronto(new Date(t.createdAt));
        const start =
          created.getTime() < due.getTime() ? created : addDays(due, -3);
        return { task: t, start, end: due };
      })
      .filter(({ end, start }) => {
        return (
          end.getTime() >= rangeStart.getTime() &&
          start.getTime() <= rangeEnd.getTime()
        );
      })
      .sort((a, b) => a.end.getTime() - b.end.getTime())
      .slice(0, maxBars);

    const days = Array.from({ length: dayCount }, (_, i) =>
      addDays(rangeStart, i),
    );

    const monthLabel = (() => {
      const mid = addDays(rangeStart, Math.floor(dayCount / 2));
      const t = toToronto(mid);
      return `${t.getFullYear()}年${t.getMonth() + 1}月`;
    })();

    const todayLeft =
      ((today.getTime() - rangeStart.getTime()) / rangeMs) * 100;
    const todayDay = toToronto(today).getDate();

    const bars = dated.map(({ task, start, end }) => {
      const s = clamp(start.getTime(), rangeStart.getTime(), rangeEnd.getTime());
      const e = clamp(end.getTime(), rangeStart.getTime(), rangeEnd.getTime());
      const left = ((s - rangeStart.getTime()) / rangeMs) * 100;
      const width = Math.max(((e - s) / rangeMs) * 100, 3.5);
      return {
        task,
        left,
        width,
        rangeLabel: `${shortMd(start)} - ${shortMd(end)}`,
        legend: task.project?.name || task.title,
      };
    });

    return {
      today,
      dayCount,
      days,
      monthLabel,
      todayLeft: clamp(todayLeft, 0, 100),
      todayDay,
      bars,
      totalDated: tasks.filter((t) => t.dueDate).length,
    };
  }, [tasks, maxBars]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg shadow-card">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent-soft/40"
      >
        <CalendarRange size={16} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">项目时间线</div>
          <p className="mt-0.5 text-xs text-muted">
            {model.totalDated > 0
              ? `显示 ${model.bars.length}/${model.totalDated} 项有截止日的任务`
              : "暂无带截止日期的任务"}
          </p>
        </div>
        <span className="hidden text-xs text-muted sm:inline">
          {model.monthLabel}
        </span>
        <span className="rounded-md border border-border bg-[color:var(--shell-main-bg)] px-2 py-0.5 text-[11px] text-muted">
          月
        </span>
        {open ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 pb-4 pt-3 md:px-4">
          {model.bars.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              为任务设置截止日期后，会在此显示时间条。
            </p>
          ) : (
            <>
              {/* 日期刻度：左空位对齐图例列 */}
              <div className="mb-1 flex items-end gap-2">
                <div className={LABEL_W} />
                <div className="relative flex h-7 min-w-0 flex-1 select-none">
                  {model.days.map((d, i) => {
                    const day = toToronto(d).getDate();
                    const isToday =
                      formatISODateToronto(d) ===
                      formatISODateToronto(model.today);
                    const show =
                      isToday ||
                      i === 0 ||
                      i === model.days.length - 1 ||
                      day === 1 ||
                      day % 2 === 0;
                    return (
                      <div
                        key={i}
                        className="flex flex-1 flex-col items-center justify-end"
                      >
                        {show && (
                          <span
                            className={cn(
                              "text-[10px] tabular-nums",
                              isToday
                                ? "font-semibold text-accent"
                                : "text-muted",
                            )}
                          >
                            {day}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 图例列 + 轨道 */}
              <div className="flex gap-2">
                <div className={cn(LABEL_W, "space-y-2 py-1")}>
                  {model.bars.map(({ task, legend }) => (
                    <button
                      key={`legend-${task.id}`}
                      type="button"
                      onClick={() => onOpenTask?.(task.id)}
                      className="flex h-8 w-full items-center gap-1.5 text-left"
                      title={task.title}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          task.status === "in_progress" ||
                            task.priority === "urgent"
                            ? "bg-accent shadow-[0_0_6px_var(--accent)]"
                            : "bg-muted",
                        )}
                      />
                      <span className="truncate text-[11px] text-text-secondary">
                        {legend}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="relative min-h-[1px] min-w-0 flex-1 rounded-[var(--radius-md)] border border-border/80 bg-[color:var(--shell-main-bg)] py-1 backdrop-blur-sm">
                  {/* 今日竖线 + 圆标 */}
                  <div
                    className="pointer-events-none absolute bottom-1 top-1 z-10"
                    style={{ left: `${model.todayLeft}%` }}
                    title={`今天 ${formatISODateToronto(model.today)}`}
                  >
                    <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-accent" />
                    <span className="absolute left-1/2 top-0 flex h-5 w-5 -translate-x-1/2 -translate-y-0.5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-[color:var(--background)] shadow-[0_0_10px_color-mix(in_srgb,var(--accent)_55%,transparent)]">
                      {model.todayDay}
                    </span>
                  </div>

                  <div className="relative z-[1] space-y-2 px-0.5">
                    {model.bars.map(({ task, left, width, rangeLabel }) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpenTask?.(task.id)}
                        className="group relative block h-8 w-full text-left"
                        title={`${task.title} · ${rangeLabel}`}
                      >
                        <span
                          className={cn(
                            "absolute top-1 flex h-6 items-center gap-1.5 overflow-hidden rounded-full border px-2.5 text-[11px] font-medium transition-transform group-hover:scale-[1.01]",
                            barTone(task, model.today),
                          )}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            minWidth: 72,
                          }}
                        >
                          <span className="truncate">{task.title}</span>
                          <span className="hidden shrink-0 opacity-80 sm:inline">
                            {rangeLabel}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                条形为「创建日 → 截止日」的可视化区间，不代表真实排工期。点击可打开任务。
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
