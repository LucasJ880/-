/**
 * Visualizer 客户分享工具
 *
 * - 生成 token：使用 randomBytes(24) → 48 hex（足够长，避免可枚举）
 * - 默认 7 天有效期
 * - 公开页面读取/写偏好都需先校验 shareExpiresAt > now
 *
 * 与 SalesQuote.shareToken 共用同一思路，但独立字段，互不影响。
 */

import { randomBytes } from "node:crypto";

export const VISUALIZER_SHARE_DEFAULT_TTL_DAYS = 7;
export const VISUALIZER_SHARE_MAX_TTL_DAYS = 60;

export function generateVisualizerShareToken(): string {
  return randomBytes(24).toString("hex");
}

export function makeShareExpiresAt(days?: number): Date {
  const ttl = Math.min(
    Math.max(1, Math.floor(days ?? VISUALIZER_SHARE_DEFAULT_TTL_DAYS)),
    VISUALIZER_SHARE_MAX_TTL_DAYS,
  );
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ttl);
  return d;
}

export function isShareLive(token: string | null, expiresAt: Date | null): boolean {
  if (!token) return false;
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}
