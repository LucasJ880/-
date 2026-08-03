/**
 * GET /api/cron/service-inbox-sla
 *
 * Vercel Cron 每 10 分钟调用：扫描客服会话未回复超时并推送提醒。
 * 鉴权方式：Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runServiceInboxSla } from "@/lib/service-inbox/service";
import { runTrackedAutomation } from "@/lib/automation/runner";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await runTrackedAutomation("service-inbox-sla", async () => {
    const outcome = await runServiceInboxSla();
    return { data: outcome, metadata: { result: JSON.stringify(outcome).slice(0, 4000) } };
  });
  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    ...result,
  });
}
