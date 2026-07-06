import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { canManageUsers } from "@/lib/rbac/roles";
import { listUsers } from "@/lib/users/service";
import { queryString, queryPagination } from "@/lib/common/api-helpers";

/**
 * GET /api/users
 * 平台管理员 / 总经理查看用户列表，支持分页、搜索、状态筛选
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!canManageUsers(auth.user.role)) {
    return NextResponse.json({ error: "需要管理员或总经理权限" }, { status: 403 });
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
