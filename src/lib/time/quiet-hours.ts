import { TIMEZONE } from "./constants";
import { torontoTimeParts } from "./core";

/**
 * 判断当前时间（Toronto）是否处于静默时段。
 * start/end 格式为 "HH:mm"，支持跨午夜（如 "22:00" ~ "08:00"）。
 */
export function isInQuietHoursToronto(
  start: string | null,
  end: string | null,
  enabled: boolean,
  now: Date = new Date()
): boolean {
  if (!enabled || !start || !end) return false;

  const { hour, minute } = torontoTimeParts(now);
  const cur = hour * 60 + minute;

  const toMinutes = (s: string) => {
    const [h, m] = s.split(":").map((x) => parseInt(x, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };

  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === b) return false;
  if (a < b) return cur >= a && cur < b;
  return cur >= a || cur < b;
}
