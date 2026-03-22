import { TIMEZONE, LOCALE } from "./constants";
import { isTodayToronto, isYesterdayToronto, isTomorrowToronto, toToronto, torontoDateStr } from "./core";

/* ═══════════════════════════════════════════════════════════════
   格式化（全部强制使用 America/Toronto）
   ═══════════════════════════════════════════════════════════════ */

function asDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}

/** "2026/03/18 14:30" */
export function formatDateTimeToronto(d: Date | string): string {
  return asDate(d).toLocaleString(LOCALE, {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2026/03/18" */
export function formatDateToronto(d: Date | string): string {
  return asDate(d).toLocaleDateString(LOCALE, {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** "2026年3月18日" */
export function formatDateLongToronto(d: Date | string): string {
  return asDate(d).toLocaleDateString(LOCALE, {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** "14:30" */
export function formatTimeToronto(d: Date | string): string {
  return asDate(d).toLocaleTimeString(LOCALE, {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3月18日 周三" */
export function formatDateDisplayToronto(d: Date | string): string {
  return asDate(d).toLocaleDateString(LOCALE, {
    timeZone: TIMEZONE,
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

/** "HH:mm" (24h, zero-padded) — 用于逻辑层（非展示） */
export function formatHHmmToronto(d: Date | string): string {
  const date = asDate(d);
  const t = toToronto(date);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/**
 * 智能相对时间：
 * - <1 min: "刚刚"
 * - <1 h: "X 分钟前"
 * - <24 h: "X 小时前"
 * - 今天: "今天 14:30"
 * - 昨天: "昨天 09:15"
 * - <7 d: "X 天前"
 * - else: "3/18"
 */
export function formatRelativeToronto(d: Date | string): string {
  const date = asDate(d);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;

  if (isTodayToronto(date)) return `今天 ${formatTimeToronto(date)}`;
  if (isYesterdayToronto(date)) return `昨天 ${formatTimeToronto(date)}`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;

  const t = toToronto(date);
  return `${t.getMonth() + 1}/${t.getDate()}`;
}

/**
 * 日期标签：返回 "今天" / "昨天" / "明天" / ""。
 */
export function formatDateLabelToronto(d: Date | string): string {
  if (isTodayToronto(d)) return "今天";
  if (isYesterdayToronto(d)) return "昨天";
  if (isTomorrowToronto(d)) return "明天";
  return "";
}

/** YYYY-MM-DD 字符串（Toronto 日期） */
export function formatISODateToronto(d: Date | string): string {
  return torontoDateStr(asDate(d));
}

/** 用于时间范围展示: "14:30 - 16:00" */
export function formatTimeRangeToronto(start: Date | string, end: Date | string): string {
  return `${formatTimeToronto(start)} - ${formatTimeToronto(end)}`;
}

/** 用于页面列表中的时间列: 今天显示时间，否则显示日期+时间 */
export function formatSmartDateTimeToronto(d: Date | string): string {
  const date = asDate(d);
  if (isTodayToronto(date)) return `今天 ${formatTimeToronto(date)}`;
  if (isYesterdayToronto(date)) return `昨天 ${formatTimeToronto(date)}`;
  if (isTomorrowToronto(date)) return `明天 ${formatTimeToronto(date)}`;
  return formatDateTimeToronto(date);
}
