/**
 * 能力中台统一审计写入（复用 AuditLog，扩展可空列）
 */

import { db } from "@/lib/db";
import { summarizePayload } from "../approvals/integrity";

export async function writeCapabilityAuditEvent(opts: {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  traceId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result?: string;
  riskLevel?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const safe = summarizePayload({
      result: opts.result,
      ...(opts.metadata ?? {}),
    });
    await db.auditLog.create({
      data: {
        orgId: opts.orgId,
        userId: opts.userId,
        workspaceId: opts.workspaceId ?? undefined,
        projectId: opts.projectId ?? undefined,
        traceId: opts.traceId ?? undefined,
        riskLevel: opts.riskLevel ?? undefined,
        action: opts.action,
        targetType: opts.resourceType,
        targetId: opts.resourceId ?? undefined,
        afterData: safe ? JSON.stringify(safe) : undefined,
      },
    });
  } catch (err) {
    console.error("[writeCapabilityAuditEvent]", err);
  }
}

export async function listCapabilityAudit(opts: {
  orgId: string;
  workspaceId?: string | null;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  riskLevel?: string;
  traceId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  /** 非 org_admin 时限制本 WS */
  restrictWorkspaceIds?: string[] | null;
}) {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(to.getTime() - 30 * 86400000);

  const where = {
    orgId: opts.orgId,
    createdAt: { gte: from, lte: to },
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    ...(opts.restrictWorkspaceIds?.length
      ? { workspaceId: { in: opts.restrictWorkspaceIds } }
      : {}),
    ...(opts.actorUserId ? { userId: opts.actorUserId } : {}),
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.resourceType ? { targetType: opts.resourceType } : {}),
    ...(opts.riskLevel ? { riskLevel: opts.riskLevel } : {}),
    ...(opts.traceId ? { traceId: opts.traceId } : {}),
  };

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orgId: true,
        workspaceId: true,
        projectId: true,
        traceId: true,
        riskLevel: true,
        userId: true,
        action: true,
        targetType: true,
        targetId: true,
        afterData: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    items: rows.map((r) => ({
      ...r,
      // 不回传可能含密钥的原始 before；after 已脱敏
      after: r.afterData ? safeParse(r.afterData) : null,
      afterData: undefined,
    })),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
