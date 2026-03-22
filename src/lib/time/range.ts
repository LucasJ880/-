import {
  startOfDayToronto,
  endOfDayToronto,
  startOfWeekToronto,
  endOfWeekToronto,
} from "./core";

/* ═══════════════════════════════════════════════════════════════
   日期范围生成（返回 UTC Date，可直接用于 Prisma 查询）
   ═══════════════════════════════════════════════════════════════ */

export interface DateRange {
  start: Date;
  end: Date;
}

export interface WeekRange {
  weekStart: Date;
  weekEnd: Date;
}

/** 今天（Toronto）的 UTC 范围 [00:00, 次日00:00) */
export function getTodayRangeToronto(): DateRange {
  return { start: startOfDayToronto(), end: endOfDayToronto() };
}

/** 本周（周一～周日，Toronto）的 UTC 范围 */
export function getWeekRangeToronto(): WeekRange {
  return { weekStart: startOfWeekToronto(), weekEnd: endOfWeekToronto() };
}

/** 最近 N 天的 UTC 范围（含今天） */
export function getLastNDaysRangeToronto(n: number): DateRange {
  const end = endOfDayToronto();
  const ref = new Date(Date.now() - (n - 1) * 86_400_000);
  return { start: startOfDayToronto(ref), end };
}

/** 最近 7 天 */
export function getLast7DaysRangeToronto(): DateRange {
  return getLastNDaysRangeToronto(7);
}

/** 最近 30 天 */
export function getLast30DaysRangeToronto(): DateRange {
  return getLastNDaysRangeToronto(30);
}

/** 明天（Toronto）的 UTC 范围 */
export function getTomorrowRangeToronto(): DateRange {
  const tomorrowRef = new Date(Date.now() + 86_400_000);
  return {
    start: startOfDayToronto(tomorrowRef),
    end: endOfDayToronto(tomorrowRef),
  };
}

/**
 * buildRange 的 Toronto 版本：构建"最近 N 天 + 前 N 天对比"范围。
 * 用于 Dashboard 趋势对比。
 */
export function buildDashboardRangeToronto(days: number) {
  const end = new Date();
  const startRef = new Date(end.getTime() - days * 86_400_000);
  const start = startOfDayToronto(startRef);

  const prevEndRef = new Date(start.getTime() - 1);
  const prevStartRef = new Date(prevEndRef.getTime() - days * 86_400_000);
  const prevStart = startOfDayToronto(prevStartRef);
  const prevEnd = start;

  return { start, end, prevStart, prevEnd, days };
}
