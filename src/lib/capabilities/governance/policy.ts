import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeCapabilityAuditEvent } from "./audit";
import { resolveEffectiveQuota } from "./resolve";
import type { QuotaMetric, QuotaPeriod } from "./types";

function toDec(n: number | null | undefined): Prisma.Decimal | null {
  if (n == null) return null;
  return new Prisma.Decimal(n);
}

export async function listQuotaPolicies(orgId: string, workspaceId?: string | null) {
  return db.capabilityQuotaPolicy.findMany({
    where: {
      orgId,
      ...(workspaceId === undefined
        ? {}
        : workspaceId === null
          ? { workspaceId: null }
          : { workspaceId }),
    },
    orderBy: [{ metric: "asc" }, { version: "desc" }],
    take: 200,
  });
}

export async function createQuotaPolicy(opts: {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  metric: QuotaMetric;
  period: QuotaPeriod;
  warningLimit?: number | null;
  softLimit?: number | null;
  hardLimit?: number | null;
}) {
  // Workspace 不得高于 Organization hard
  if (opts.workspaceId) {
    const orgEff = await resolveEffectiveQuota({
      orgId: opts.orgId,
      workspaceId: null,
      metric: opts.metric,
    });
    if (
      opts.hardLimit != null &&
      orgEff.hardLimit != null &&
      opts.hardLimit > orgEff.hardLimit
    ) {
      throw new Error("Workspace hard limit 不得高于 Organization");
    }
  }

  const prev = await db.capabilityQuotaPolicy.findFirst({
    where: {
      orgId: opts.orgId,
      workspaceId: opts.workspaceId ?? null,
      metric: opts.metric,
    },
    orderBy: { version: "desc" },
  });

  const row = await db.capabilityQuotaPolicy.create({
    data: {
      orgId: opts.orgId,
      workspaceId: opts.workspaceId ?? null,
      metric: opts.metric,
      period: opts.period,
      warningLimit: toDec(opts.warningLimit),
      softLimit: toDec(opts.softLimit),
      hardLimit: toDec(opts.hardLimit),
      enabled: true,
      version: (prev?.version ?? 0) + 1,
      createdById: opts.userId,
    },
  });

  await writeCapabilityAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    action: "QUOTA_POLICY_CREATED",
    resourceType: "quota_policy",
    resourceId: row.id,
    result: "ok",
    metadata: { metric: opts.metric, version: row.version },
  });
  return row;
}

export async function patchQuotaPolicy(opts: {
  orgId: string;
  userId: string;
  id: string;
  expectedVersion: number;
  warningLimit?: number | null;
  softLimit?: number | null;
  hardLimit?: number | null;
  enabled?: boolean;
}) {
  const current = await db.capabilityQuotaPolicy.findFirst({
    where: { id: opts.id, orgId: opts.orgId },
  });
  if (!current) throw new Error("策略不存在");
  if (current.version !== opts.expectedVersion) {
    const err = new Error("版本冲突，请刷新后重试");
    (err as Error & { code?: string }).code = "version_conflict";
    throw err;
  }

  if (current.workspaceId) {
    const orgEff = await resolveEffectiveQuota({
      orgId: opts.orgId,
      workspaceId: null,
      metric: current.metric as QuotaMetric,
    });
    const hard = opts.hardLimit ?? Number(current.hardLimit?.toString() ?? NaN);
    if (
      Number.isFinite(hard) &&
      orgEff.hardLimit != null &&
      hard > orgEff.hardLimit
    ) {
      throw new Error("Workspace hard limit 不得高于 Organization");
    }
  }

  // 新版本行（乐观锁：旧版保留为历史）
  const row = await db.capabilityQuotaPolicy.create({
    data: {
      orgId: current.orgId,
      workspaceId: current.workspaceId,
      metric: current.metric,
      period: current.period,
      warningLimit:
        opts.warningLimit !== undefined
          ? toDec(opts.warningLimit)
          : current.warningLimit,
      softLimit:
        opts.softLimit !== undefined ? toDec(opts.softLimit) : current.softLimit,
      hardLimit:
        opts.hardLimit !== undefined ? toDec(opts.hardLimit) : current.hardLimit,
      enabled: opts.enabled ?? current.enabled,
      version: current.version + 1,
      createdById: opts.userId,
    },
  });
  await db.capabilityQuotaPolicy.update({
    where: { id: current.id },
    data: { enabled: false, effectiveTo: new Date() },
  });

  await writeCapabilityAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: current.workspaceId,
    action: "QUOTA_POLICY_UPDATED",
    resourceType: "quota_policy",
    resourceId: row.id,
    result: "ok",
    metadata: {
      previousId: current.id,
      expectedVersion: opts.expectedVersion,
      version: row.version,
    },
  });
  return row;
}
