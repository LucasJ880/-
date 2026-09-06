/**
 * GET /api/cron/inquiry-sla
 *
 * Vercel Cron 每 10 分钟调用：询盘 5 分钟未回复提醒外贸成员，24 小时未回复升级管理员。
 * 鉴权方式：Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runInquirySla } from "@/lib/trade/inquiry-sla";
import { runTrackedAutomation } from "@/lib/automation/runner";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await runTrackedAutomation("inquiry-sla", async () => {
    const outcome = await runInquirySla();
    return { data: outcome, metadata: { result: JSON.stringify(outcome).slice(0, 4000) } };
  });
  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    ...result,
  });
}
