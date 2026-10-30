/**
 * POST /api/operations/publish-jobs/[id]/approve
 * 人工批准并派发。body: { orgId?, captionText? }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import {
  approveAndDispatchJob,
  canApprovePublishJob,
} from "@/lib/operations/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  // PERM-4b：operations.content.approve（运营主管 / 老板）；创建人不得自批（service 内判）
  if (!(await canApprovePublishJob(user, orgRes.orgId))) {
    return NextResponse.json(
      { error: "需要运营批准权限（运营主管或老板岗位）才能批准发布任务", code: "OPS_PERMISSION_REQUIRED" },
      { status: 403 },
    );
  }

  const result = await approveAndDispatchJob(orgRes.orgId, id, {
    editedCaption:
      typeof body.captionText === "string" ? body.captionText : undefined,
    actorUserId: user.id,
    isPlatformSuperAdmin: isPlatformSuperAdmin(user.role),
  });
  if (!result.ok) {
    // 自批被拒是权限问题（403），其余（状态不对 / 派发失败）仍 400
    const status = result.code === "SELF_APPROVAL" ? 403 : 400;
    return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, { status });
  }
  return NextResponse.json({ ok: true });
});
