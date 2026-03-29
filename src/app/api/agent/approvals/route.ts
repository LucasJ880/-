import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/agent/approval";

/**
 * GET /api/agent/approvals
 * 当前用户的待审批列表
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const approvals = await getPendingApprovals(user.id);
  return NextResponse.json({ approvals });
}
