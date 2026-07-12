/**
 * 品牌记忆中枢
 * GET /api/operations/brand-profile — 读取本组织品牌档案（按组织隔离）
 * PUT /api/operations/brand-profile — 创建/更新品牌档案（管理权限）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";
import { invalidateBrandContext } from "@/lib/operations/brand-context";

const TEXT_FIELDS = [
  "tagline",
  "positioning",
  "sellingPoints",
  "targetAudience",
  "toneOfVoice",
  "serviceScope",
  "caseStudies",
  "forbiddenClaims",
] as const;

const MAX_FIELD_LENGTH = 4000;

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const profile = await db.brandProfile.findUnique({
    where: { orgId: orgRes.orgId },
  });
  return NextResponse.json({ profile });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权维护品牌档案" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const brandName = String(body.brandName ?? "").trim();
  if (!brandName) {
    return NextResponse.json({ error: "brandName 不能为空" }, { status: 400 });
  }

  const data: Record<string, string | null> = { brandName };
  for (const field of TEXT_FIELDS) {
    const raw = body[field];
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (value.length > MAX_FIELD_LENGTH) {
      return NextResponse.json(
        { error: `${field} 超出 ${MAX_FIELD_LENGTH} 字上限` },
        { status: 400 },
      );
    }
    data[field] = value || null;
  }

  const profile = await db.brandProfile.upsert({
    where: { orgId: orgRes.orgId },
    create: { orgId: orgRes.orgId, ...data, brandName, updatedByUserId: user.id },
    update: { ...data, updatedByUserId: user.id },
  });
  invalidateBrandContext(orgRes.orgId);

  return NextResponse.json({ profile });
});
