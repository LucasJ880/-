/**
 * POST /api/operations/publish-jobs/[id]/reject — 驳回 → canceled
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canApprovePublishJob } from "@/lib/operations/service";
import { transitionPublishJob } from "@/lib/operations/publish-events";
import { db } from "@/lib/db";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canApprovePublishJob(user.role)) {
    return NextResponse.json({ error: "无权驳回发布任务" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const job = await db.publishJob.findFirst({
    where: {
      id,
      orgId: orgRes.orgId,
      status: {
        in: [
          "pending_human_approval",
          "review",
          "blocked",
          "draft",
          "ai_reviewed",
          "needs_revision",
          "approved",
          "queued",
          "failed",
        ],
      },
    },
    select: { id: true, status: true },
  });
  if (!job) {
    return NextResponse.json({ error: "任务不存在或不可驳回" }, { status: 404 });
  }

  const result = await transitionPublishJob({
    orgId: orgRes.orgId,
    jobId: id,
    toStatus: "canceled",
    actorType: "user",
    actorId: user.id,
    reasonCode: "HUMAN_REJECT",
    reason: typeof body.reason === "string" ? body.reason : "人工驳回",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
