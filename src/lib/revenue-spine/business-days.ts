/**
 * Revenue Spine — 工作日/工作小时计算
 *
 * 两种口径：
 *   - calendar 缺省 / null：V1 行为（UTC 周一至周五、全天计时；不含节假日表），逐位保持不变
 *   - calendar（policy.salesSla.businessHours）：组织当地时区的工作时段（如 09:00–18:00、周一至周五），
 *     只有时段内的时间计入；夏令时切换日按当地真实时刻计算
 *
 * SLA 分级提醒与 SLA 指标另用 addSlaMinutes / slaMinutesBetween：calendar 为 null 时按自然时间（墙钟），
 * 不是 UTC 工作日口径。
 */

import { getLocalTimeParts } from "@/lib/automation/local-time";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 日历推进的安全上限（天）：配置合法时远用不到，防止异常配置死循环 */
const MAX_CALENDAR_DAYS = 3660;

/** 组织工作时间（policy.salesSla.businessHours）。合法性由 policy 合并时校验 */
export interface BusinessCalendar {
  /** IANA 时区，如 Asia/Shanghai */
  timezone: string;
  /** 当地上班时间 "HH:MM" */
  start: string;
  /** 当地下班时间 "HH:MM"（晚于 start；"24:00" = 当天结束；不支持跨午夜班次） */
  end: string;
  /** 工作日，ISO 1..7（1 = 周一，7 = 周日） */
  workdays: number[];
}

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

/** 前进 days 个工作日；传入 calendar 时按组织当地日期与工作日、保持当地钟点 */
export function addBusinessDays(from: Date, days: number, calendar?: BusinessCalendar | null): Date {
  if (calendar) return addCalendarDays(from, days, calendar);
  const out = new Date(from.getTime());
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    out.setTime(out.getTime() + DAY_MS);
    if (isBusinessDay(out)) remaining -= 1;
  }
  return out;
}

/** 按小时前进，跨过周末（周末时间不计入）；传入 calendar 时只计组织当地工作时段 */
export function addBusinessHours(from: Date, hours: number, calendar?: BusinessCalendar | null): Date {
  if (calendar) return addCalendarMs(from, Math.round(Math.max(0, hours) * HOUR_MS), calendar);
  const out = new Date(from.getTime());
  let remainingMs = Math.max(0, hours) * HOUR_MS;
  // 若起点落在周末，先推进到下周一 00:00 UTC
  while (!isBusinessDay(out)) {
    out.setUTCHours(0, 0, 0, 0);
    out.setTime(out.getTime() + DAY_MS);
  }
  while (remainingMs > 0) {
    const endOfDay = new Date(out.getTime());
    endOfDay.setUTCHours(23, 59, 59, 999);
    const room = endOfDay.getTime() - out.getTime() + 1;
    if (remainingMs <= room) {
      out.setTime(out.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= room;
      out.setTime(endOfDay.getTime() + 1);
      while (!isBusinessDay(out)) out.setTime(out.getTime() + DAY_MS);
    }
  }
  return out;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / DAY_MS);
}

// ── SLA 口径（分级提醒 / 指标）：有日历按工作时间，无日历按自然时间 ──────────────

/** from 之后 minutes 分钟的时刻：有日历只计工作时段，无日历按自然时间 */
export function addSlaMinutes(from: Date, minutes: number, calendar: BusinessCalendar | null | undefined): Date {
  const ms = Math.round(Math.max(0, minutes) * MINUTE_MS);
  return calendar ? addCalendarMs(from, ms, calendar) : new Date(from.getTime() + ms);
}

/** from → to 经过的分钟数（可带小数）：有日历只计工作时段，无日历按自然时间；to 早于 from 时为 0 */
export function slaMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar | null | undefined): number {
  if (to.getTime() <= from.getTime()) return 0;
  const ms = calendar ? calendarMsBetween(from, to, calendar) : to.getTime() - from.getTime();
  return ms / MINUTE_MS;
}

// ── 日历内部实现 ───────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" → 当天分钟数；allow24 时接受 "24:00"。格式不对返回 null */
export function parseClockMinutes(value: unknown, allow24 = false): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0 && allow24) return 24 * 60;
  if (h > 23) return null;
  return h * 60 + min;
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 当地日期的 ISO 星期（1 = 周一 … 7 = 周日） */
function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** 某时刻在 timeZone 的「墙上时间」按 UTC 解读的毫秒数（精确到分钟） */
function wallMs(t: number, timeZone: string): number {
  const p = getLocalTimeParts(new Date(t), timeZone);
  return Date.parse(`${p.date}T${pad(p.hour)}:${pad(p.minute)}:00Z`);
}

