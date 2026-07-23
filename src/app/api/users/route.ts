import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { canManageUsers } from "@/lib/rbac/roles";
import { listUsers } from "@/lib/users/service";
import { queryString, queryPagination } from "@/lib/common/api-helpers";

/**
 * GET /api/users
 * Security-1：仅平台 admin / super_admin。企业成员管理走 /organizations/.../members
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!canManageUsers(auth.user.role)) {
    return NextResponse.json(
      { error: "需要平台管理员权限", code: "PLATFORM_ADMIN_REQUIRED" },
      { status: 403 },
    );
  }

  const { page, pageSize } = queryPagination(request);
  const search = queryString(request, "keyword") ?? queryString(request, "search");
  const status = queryString(request, "status");

  const result = await listUsers({ page, pageSize, search, status });

  return NextResponse.json({
    users: result.data,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  });
}
