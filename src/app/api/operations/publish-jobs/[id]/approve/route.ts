/**
 * POST /api/operations/publish-jobs/[id]/approve
 * 审核通过并派发。body: { orgId?, captionText?（可选改写，blocked 任务必须改写） }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";
import { approveAndDispatchJob } from "@/lib/operations/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权审核发布任务" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const result = await approveAndDispatchJob(
    orgRes.orgId,
    id,
    typeof body.captionText === "string" ? body.captionText : undefined,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
