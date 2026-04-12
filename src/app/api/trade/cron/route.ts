/**
 * POST /api/trade/cron
 *
 * 每日定时任务入口
 * - Vercel Cron: 在 vercel.json 中配置 schedule
 * - 手动触发: POST 请求带 Authorization header
 *
 * 安全: 检查 CRON_SECRET 或用户角色
 */

import { NextRequest, NextResponse } from "next/server";
import { runDailyCron } from "@/lib/trade/cron-jobs";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    try {
      const { requireRole } = await import("@/lib/auth/guards");
      const auth = await requireRole(request, ["admin"]);
      if (auth instanceof NextResponse) return auth;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await runDailyCron();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
