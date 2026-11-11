import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getPendingApprovals } from "@/lib/agent/approval";
import { listApprovalInbox } from "@/lib/approval/port";
import { resolveAssistantOrgId } from "@/lib/assistant/thread-org";
import { loadApprovalViewer } from "@/lib/approval/audience-server";

/**
 * GET /api/agent/approvals
 * 当前用户的待审批列表。
 *
 * A-P3：
 * - approvals 字段保留原步骤级审批结构（兼容现有前端）
 * - inbox 字段为 ApprovalPort 统一收件箱（PendingAction + ApprovalRequest 归一视图）
 *
 * VIS-1d：只含当前企业（resolveAssistantOrgId，与「待我确认」相同）、本人可见的；
 * 解析不出当前企业时只给本人的个人草稿。
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveAssistantOrgId(request, user);
  const orgId = orgRes.ok ? orgRes.orgId : null;
  const viewer = await loadApprovalViewer(user.id, orgId);
  const [approvals, inbox] = await Promise.all([
    getPendingApprovals(user.id, { orgId, viewer }),
    listApprovalInbox(user.id, { orgId, viewer }),
  ]);
  return NextResponse.json({ approvals, inbox });
});
