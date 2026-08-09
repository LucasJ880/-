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

  // Governance Hygiene：同 org+workspace+metric 只允许一个 enabled 的
  // current version；新建策略在同一事务内 supersede 全部旧 enabled 版本。
  //
  // Concurrency：先锁 Organization 行（非空集，沿用 reconcile-run/enqueue-package
  // 已验证的父行 FOR UPDATE 模式），使同一 org 的 quota-policy 写操作在数据库层
  // 串行执行；锁必须在读取 latest version 之前获得，否则仍有 race window。
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM "Organization" WHERE id = ${opts.orgId} FOR UPDATE
    `;

    const prev = await tx.capabilityQuotaPolicy.findFirst({
      where: {
        orgId: opts.orgId,
        workspaceId: opts.workspaceId ?? null,
        metric: opts.metric,
      },
      orderBy: { version: "desc" },
    });

    const created = await tx.capabilityQuotaPolicy.create({
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

    await tx.capabilityQuotaPolicy.updateMany({
      where: {
        orgId: opts.orgId,
        workspaceId: opts.workspaceId ?? null,
        metric: opts.metric,
        enabled: true,
        id: { not: created.id },
      },
      data: { enabled: false, effectiveTo: new Date() },
    });

    return created;
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
  const versionConflict = () => {
    const err = new Error("版本冲突，请刷新后重试");
    (err as Error & { code?: string }).code = "version_conflict";
    return err;
  };

  // Concurrency：读取与校验必须在 org 行锁之后进行。
  // 仅凭 current.version === expectedVersion 不能阻止 stale update——
  // 旧版本行自身的 version 永不变化，指向旧行的 patch 会恒通过该检查
  // 并生成重复的 vN+1。因此拿锁后必须重新解析该 key 的真正 latest，
  // 并要求 latest.id === opts.id && latest.version === expectedVersion
  // && latest.enabled === true。
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM "Organization" WHERE id = ${opts.orgId} FOR UPDATE
    `;

    const target = await tx.capabilityQuotaPolicy.findFirst({
      where: { id: opts.id, orgId: opts.orgId },
    });
    if (!target) throw new Error("策略不存在");

    const latest = await tx.capabilityQuotaPolicy.findFirst({
      where: {
        orgId: opts.orgId,
        workspaceId: target.workspaceId,
        metric: target.metric,
      },
      orderBy: { version: "desc" },
    });
    if (
      !latest ||
      latest.id !== opts.id ||
      latest.version !== opts.expectedVersion ||
      !latest.enabled
    ) {
      throw versionConflict();
    }

    if (latest.workspaceId) {
      const orgEff = await resolveEffectiveQuota({
        orgId: opts.orgId,
        workspaceId: null,
        metric: latest.metric as QuotaMetric,
      });
      const hard = opts.hardLimit ?? Number(latest.hardLimit?.toString() ?? NaN);
      if (
        Number.isFinite(hard) &&
        orgEff.hardLimit != null &&
        hard > orgEff.hardLimit
      ) {
        throw new Error("Workspace hard limit 不得高于 Organization");
      }
    }

    // 新版本行（旧版保留为历史）。
    // Governance Hygiene：supersede 同 key 全部旧 enabled 版本
    // （不只是 latest.id，防止历史遗留的多 enabled 行继续存在）。
    // 注意 disable 语义：opts.enabled=false 时新版本为 disabled，
    // 不变量是「最多一条 enabled current」，不是「必须存在一条 enabled」。
    const created = await tx.capabilityQuotaPolicy.create({
      data: {
        orgId: latest.orgId,
        workspaceId: latest.workspaceId,
        metric: latest.metric,
        period: latest.period,
        warningLimit:
          opts.warningLimit !== undefined
            ? toDec(opts.warningLimit)
            : latest.warningLimit,
        softLimit:
          opts.softLimit !== undefined ? toDec(opts.softLimit) : latest.softLimit,
        hardLimit:
          opts.hardLimit !== undefined ? toDec(opts.hardLimit) : latest.hardLimit,
        enabled: opts.enabled ?? latest.enabled,
        version: latest.version + 1,
        createdById: opts.userId,
      },
    });
    await tx.capabilityQuotaPolicy.updateMany({
      where: {
        orgId: latest.orgId,
        workspaceId: latest.workspaceId,
        metric: latest.metric,
        enabled: true,
        id: { not: created.id },
      },
      data: { enabled: false, effectiveTo: new Date() },
    });
    return created;
  });

  await writeCapabilityAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: row.workspaceId,
    action: "QUOTA_POLICY_UPDATED",
    resourceType: "quota_policy",
    resourceId: row.id,
    result: "ok",
    metadata: {
      previousId: opts.id,
      expectedVersion: opts.expectedVersion,
      version: row.version,
    },
  });
  return row;
}
