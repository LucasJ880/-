import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams, TenantScope, DateRangeFilter } from "@/lib/common/types";
import { normalizePagination } from "@/lib/common/validation";

// ============================================================
// 审计日志查询
// ============================================================

export interface AuditLogListItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  ip: string | null;
  createdAt: Date;
  user: { id: string; name: string; email: string };
}

export interface AuditLogQuery extends PaginationParams {
  action?: string;
  targetType?: string;
  userId?: string;
  dateRange?: DateRangeFilter;
}

/** 查询组织级审计日志（多租户隔离） */
export async function listAuditLogs(
  scope: Pick<TenantScope, "orgId" | "projectId">,
  params?: AuditLogQuery
): Promise<PaginatedResult<AuditLogListItem>> {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where: Record<string, unknown> = { orgId: scope.orgId };
  if (scope.projectId) where.projectId = scope.projectId;
  if (params?.action) where.action = params.action;
  if (params?.targetType) where.targetType = params.targetType;
  if (params?.userId) where.userId = params.userId;
  if (params?.dateRange) {
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
        action: true,
        targetType: true,
        targetId: true,
        ip: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    data: data as AuditLogListItem[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** 获取单条审计日志详情（含 before/after data） */
export async function getAuditLogDetail(logId: string, orgId: string) {
  return db.auditLog.findFirst({
    where: { id: logId, orgId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
