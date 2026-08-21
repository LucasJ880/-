/**
 * 投标业务档案（与品牌档案分离）
 * GET /api/operations/tender-profile — 读取本组织投标档案
 * PUT /api/operations/tender-profile — 创建/更新（管理权限）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";
import { TENDER_PROFILE_FIELDS, type TenderProfile } from "@/lib/tender-profile/contract";
import { getTenderProfile, saveTenderProfile } from "@/lib/tender-profile/store";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const profile = await getTenderProfile(orgRes.orgId);
  return NextResponse.json({ profile, fields: TENDER_PROFILE_FIELDS });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权维护投标档案" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orgRes = await resolveRequestOrgIdForUser(user, typeof body.orgId === "string" ? body.orgId : null);
  if (!orgRes.ok) return orgRes.response;
  const patch: Partial<TenderProfile> = {};
  for (const f of TENDER_PROFILE_FIELDS) {
    const raw = body[f.key];
    if (raw === undefined) continue;
    (patch as Record<string, string>)[f.key] = String(raw ?? "");
  }
  const profile = await saveTenderProfile(orgRes.orgId, patch);
  return NextResponse.json({ profile });
});
