/**
 * GET /api/cron/tender-rfq-inbound
 *
 * Vercel Cron 每 10 分钟：读询价发件邮箱的新回信（Gmail history 游标）→ 报价自动入 InquiryItem。
 * 鉴权方式：Bearer CRON_SECRET。只读邮件、不发任何邮件（追问是 P1-7）。
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
