/**
 * PATCH  /api/operations/content-plan/[id] — 编辑 / 状态流转（approved/skipped/proposed）
 * DELETE /api/operations/content-plan/[id] — 删除选题
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";

const EDITABLE_STATUSES = ["proposed", "approved", "skipped"];

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权维护内容日历" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const item = await db.contentPlanItem.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!item) return NextResponse.json({ error: "选题不存在" }, { status: 404 });
  if (item.status === "dispatched") {
    return NextResponse.json({ error: "已扇出的选题不可修改" }, { status: 409 });
  }

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!EDITABLE_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status 须为 ${EDITABLE_STATUSES.join("/")}` },
        { status: 400 },
      );
    }
    data.status = body.status;
  }
  if (body.topic !== undefined) {
    const topic = String(body.topic).trim();
    if (!topic) return NextResponse.json({ error: "topic 不能为空" }, { status: 400 });
    data.topic = topic;
  }
  if (body.angle !== undefined) data.angle = String(body.angle).trim() || null;
  if (body.suggestedCaption !== undefined) {
    data.suggestedCaption = String(body.suggestedCaption).trim() || null;
  }
  if (body.hashtags !== undefined) data.hashtags = String(body.hashtags).trim() || null;
  if (body.plannedDate !== undefined) {
    const d = new Date(body.plannedDate);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "plannedDate 非法" }, { status: 400 });
    }
    data.plannedDate = d;
  }

  const updated = await db.contentPlanItem.update({ where: { id: item.id }, data });
  return NextResponse.json({ item: updated });
});

export const DELETE = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权维护内容日历" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const item = await db.contentPlanItem.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true, status: true },
  });
  if (!item) return NextResponse.json({ error: "选题不存在" }, { status: 404 });
  if (item.status === "dispatched") {
    return NextResponse.json({ error: "已扇出的选题不可删除" }, { status: 409 });
  }

  await db.contentPlanItem.delete({ where: { id: item.id } });
  return NextResponse.json({ ok: true });
});
