/**
 * GET /api/cron/inquiry-sla
 *
 * Vercel Cron 每 5 分钟调用：
 *   - 启用首响分级的组织（policy.salesSla 配了任一档）：Revenue Spine 新询盘按 T+N 分钟提醒负责人、升级管理层、
 *     超时告知草稿状态（站内 + 微信；只提醒，不给买家发邮件）；15 分钟一档约 5 分钟内触发
 *   - 其余线程 / 未启用分级的组织：询盘 5 分钟未回复提醒外贸成员，24 小时未回复升级管理员（旧行为）
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
