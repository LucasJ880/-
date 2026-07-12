/**
 * PATCH  /api/operations/matrix-accounts/[id] — 更新账号（组、通道、状态、配额等）
 * DELETE /api/operations/matrix-accounts/[id] — 删除账号（发布任务级联删除）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";

const STATUSES = ["active", "limited", "banned", "paused"];
const CHANNELS = ["postiz", "postflow", "manual"];

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权管理矩阵账号" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    body.orgId ?? request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const account = await db.matrixAccount.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "账号不存在" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.displayName === "string") data.displayName = body.displayName.trim() || null;
  if (typeof body.groupName === "string" && body.groupName.trim()) data.groupName = body.groupName.trim();
  if (typeof body.personaNotes === "string") data.personaNotes = body.personaNotes || null;
  if (CHANNELS.includes(body.publishChannel)) data.publishChannel = body.publishChannel;
  if (typeof body.externalChannelId === "string") data.externalChannelId = body.externalChannelId.trim() || null;
  if (STATUSES.includes(body.status)) data.status = body.status;
  if (Number.isInteger(body.dailyQuota) && body.dailyQuota > 0) data.dailyQuota = Math.min(body.dailyQuota, 20);
  if (typeof body.notes === "string") data.notes = body.notes || null;

  const updated = await db.matrixAccount.update({ where: { id }, data });
  return NextResponse.json({ account: updated });
});

export const DELETE = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权管理矩阵账号" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const account = await db.matrixAccount.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "账号不存在" }, { status: 404 });
  }
  await db.matrixAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
