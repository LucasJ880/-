/**
 * GET /api/revenue/sla-metrics?days=30 — 首响 SLA 指标（询盘数 / 首响中位与 P90 / 24 小时内回复率 / 未回复 / 护栏拦截；
 * 展会速记卡单列，入驻测试询盘排除）。口径见 src/lib/revenue-spine/sla-metrics.ts。
 *
 * 组织由 resolveRevenueAccess 在服务端解析（activeOrg + 在职成员），不接受请求里的 orgId；days 只决定窗口（1–180 天）。
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { clampWindowDays, loadSlaMetrics } from "@/lib/revenue-spine/sla-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request);
  if (!access.ok) return access.response;
  const windowDays = clampWindowDays(request.nextUrl.searchParams.get("days"));
  const metrics = await loadSlaMetrics(access.orgId, { windowDays });
  return NextResponse.json(metrics);
}
