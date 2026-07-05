import { NextRequest, NextResponse } from "next/server";
import { expireOverdueApprovals } from "@/lib/approval/port";

export const maxDuration = 60;

/**
 * GET /api/cron/approval-timeout
 *
 * 每 2 小时检查一次超时审批（A-P4：统一走 ApprovalPort）：
 * - 过期的 PendingAction 草稿 → 标记 failed（已过期）
 * - 超过 deadlineAt 的 pending 审批 → 标记为 escalated + 发通知
 * - 没有 deadlineAt 但超过 48 小时的 → 发提醒通知（幂等）
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const result = await expireOverdueApprovals(now);

  return NextResponse.json({
    checkedAt: now.toISOString(),
    expiredPendingActions: result.expiredPendingActions,
    escalatedCount: result.escalatedApprovals,
    staleCount: result.staleApprovals,
    remindedCount: result.remindedApprovals,
  });
}
