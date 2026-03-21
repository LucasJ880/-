import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { getOrgMembership, getProjectMembership } from "@/lib/auth";
import { listAuditLogs, type AuditLogQuery } from "@/lib/audit/query";
import { queryString, queryPagination } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { normalizePagination } from "@/lib/common/validation";

/**
 * GET /api/audit-logs
 * 分页查询审计日志，严格按权限收敛查询范围：
 * - super_admin: 可查看全局（orgId 可选）
 * - org_admin: 必须传 orgId，只能查看所属组织
 * - project_admin: 必须传 orgId + projectId，只能查看所属项目
 * - 其他角色: 无权访问
 *
 * Query params:
 *   orgId, projectId, userId, action, targetType,
 *   startDate, endDate, page, pageSize
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const { page, pageSize } = queryPagination(request);
  const orgId = queryString(request, "orgId");
  const projectId = queryString(request, "projectId");
  const action = queryString(request, "action");
  const targetType = queryString(request, "targetType");
  const userId = queryString(request, "userId");
  const startDate = queryString(request, "startDate");
  const endDate = queryString(request, "endDate");

  const dateRange =
    startDate || endDate ? { from: startDate, to: endDate } : undefined;

  const queryParams: AuditLogQuery = {
    page,
    pageSize,
    action,
    targetType,
    userId,
    dateRange,
  };

  // ---- super_admin 可按任意范围查询 ----
  if (isSuperAdmin(user.role)) {
    if (orgId) {
      return respondLogs(
        await listAuditLogs({ orgId, projectId }, queryParams)
      );
    }

    // 全局查询（不限 orgId）
    return respondLogs(await queryGlobalAuditLogs(queryParams, projectId));
  }

  // ---- 非 super_admin 必须传 orgId ----
  if (!orgId) {
    return NextResponse.json(
      { error: "非管理员必须指定 orgId 参数" },
      { status: 400 }
    );
  }

  const membership = await getOrgMembership(user.id, orgId);
  if (!membership || membership.status !== "active") {
    return NextResponse.json(
      { error: "无权查看该组织的审计日志" },
      { status: 403 }
    );
  }

  // org_admin 可查看组织内所有日志
  if (hasOrgRole(membership.role, "org_admin")) {
    return respondLogs(
      await listAuditLogs({ orgId, projectId }, queryParams)
    );
  }

  // project_admin 必须传 projectId
  if (!projectId) {
    return NextResponse.json(
      { error: "组织非管理员必须指定 projectId 参数" },
      { status: 400 }
    );
  }

  const pm = await getProjectMembership(user.id, projectId);
  if (!pm || pm.status !== "active" || pm.role !== "project_admin") {
    return NextResponse.json(
      { error: "需要项目管理员权限查看审计日志" },
      { status: 403 }
    );
  }

  return respondLogs(
    await listAuditLogs({ orgId, projectId }, queryParams)
  );
}

// ---- helpers ----

function respondLogs(result: {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  return NextResponse.json({
    logs: result.data,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  });
}

async function queryGlobalAuditLogs(
  params: AuditLogQuery,
  projectId?: string
) {
  const { page: p, pageSize: ps, skip } = normalizePagination(
    params.page,
    params.pageSize
  );

  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  if (params.action) where.action = params.action;
  if (params.targetType) where.targetType = params.targetType;
  if (params.userId) where.userId = params.userId;
  if (params.dateRange) {
    const createdAt: Record<string, unknown> = {};
    if (params.dateRange.from) createdAt.gte = new Date(params.dateRange.from);
    if (params.dateRange.to) createdAt.lte = new Date(params.dateRange.to);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  const [data, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        orgId: true,
        projectId: true,
        action: true,
        targetType: true,
        targetId: true,
        ip: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: ps,
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    data,
    total,
    page: p,
    pageSize: ps,
    totalPages: Math.ceil(total / ps),
  };
}
