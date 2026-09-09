/**
 * RFC 7230 Server-Timing：只输出允许的 metric 名与毫秒。
 * 禁止 prompt / SQL / token / 用户数据。
 */

import type { TimingSnapshot } from "./timing";

export function formatServerTiming(snapshot: TimingSnapshot): string {
  return snapshot.marks
    .map((m) => `${m.name};dur=${m.durMs}`)
    .join(", ");
}

export function applyServerTiming(
  headers: Headers,
  snapshot: TimingSnapshot,
): void {
  const value = formatServerTiming(snapshot);
  if (!value) return;
  headers.set("Server-Timing", value);
}
