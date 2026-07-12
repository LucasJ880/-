/**
 * POST /api/operations/video-assets/[id]/fanout
 * 把一条视频扇出为账号组的发布任务并派发。
 * body: { orgId?, groupName? | accountIds?, captionText, hashtags?, scheduledAt? }
 */

import { NextResponse } from "next/server";
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

  const captionText = String(body.captionText ?? "").trim();
  if (!captionText) {
    return NextResponse.json({ error: "captionText 不能为空" }, { status: 400 });
  }
  const groupName = body.groupName ? String(body.groupName).trim() : undefined;
  const accountIds = Array.isArray(body.accountIds)
    ? body.accountIds.filter((x: unknown): x is string => typeof x === "string")
    : undefined;
  if (!groupName && !accountIds?.length) {
    return NextResponse.json({ error: "需指定 groupName 或 accountIds" }, { status: 400 });
  }

  let scheduledAt: Date | undefined;
  if (body.scheduledAt) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "scheduledAt 非法" }, { status: 400 });
    }
    scheduledAt = d;
  }

  try {
    const result = await fanoutAndDispatch({
      orgId: orgRes.orgId,
      assetId: id,
      groupName,
      accountIds,
      captionText,
      hashtags: body.hashtags ? String(body.hashtags).trim() : undefined,
      scheduledAt,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "派发失败" },
      { status: 400 },
    );
  }
});
