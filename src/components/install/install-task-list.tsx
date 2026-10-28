"use client";

/**
 * INSTALL-1：安装任务列表（手机优先）
 * — 按日期分组的列表 / 周视图切换；数据来自 /api/install/tasks
 * — 安装工只会拿到分配给自己的；运营 / 会计 / 老板看全企业
 * INSTALL-2d：全企业范围显示"返修单"入口；因维修单完成的任务标"需返修"
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, List, Loader2, MapPin, Wrench } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { groupByDay } from "@/lib/install/scope";
import {
  dayKey,
  fmtDay,
  fmtTime,
  INSTALL_STATUS_LABEL,
  type InstallTaskSummary,
} from "./install-types";

type View = "list" | "week";

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 周一为首
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function InstallTaskList() {
  const [view, setView] = useState<View>("list");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [tasks, setTasks] = useState<InstallTaskSummary[]>([]);
  const [scope, setScope] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 列表：今天前 7 天 ~ 后 30 天；周视图：当周
  const range = useMemo(() => {
    if (view === "week") {
      return { start: weekStart, end: addDays(weekStart, 7) };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return { start: addDays(today, -7), end: addDays(today, 30) };
  }, [view, weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
      const res = await apiFetch(`/api/install/tasks?${qs}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || (res.status === 403 ? "没有安装任务权限" : "加载失败"));
        setTasks([]);
        return;
      }
      const data = (await res.json()) as { scope: string; tasks: InstallTaskSummary[] };
      setTasks(data.tasks);
      setScope(data.scope);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupByDay(tasks), [tasks]);
  const todayKey = dayKey(new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Wrench size={20} className="text-accent" />
            安装任务
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            {scope === "org" ? "全企业安装排期" : "分配给我的安装任务"}
          </p>
          {scope === "org" && (
            <Link href="/install/repairs" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#a86a12]">
              <ClipboardList size={13} /> 返修单
            </Link>
          )}
        </div>
        <div className="flex rounded-lg border border-border bg-card-bg p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${view === "list" ? "bg-accent text-[color:var(--on-accent)]" : "text-muted"}`}
          >
            <List size={14} /> 列表
          </button>
          <button
            type="button"
            onClick={() => setView("week")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${view === "week" ? "bg-accent text-[color:var(--on-accent)]" : "text-muted"}`}
          >
            <CalendarDays size={14} /> 周视图
          </button>
        </div>
      </div>

      {view === "week" && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card-bg px-2 py-1.5 text-sm">
          <button
            type="button"
            aria-label="上一周"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded p-1 text-muted hover:text-foreground"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="font-medium text-foreground"
          >
            {weekStart.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} –{" "}
            {addDays(weekStart, 6).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
          </button>
          <button
            type="button"
            aria-label="下一周"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded p-1 text-muted hover:text-foreground"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] p-4 text-sm text-danger">
          {error}
        </div>
      ) : view === "week" ? (
        <WeekView weekStart={weekStart} tasks={tasks} todayKey={todayKey} />
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          这段时间没有安装任务
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((g) => (
            <section key={g.day}>
              <h2
                className={`mb-2 text-xs font-semibold ${g.day === todayKey ? "text-accent" : "text-muted"}`}
              >
                {fmtDay(g.items[0].startAt)}
                {g.day === todayKey ? " · 今天" : ""}
              </h2>
              <div className="space-y-2">
                {g.items.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]"
      : status === "in_progress"
        ? "bg-[rgba(201,138,34,0.12)] text-[#9a6a12]"
        : status === "cancelled"
          ? "bg-[rgba(166,61,61,0.08)] text-danger"
          : "bg-accent-soft text-accent";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {INSTALL_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TaskCard({ task }: { task: InstallTaskSummary }) {
  return (
    <Link
      href={`/install/${task.id}`}
      className="block rounded-xl border border-border bg-card-bg p-3.5 shadow-sm transition-colors active:bg-[rgba(43,96,85,0.04)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              {fmtTime(task.startAt)}–{fmtTime(task.endAt)}
            </span>
            <StatusPill status={task.status} />
          </div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{task.customer.name}</div>
          {task.address && (
            <div className="mt-0.5 flex items-start gap-1 text-xs text-muted">
              <MapPin size={12} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2">{task.address}</span>
            </div>
          )}
        </div>
        {task.order && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-[11px] text-muted">{task.order.code}</div>
            <div
              className={`mt-1 text-sm font-semibold ${task.order.allCompleted ? "text-[#2e7a56]" : "text-foreground"}`}
            >
              {task.order.completedCount}/{task.order.windowCount}
              <span className="ml-0.5 text-[11px] font-normal text-muted">窗</span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>安装：{task.assignedTo.name}</span>
        {task.order && task.order.issueCount > 0 && (
          <span className="rounded-full bg-[rgba(201,138,34,0.12)] px-1.5 py-0.5 text-[#a86a12]">
            {task.status === "completed" ? "需返修" : "有问题"} · {task.order.issueCount} 项
          </span>
        )}
      </div>
    </Link>
  );
}

function WeekView({
  weekStart,
  tasks,
  todayKey,
}: {
  weekStart: Date;
  tasks: InstallTaskSummary[];
  todayKey: string;
}) {
  const byDay = new Map<string, InstallTaskSummary[]>();
  for (const t of tasks) {
    const k = dayKey(new Date(t.startAt));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(t);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((d) => {
        const k = dayKey(d);
        const list = (byDay.get(k) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
        const isToday = k === todayKey;
        return (
          <div
            key={k}
            className={`rounded-xl border bg-card-bg p-2.5 ${isToday ? "border-accent" : "border-border"}`}
          >
            <div className={`mb-1.5 text-xs font-semibold ${isToday ? "text-accent" : "text-muted"}`}>
              {d.toLocaleDateString("zh-CN", { weekday: "short" })}{" "}
              <span className="font-normal">
                {d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
              </span>
            </div>
            {list.length === 0 ? (
              <div className="text-[11px] text-muted/70">—</div>
            ) : (
              <ul className="space-y-1">
                {list.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/install/${t.id}`}
                      className="block rounded-md bg-accent-soft px-2 py-1 text-xs text-foreground active:opacity-70"
                    >
                      <span className="font-mono font-medium text-accent">{fmtTime(t.startAt)}</span>{" "}
                      <span className="truncate">{t.customer.name}</span>
                      {t.order && (
                        <span className="ml-1 text-[10px] text-muted">
                          {t.order.completedCount}/{t.order.windowCount}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
