/**
 * 矩阵账号登记
 * GET  /api/operations/matrix-accounts — 列表（按组织隔离）
 * POST /api/operations/matrix-accounts — 新增账号
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";

const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "xiaohongshu"];
const CHANNELS = ["postiz", "postflow", "manual"];

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const accounts = await db.matrixAccount.findMany({
    where: { orgId: orgRes.orgId },
    orderBy: [{ groupName: "asc" }, { platform: "asc" }, { handle: "asc" }],
    take: 500,
  });
  return NextResponse.json({ accounts });
});

export const POST = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权管理矩阵账号" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const platform = String(body.platform ?? "").trim();
  const handle = String(body.handle ?? "").trim();
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: `platform 须为 ${PLATFORMS.join("/")}` }, { status: 400 });
  }
  if (!handle) {
    return NextResponse.json({ error: "handle 不能为空" }, { status: 400 });
  }
  const publishChannel = CHANNELS.includes(body.publishChannel)
    ? (body.publishChannel as string)
    : "manual";
  const tier = body.tier === "premium" ? "premium" : "matrix";

  const existing = await db.matrixAccount.findUnique({
    where: {
      orgId_platform_handle: { orgId: orgRes.orgId, platform, handle },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "该平台账号已登记" }, { status: 409 });
  }

  const account = await db.matrixAccount.create({
    data: {
      orgId: orgRes.orgId,
      platform,
      handle,
      displayName: body.displayName ? String(body.displayName).trim() : null,
      groupName: body.groupName ? String(body.groupName).trim() : "默认组",
      personaNotes: body.personaNotes ? String(body.personaNotes) : null,
      publishChannel,
      tier,
      externalChannelId: body.externalChannelId
        ? String(body.externalChannelId).trim()
        : null,
      dailyQuota:
        Number.isInteger(body.dailyQuota) && body.dailyQuota > 0
          ? Math.min(body.dailyQuota, 20)
          : 3,
    },
  });
  return NextResponse.json({ account }, { status: 201 });
});
