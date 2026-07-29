/**
 * POST /api/operations/publish-jobs/[id]/approve
 * 人工批准并派发。body: { orgId?, captionText? }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  approveAndDispatchJob,
  canApprovePublishJob,
} from "@/lib/operations/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canApprovePublishJob(user.role)) {
    return NextResponse.json(
      { error: "仅 Boss/Admin 可批准发布任务（AI/运营不可批准）" },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const result = await approveAndDispatchJob(orgRes.orgId, id, {
    editedCaption:
      typeof body.captionText === "string" ? body.captionText : undefined,
    actorUserId: user.id,
    actorRole: user.role,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
