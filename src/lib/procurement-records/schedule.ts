/**
 * PROC-1 本地墙钟排程（纯函数，design D3）。
 *
 * 排程以本地时间表达（缺省周一、周四 08:00 America/Toronto）；用 Intl 求本地墙钟对应的 UTC 瞬间，
 * DST 切换日正确：不存在的本地时间（春季跳过）顺延到跳变后，重复的本地时间（秋季回拨）取第一次。
 * 槽位键用本地日期时间，跨 DST 稳定；不硬编码任何 UTC 偏移或日期。
 */

export interface WeeklySchedule {
  /** 0=周日 … 6=周六（JS 约定）；缺省 [1,4] = 周一、周四 */
  weekdays: number[];
  hour: number;
  minute: number;
}

export const DEFAULT_TIMEZONE = "America/Toronto";
export const DEFAULT_SCHEDULE: WeeklySchedule = { weekdays: [1, 4], hour: 8, minute: 0 };

export const WEEKDAY_LABELS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** 该瞬间在时区内相对 UTC 的偏移（分钟；Toronto 夏令时 -240，冬令时 -300） */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** 本地日期（YYYY-MM-DD） */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

export function addDaysToDate(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function weekdayOfDate(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 本地墙钟 → UTC 瞬间（DST 处理见文件头） */
export function zonedWallTimeToUtc(date: string, hour: number, minute: number, timeZone: string): Date {
  const { y, m, d } = parseDate(date);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offsets = new Set<number>([
    tzOffsetMinutes(new Date(guess - 12 * 3600_000), timeZone),
    tzOffsetMinutes(new Date(guess), timeZone),
    tzOffsetMinutes(new Date(guess + 12 * 3600_000), timeZone),
  ]);
  const valid: number[] = [];
  for (const off of offsets) {
    const t = guess - off * 60_000;
    const p = localParts(new Date(t), timeZone);
    if (p.year === y && p.month === m && p.day === d && p.hour === hour && p.minute === minute) valid.push(t);
  }
  if (valid.length > 0) return new Date(Math.min(...valid));
  // 不存在的本地时间（春季跳过）：用跳变前偏移，落在跳变之后
  const before = tzOffsetMinutes(new Date(guess - 12 * 3600_000), timeZone);
  return new Date(guess - before * 60_000);
}

export interface ScheduleSlot {
  slotAt: Date;
  localDate: string;
  slotKey: string;
}

export function scheduledSlotKey(localDate: string, schedule: WeeklySchedule, timeZone: string): string {
  const hh = String(schedule.hour).padStart(2, "0");
  const mm = String(schedule.minute).padStart(2, "0");
  return `scheduled:${localDate}T${hh}:${mm}@${timeZone}`;
}

function slotFor(date: string, schedule: WeeklySchedule, timeZone: string): ScheduleSlot {
  return {
    slotAt: zonedWallTimeToUtc(date, schedule.hour, schedule.minute, timeZone),
    localDate: date,
    slotKey: scheduledSlotKey(date, schedule, timeZone),
  };
}

/** 最近一个已到期（slotAt ≤ now）的槽位；排程无工作日 → null */
export function latestDueSlot(now: Date, schedule: WeeklySchedule, timeZone: string): ScheduleSlot | null {
  if (schedule.weekdays.length === 0) return null;
  const today = localDateOf(now, timeZone);
  for (let back = 0; back <= 7; back++) {
    const date = addDaysToDate(today, -back);
    if (!schedule.weekdays.includes(weekdayOfDate(date))) continue;
    const slot = slotFor(date, schedule, timeZone);
    if (slot.slotAt.getTime() <= now.getTime()) return slot;
  }
  return null;
}

/** 下一个槽位（slotAt > now） */
export function nextSlot(now: Date, schedule: WeeklySchedule, timeZone: string): ScheduleSlot | null {
  if (schedule.weekdays.length === 0) return null;
  const today = localDateOf(now, timeZone);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const date = addDaysToDate(today, ahead);
    if (!schedule.weekdays.includes(weekdayOfDate(date))) continue;
    const slot = slotFor(date, schedule, timeZone);
    if (slot.slotAt.getTime() > now.getTime()) return slot;
  }
  return null;
}

/**
 * 当前是否有到期且未运行的槽位：只看最近一个到期槽位（不批量补跑历史），且槽位须晚于启用时间。
 */
export function dueSlot(input: {
  now: Date;
  schedule: WeeklySchedule;
  timeZone: string;
  enabledAt: Date | null;
  existingSlotKeys: ReadonlySet<string>;
}): ScheduleSlot | null {
  const latest = latestDueSlot(input.now, input.schedule, input.timeZone);
  if (!latest) return null;
  if (!input.enabledAt || latest.slotAt.getTime() < input.enabledAt.getTime()) return null;
  if (input.existingSlotKeys.has(latest.slotKey)) return null;
  return latest;
}

/** 中文排程描述（如「每周一、周四 08:00（America/Toronto），由每小时 :25 的定时任务在其后首次执行」） */
export function describeSchedule(schedule: WeeklySchedule, timeZone: string): string {
  const days = [...schedule.weekdays].sort().map((d) => WEEKDAY_LABELS_ZH[d] ?? `?${d}`).join("、");
  const hh = String(schedule.hour).padStart(2, "0");
  const mm = String(schedule.minute).padStart(2, "0");
  return `每${days} ${hh}:${mm}（${timeZone}）；由每小时 :25 的既有定时任务在该时刻后首次执行`;
}

/** 本地时间展示（YYYY-MM-DD HH:mm 时区） */
export function formatLocal(instant: Date | string | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!instant) return "—";
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "—";
  const p = localParts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
