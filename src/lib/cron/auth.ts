/**
 * Cron 路由统一鉴权（/api/cron/* 与 /api/trade/cron 共用）
 *
 * - CRON_SECRET 未配置 → 503（拒绝执行而非放行）
 * - Authorization 必须与 `Bearer <secret>` 完全一致；
 *   sha256 摘要后 timingSafeEqual，恒定时间比较，不因长度不同短路
 * - 仅认 Authorization 请求头，其他来源的 secret 一律不采信
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** SHA-256 摘要后比较，避免 timingSafeEqual 等长限制，且不先做明文长度短路。 */
function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * 校验 cron 请求；通过返回 null，拒绝返回 503/401 响应。
 * 用法：`const denied = requireCronSecret(request); if (denied) return denied;`
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 未配置，拒绝执行定时任务" },
      { status: 503 },
    );
  }
  const expected = `Bearer ${secret}`;
  const actual = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
