import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { evaluateQuota } from "./evaluate";
import { writeCapabilityAuditEvent } from "./audit";
import type { QuotaMetric } from "./types";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function reserveQuota(opts: {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  metric: QuotaMetric;
  amount: number;
  idempotencyKey: string;
  ttlMs?: number;
  runId?: string | null;
  traceId?: string | null;
}): Promise<
  | { ok: true; reservationId: string; duplicate: boolean; eval: Awaited<ReturnType<typeof evaluateQuota>> }
  | { ok: false; eval: Awaited<ReturnType<typeof evaluateQuota>>; error: string }
> {
  const existing = await db.capabilityQuotaReservation.findUnique({
    where: { idempotencyKey: opts.idempotencyKey },
  });
  if (existing) {
    if (existing.orgId !== opts.orgId || existing.metric !== opts.metric) {
      return {
        ok: false,
        eval: await evaluateQuota({
          orgId: opts.orgId,
          userId: opts.userId,
          workspaceId: opts.workspaceId,
          metric: opts.metric,
          requestedAmount: opts.amount,
        }),
        error: "idempotencyKey 冲突",
      };
    }
    const ev = await evaluateQuota({
      orgId: opts.orgId,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      metric: opts.metric,
      requestedAmount: 0,
    });
    return {
      ok: true,
      reservationId: existing.id,
      duplicate: true,
      eval: ev,
    };
  }

  const ev = await evaluateQuota({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    metric: opts.metric,
    requestedAmount: opts.amount,
    idempotencyKey: opts.idempotencyKey,
  });
  if (!ev.allowed) {
    return { ok: false, eval: ev, error: "配额 hard limit，拒绝执行" };
  }

  try {
    const row = await db.capabilityQuotaReservation.create({
      data: {
        orgId: opts.orgId,
        workspaceId: opts.workspaceId ?? null,
        metric: opts.metric,
        amount: new Prisma.Decimal(opts.amount),
        idempotencyKey: opts.idempotencyKey,
        status: "RESERVED",
        expiresAt: new Date(Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS)),
        runId: opts.runId ?? null,
        traceId: opts.traceId ?? null,
      },
    });
    await writeCapabilityAuditEvent({
      orgId: opts.orgId,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      action: "QUOTA_RESERVED",
      resourceType: "quota_reservation",
      resourceId: row.id,
      result: "ok",
      metadata: { metric: opts.metric, amount: opts.amount, level: ev.level },
    });
    return { ok: true, reservationId: row.id, duplicate: false, eval: ev };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await db.capabilityQuotaReservation.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      return {
        ok: true,
        reservationId: again?.id ?? "duplicate",
        duplicate: true,
        eval: ev,
      };
    }
    throw err;
  }
}

export async function commitReservation(opts: {
  reservationId: string;
  orgId: string;
  userId: string;
  actualAmount?: number;
}): Promise<void> {
  const row = await db.capabilityQuotaReservation.findFirst({
    where: { id: opts.reservationId, orgId: opts.orgId },
  });
  if (!row || row.status !== "RESERVED") return;
  await db.capabilityQuotaReservation.update({
    where: { id: row.id },
    data: {
      status: "COMMITTED",
      committedAt: new Date(),
      ...(opts.actualAmount != null
        ? { amount: new Prisma.Decimal(opts.actualAmount) }
        : {}),
    },
  });
  await writeCapabilityAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: row.workspaceId,
    action: "QUOTA_COMMITTED",
    resourceType: "quota_reservation",
    resourceId: row.id,
    result: "ok",
    metadata: { metric: row.metric },
  });
}

export async function releaseReservation(opts: {
  reservationId: string;
  orgId: string;
  userId: string;
}): Promise<void> {
  const row = await db.capabilityQuotaReservation.findFirst({
    where: { id: opts.reservationId, orgId: opts.orgId },
  });
  if (!row || row.status !== "RESERVED") return;
  await db.capabilityQuotaReservation.update({
    where: { id: row.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
  await writeCapabilityAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: row.workspaceId,
    action: "QUOTA_RELEASED",
    resourceType: "quota_reservation",
    resourceId: row.id,
    result: "ok",
    metadata: { metric: row.metric },
  });
}
