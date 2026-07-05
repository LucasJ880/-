import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getPendingApprovals } from "@/lib/agent/approval";
import { listApprovalInbox } from "@/lib/approval/port";

/**
 * GET /api/agent/approvals
 * 当前用户的待审批列表。
 *
 * A-P3：
 * - approvals 字段保留原步骤级审批结构（兼容现有前端）
 * - inbox 字段为 ApprovalPort 统一收件箱（PendingAction + ApprovalRequest 归一视图）
 */
export const GET = withAuth(async (_request, _ctx, user) => {
  const [approvals, inbox] = await Promise.all([
    getPendingApprovals(user.id),
    listApprovalInbox(user.id),
  ]);
  return NextResponse.json({ approvals, inbox });
});
