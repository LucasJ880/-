import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getPendingApprovals } from "@/lib/agent/approval";

/**
 * GET /api/agent/approvals
 * 当前用户的待审批列表
 */
export const GET = withAuth(async (_request, _ctx, user) => {
  const approvals = await getPendingApprovals(user.id);
  return NextResponse.json({ approvals });
});
