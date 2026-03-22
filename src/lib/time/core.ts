import { TIMEZONE } from "./constants";

/* ═══════════════════════════════════════════════════════════════
   核心时区转换
   ═══════════════════════════════════════════════════════════════ */

/**
 * 将任意 UTC Date 转换为"Toronto-local"Date 对象。
 * 返回的 Date 的 getFullYear/getMonth/getDate/getHours 等方法
 * 返回的是 Toronto 当地时间的分量。
 *
 * ⚠️ 注意：返回值的 getTime() 不是真实 UTC epoch，仅用于本地比较与格式化。
 */
export function toToronto(d: Date = new Date()): Date {
  return new Date(d.toLocaleString("en-US", { timeZone: TIMEZONE }));
}

/** 获取 Toronto 当前时间（Toronto-local Date） */
export function nowToronto(): Date {
  return toToronto(new Date());
}

/** 获取 Toronto 日期字符串 YYYY-MM-DD */
export function torontoDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

/** 获取 Toronto 时间分量（hour, minute） */
export function torontoTimeParts(d: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour: hour === 24 ? 0 : hour, minute };
}

/* ═══════════════════════════════════════════════════════════════
   日期边界（返回真实 UTC Date，可直接用于 DB 查询）
   ═══════════════════════════════════════════════════════════════ */

/**
 * 获取 ref 所在"Toronto 日"的 00:00:00 对应的 UTC Date。
 * 内部自动校正夏令时切换导致的偏差。
 */
export function startOfDayToronto(ref: Date = new Date()): Date {
  const toronto = toToronto(ref);
  const offset = ref.getTime() - toronto.getTime();
  toronto.setHours(0, 0, 0, 0);
  let result = new Date(toronto.getTime() + offset);

  const checkHour = toToronto(result).getHours();
  if (checkHour !== 0) {
    result = new Date(result.getTime() - checkHour * 3600_000);
  }
  return result;
}

/** 获取 ref 所在"Toronto 日"的次日 00:00:00 对应的 UTC Date */
export function endOfDayToronto(ref: Date = new Date()): Date {
  const start = startOfDayToronto(ref);
  const nextDay = new Date(start.getTime() + 86_400_000);
  const checkHour = toToronto(nextDay).getHours();
  if (checkHour !== 0) {
    return new Date(nextDay.getTime() - checkHour * 3600_000);
  }
  return nextDay;
}

/** 获取 ref 所在周的周一 00:00:00（Toronto） */
export function startOfWeekToronto(ref: Date = new Date()): Date {
  const toronto = toToronto(ref);
  const day = toronto.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const mondayRef = new Date(ref.getTime() - diffToMonday * 86_400_000);
  return startOfDayToronto(mondayRef);
}

/** 获取 ref 所在周的下周一 00:00:00（Toronto） */
export function endOfWeekToronto(ref: Date = new Date()): Date {
  const start = startOfWeekToronto(ref);
  const nextMon = new Date(start.getTime() + 7 * 86_400_000);
  const checkHour = toToronto(nextMon).getHours();
  if (checkHour !== 0) {
    return new Date(nextMon.getTime() - checkHour * 3600_000);
  }
  return nextMon;
}

/* ═══════════════════════════════════════════════════════════════
   业务判断
   ═══════════════════════════════════════════════════════════════ */

/** 判断日期是否为 Toronto 的"今天" */
export function isTodayToronto(d: Date | string): boolean {
  const target = typeof d === "string" ? new Date(d) : d;
  return torontoDateStr(target) === torontoDateStr(new Date());
}

/** 判断日期是否为 Toronto 的"昨天" */
export function isYesterdayToronto(d: Date | string): boolean {
  const target = typeof d === "string" ? new Date(d) : d;
  const yesterday = new Date(Date.now() - 86_400_000);
  return torontoDateStr(target) === torontoDateStr(yesterday);
}

/** 判断日期是否为 Toronto 的"明天" */
export function isTomorrowToronto(d: Date | string): boolean {
  const target = typeof d === "string" ? new Date(d) : d;
  const tomorrow = new Date(Date.now() + 86_400_000);
  return torontoDateStr(target) === torontoDateStr(tomorrow);
}

/** 截止时间是否已过 */
export function isOverdueToronto(deadline: Date | string): boolean {
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  return d.getTime() < Date.now();
}

/** 到截止日剩余天数（按 Toronto 日历日计算，可为负值表示逾期） */
export function daysRemainingToronto(deadline: Date | string): number {
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  const todayStart = startOfDayToronto();
  const targetStart = startOfDayToronto(d);
  return Math.round((targetStart.getTime() - todayStart.getTime()) / 86_400_000);
}
