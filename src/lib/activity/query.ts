/**
 * 项目动态查询服务
 * 基于 AuditLog 聚合生成项目动态时间线
 * 支持可选合并 ProjectMessage(SYSTEM) 事件
 */

import { db } from "@/lib/db";
import { normalizePagination } from "@/lib/common/validation";
import {
  formatActivity,
  formatSystemEvent,
  type FormattedActivity,
  type RawAuditLog,
  type RawSystemEvent,
} from "./formatter";

export interface ActivityQuery {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  targetType?: string;
  action?: string;
  includeSystemEvents?: boolean;
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

  const [rawLogs, auditTotal] = await Promise.all([
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
      skip: params?.includeSystemEvents ? undefined : skip,
      take: params?.includeSystemEvents ? undefined : pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  const auditActivities = (rawLogs as RawAuditLog[]).map(formatActivity);

  if (params?.includeSystemEvents) {
    const sysWhere: Record<string, unknown> = { projectId, type: "SYSTEM" };
    if (params.startDate || params.endDate) {
      const createdAt: Record<string, Date> = {};
      if (params.startDate) createdAt.gte = new Date(params.startDate);
      if (params.endDate) createdAt.lte = new Date(params.endDate);
      sysWhere.createdAt = createdAt;
    }

    const [sysMessages, sysTotal] = await Promise.all([
      db.projectMessage.findMany({
        where: sysWhere,
        select: {
          id: true,
          body: true,
          metadata: true,
          senderId: true,
          sender: { select: { id: true, name: true, email: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.projectMessage.count({ where: sysWhere }),
    ]);

    const sysActivities = (sysMessages as unknown as RawSystemEvent[]).map(formatSystemEvent);

    const merged = [...auditActivities, ...sysActivities].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const total = auditTotal + sysTotal;
    const paged = merged.slice(skip, skip + pageSize);

    return {
      data: paged,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  return {
    data: auditActivities,
    total: auditTotal,
    page,
    pageSize,
    totalPages: Math.ceil(auditTotal / pageSize),
  };
}

export async function getRecentProjectActivity(
  projectId: string,
  limit = 5,
  includeSystemEvents = false
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
    take: includeSystemEvents ? undefined : limit,
  });

  let results = (rawLogs as RawAuditLog[]).map(formatActivity);

  if (includeSystemEvents) {
    const sysMessages = await db.projectMessage.findMany({
      where: { projectId, type: "SYSTEM" },
      select: {
        id: true,
        body: true,
        metadata: true,
        senderId: true,
        sender: { select: { id: true, name: true, email: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const sysActivities = (sysMessages as unknown as RawSystemEvent[]).map(formatSystemEvent);
    results = [...results, ...sysActivities]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  return results;
}
