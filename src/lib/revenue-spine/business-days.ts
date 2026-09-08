/**
 * Revenue Spine — 工作日/工作小时计算（周一至周五；V1 不含节假日表）
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

export function addBusinessDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    out.setTime(out.getTime() + DAY_MS);
    if (isBusinessDay(out)) remaining -= 1;
  }
  return out;
}

/** 按小时前进，跨过周末（周末时间不计入） */
export function addBusinessHours(from: Date, hours: number): Date {
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
