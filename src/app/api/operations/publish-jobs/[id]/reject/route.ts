/**
 * POST /api/operations/publish-jobs/[id]/reject — 驳回（任务置为 canceled）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权审核发布任务" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const job = await db.publishJob.findFirst({
    where: { id, orgId: orgRes.orgId, status: { in: ["review", "blocked", "draft", "failed"] } },
    select: { id: true },
  });
  if (!job) {
    return NextResponse.json({ error: "任务不存在或不可驳回" }, { status: 404 });
  }
  await db.publishJob.update({
    where: { id },
    data: { status: "canceled" },
  });
  return NextResponse.json({ ok: true });
});
