/**
 * POST /api/trade/cron
 *
 * 每日定时任务入口（跟进提醒、报价过期、无回复检测、页面监控等）。
 * 必须通过 CRON_SECRET + Authorization: Bearer，禁止无密钥或仅靠用户角色触发。
 */

import { NextRequest, NextResponse } from "next/server";
import { runDailyCron } from "@/lib/trade/cron-jobs";
import { requireTradeCronSecret } from "@/lib/trade/access";

export async function POST(request: NextRequest) {
  const denied = requireTradeCronSecret(request);
  if (denied) return denied;

  const result = await runDailyCron();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
