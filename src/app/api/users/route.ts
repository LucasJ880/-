import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { listUsers } from "@/lib/users/service";
import { resolveUserListScope } from "@/lib/users/list-scope";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import { queryString, queryPagination } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

/**
 * GET /api/users
 * PERM-4b：仅平台 super_admin（平台 admin / boss 不再可管平台用户）。企业成员管理走 /organizations/.../members
 * USR-1：按范围列人——`scope=platform` 全平台；否则 `orgId` 或当前工作企业 → 只列该企业 active 成员（带企业内角色）；
 * 都没有 → 400 ORG_SCOPE_REQUIRED（不回落到全平台）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!isPlatformSuperAdmin(auth.user.role)) {
    return NextResponse.json(
      { error: "需要平台管理员权限", code: "PLATFORM_ADMIN_REQUIRED" },
      { status: 403 },
    );
  }

  const { page, pageSize } = queryPagination(request);
  const search = queryString(request, "keyword") ?? queryString(request, "search");
  const status = queryString(request, "status");

  const scopeParam = queryString(request, "scope");
  const orgIdParam = queryString(request, "orgId");
  const resolution = resolveUserListScope({
    scopeParam,
    orgIdParam,
    activeOrgId: scopeParam === "platform" || orgIdParam ? null : await getUserActiveOrgId(auth.user.id),
  });
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error, code: resolution.code }, { status: 400 });
  }

  let scope: { type: "platform" } | { type: "org"; org: { id: string; name: string } } = { type: "platform" };
  if (resolution.scope.type === "org") {
    const org = await db.organization.findUnique({
      where: { id: resolution.scope.orgId },
      select: { id: true, name: true },
    });
    if (!org) {
      return NextResponse.json({ error: "企业不存在" }, { status: 404 });
    }
    scope = { type: "org", org };
  }

  const result = await listUsers({
    page,
    pageSize,
    search,
    status,
    orgId: scope.type === "org" ? scope.org.id : undefined,
  });

  return NextResponse.json({
    scope,
    users: result.data,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  });
}
