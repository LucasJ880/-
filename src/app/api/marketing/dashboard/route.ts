import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { getMarketingDashboard } from "@/lib/marketing/query-dashboard";
import { canDecideTeamApproval } from "@/lib/marketing/team";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const dashboard = await getMarketingDashboard(orgRes.orgId);
  const pendingTeamApprovals = await Promise.all(dashboard.pendingTeamApprovals.map(async (approval) => ({
    ...approval,
    canApprove: await canDecideTeamApproval({
      createdById: approval.requester.id,
      orgId: orgRes.orgId,
      projectId: approval.projectId,
      approverUserId: approval.approver?.id ?? null,
    }, { userId: user.id, role: user.role, orgId: orgRes.orgId }),
  })));
  return NextResponse.json({ ...dashboard, pendingTeamApprovals });
});
