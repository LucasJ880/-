/**
 * POST /api/operations/content-plan/[id]/dispatch
 * 把已通过的选题关联视频资产并扇出发布任务。
 * body: { orgId?, assetId }
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";
import { fanoutAndDispatch } from "@/lib/operations/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权派发发布任务" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const assetId = String(body.assetId ?? "").trim();
  if (!assetId) {
    return NextResponse.json({ error: "assetId 不能为空" }, { status: 400 });
  }

  const item = await db.contentPlanItem.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!item) return NextResponse.json({ error: "选题不存在" }, { status: 404 });
  if (item.status !== "approved") {
    return NextResponse.json({ error: "只有已通过的选题可以扇出" }, { status: 409 });
  }
  const captionText = item.suggestedCaption?.trim();
  if (!captionText) {
    return NextResponse.json({ error: "选题缺少母版文案，请先补充" }, { status: 400 });
  }

  try {
    const result = await fanoutAndDispatch({
      orgId: orgRes.orgId,
      assetId,
      groupName: item.groupName,
      captionText,
      hashtags: item.hashtags ?? undefined,
      scheduledAt: item.plannedDate > new Date() ? item.plannedDate : undefined,
    });
    await db.contentPlanItem.update({
      where: { id: item.id },
      data: { status: "dispatched", assetId },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "派发失败" },
      { status: 400 },
    );
  }
});