/**
 * 当地日期 day 的 minuteOfDay 对应的 UTC 时刻（夏令时安全）。
 * 重叠（回拨，一个当地时刻出现两次）取较早的一次；空档（拨快，当地时刻不存在）取拨快后的对应时刻
 * （与 Temporal 的 "compatible" 消歧一致）。
 */
export function zonedLocalToUtc(day: string, minuteOfDay: number, timeZone: string): Date {
  const target = Date.parse(`${day}T00:00:00Z`) + minuteOfDay * MINUTE_MS;
  const c1 = target - (wallMs(target, timeZone) - target);
  const c2 = target - (wallMs(c1, timeZone) - c1);
  const valid = [c1, c2].filter((c) => wallMs(c, timeZone) === target);
  if (valid.length) return new Date(Math.min(...valid));
  return new Date(Math.max(c1, c2));
}

interface CalendarBounds {
  startMin: number;
  endMin: number;
  workdays: Set<number>;
}

function calendarBounds(calendar: BusinessCalendar): CalendarBounds | null {
  const startMin = parseClockMinutes(calendar.start);
  const endMin = parseClockMinutes(calendar.end, true);
  const workdays = new Set((calendar.workdays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
  if (startMin === null || endMin === null || endMin <= startMin || workdays.size === 0) return null;
  return { startMin, endMin, workdays };
}

/** 当地某天的工作时段 [start, end)（UTC 毫秒） */
function windowOf(day: string, bounds: CalendarBounds, timeZone: string): { start: number; end: number } {
  const start = zonedLocalToUtc(day, bounds.startMin, timeZone).getTime();
  const end =
    bounds.endMin >= 24 * 60 ? zonedLocalToUtc(nextDay(day), 0, timeZone).getTime() : zonedLocalToUtc(day, bounds.endMin, timeZone).getTime();
  return { start, end: Math.max(start, end) };
}

/** from 起只计工作时段，前进 ms 毫秒；ms = 0 时落到下一个工作时刻（已在时段内则原样返回） */
function addCalendarMs(from: Date, ms: number, calendar: BusinessCalendar): Date {
  const bounds = calendarBounds(calendar);
  // 配置非法（policy 合并已拦截，这里兜底）：退回自然时间
  if (!bounds) return new Date(from.getTime() + ms);
  let cursor = from.getTime();
  let remaining = Math.max(0, ms);
  let day = getLocalTimeParts(from, calendar.timezone).date;
  for (let i = 0; i < MAX_CALENDAR_DAYS; i++) {
    if (bounds.workdays.has(isoWeekday(day))) {
      const w = windowOf(day, bounds, calendar.timezone);
      if (cursor < w.start) cursor = w.start;
      if (cursor < w.end) {
        const room = w.end - cursor;
        if (remaining <= room) return new Date(cursor + remaining);
        remaining -= room;
        cursor = w.end;
      }
    }
    day = nextDay(day);
  }
  return new Date(cursor + remaining);
}

function calendarMsBetween(from: Date, to: Date, calendar: BusinessCalendar): number {
  const bounds = calendarBounds(calendar);
  if (!bounds) return Math.max(0, to.getTime() - from.getTime());
  const a = from.getTime();
  const b = to.getTime();
  let total = 0;
  let day = getLocalTimeParts(from, calendar.timezone).date;
  const lastDay = getLocalTimeParts(to, calendar.timezone).date;
  for (let i = 0; i < MAX_CALENDAR_DAYS; i++) {
    if (bounds.workdays.has(isoWeekday(day))) {
      const w = windowOf(day, bounds, calendar.timezone);
      const lo = Math.max(a, w.start);
      const hi = Math.min(b, w.end);
      if (hi > lo) total += hi - lo;
    }
    if (day === lastDay) break;
    day = nextDay(day);
  }
  return total;
}

/** 前进 days 个工作日（组织当地日期），保持当地钟点不变 */
function addCalendarDays(from: Date, days: number, calendar: BusinessCalendar): Date {
  const bounds = calendarBounds(calendar);
  // 配置非法（policy 合并已拦截，这里兜底）：退回 V1 口径
  if (!bounds) return addBusinessDays(from, days);
  let remaining = Math.max(0, Math.round(days));
  if (remaining === 0) return new Date(from.getTime());
  const p = getLocalTimeParts(from, calendar.timezone);
  const subMinute = from.getTime() - Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS;
  let day = p.date;
  for (let i = 0; i < MAX_CALENDAR_DAYS && remaining > 0; i++) {
    day = nextDay(day);
    if (bounds.workdays.has(isoWeekday(day))) remaining -= 1;
  }
  return new Date(zonedLocalToUtc(day, p.hour * 60 + p.minute, calendar.timezone).getTime() + subMinute);
}
