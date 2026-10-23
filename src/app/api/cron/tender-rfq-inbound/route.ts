/**
 * GET /api/cron/tender-rfq-inbound
 *
 * Vercel Cron 每 10 分钟：读询价发件邮箱的新回信（Gmail history 游标）→ 报价自动入 InquiryItem；
 * 同一次 tick 末尾跑 P1-7 催单扫描（超期未回 → 起草催单审批卡；缺字段 → 起草追问审批卡；催满两次 → 标未响应）。
 * 鉴权方式：Bearer CRON_SECRET。本路由不发任何邮件：催单 / 追问只建审批卡，批准后才发。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { syncAllOrgsInbound } from "@/lib/tender-rfq/inbound-sync";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("tender-rfq-inbound", async () => {
    const result = await syncAllOrgsInbound();
    const succeeded = result.orgs.reduce((n, o) => n + o.quoted + o.replied + o.unchanged, 0);
    const failed = result.orgs.reduce((n, o) => n + o.failed, 0);
    return {
      data: result,
      status: result.skipped ? "skipped" : undefined,
      succeededCount: succeeded,
      failedCount: failed,
      metadata: { result: JSON.stringify(result).slice(0, 4000) },
    };
  });
  return NextResponse.json({ scannedAt: new Date().toISOString(), ...data });
}
