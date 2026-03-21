/**
 * 项目动态查询服务
 * 基于 AuditLog 聚合生成项目动态时间线
 */

import { db } from "@/lib/db";
import { normalizePagination } from "@/lib/common/validation";
import { formatActivity, type FormattedActivity, type RawAuditLog } from "./formatter";

export interface ActivityQuery {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  targetType?: string;
  action?: string;
}

export interface ActivityListResult {
  data: FormattedActivity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listProjectActivity(
  projectId: string,
  params?: ActivityQuery
): Promise<ActivityListResult> {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where: Record<string, unknown> = { projectId };
  if (params?.targetType) where.targetType = params.targetType;
  if (params?.action) where.action = params.action;
  if (params?.startDate || params?.endDate) {
    const createdAt: Record<string, Date> = {};
    if (params.startDate) createdAt.gte = new Date(params.startDate);
    if (params.endDate) createdAt.lte = new Date(params.endDate);
    where.createdAt = createdAt;
  }

  const [rawLogs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        beforeData: true,
        afterData: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  const data = (rawLogs as RawAuditLog[]).map(formatActivity);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getRecentProjectActivity(
  projectId: string,
  limit = 5
): Promise<FormattedActivity[]> {
  const rawLogs = await db.auditLog.findMany({
    where: { projectId },
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      beforeData: true,
      afterData: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return (rawLogs as RawAuditLog[]).map(formatActivity);
}
