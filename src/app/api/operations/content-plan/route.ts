/**
 * 内容日历
 * GET  /api/operations/content-plan?from&to — 列表（按组织隔离）
 * POST /api/operations/content-plan — 手动新增选题
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";

export const GET = withAuth(async (request, _ctx, user) => {
  const params = request.nextUrl.searchParams;
  const orgRes = await resolveRequestOrgIdForUser(user, params.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const from = params.get("from") ? new Date(params.get("from")!) : new Date();
  const to = params.get("to")
    ? new Date(params.get("to")!)
    : new Date(from.getTime() + 14 * 24 * 3600 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "from/to 日期非法" }, { status: 400 });
  }

  const items = await db.contentPlanItem.findMany({
    where: {
      orgId: orgRes.orgId,
      plannedDate: { gte: from, lte: to },
    },
    orderBy: [{ plannedDate: "asc" }, { groupName: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  return NextResponse.json({ items });
});

export const POST = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权维护内容日历" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const topic = String(body.topic ?? "").trim();
  const groupName = String(body.groupName ?? "").trim();
  const plannedDate = new Date(body.plannedDate ?? "");
  if (!topic || !groupName) {
    return NextResponse.json({ error: "topic 和 groupName 不能为空" }, { status: 400 });
  }
  if (Number.isNaN(plannedDate.getTime())) {
    return NextResponse.json({ error: "plannedDate 非法" }, { status: 400 });
  }

  const item = await db.contentPlanItem.create({
    data: {
      orgId: orgRes.orgId,
      plannedDate,
      groupName,
      topic,
      angle: body.angle ? String(body.angle) : null,
      suggestedCaption: body.suggestedCaption ? String(body.suggestedCaption) : null,
      hashtags: body.hashtags ? String(body.hashtags).trim() : null,
      status: "approved", // 手动添加视为已通过
      source: "manual",
      createdByUserId: user.id,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
});
