/**
 * 配额用量计数（账本 + Run + Reservation）
 */

import { db } from "@/lib/db";
import type { QuotaMetric } from "./types";

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getQuotaCurrentUsage(opts: {
  orgId: string;
  workspaceId?: string | null;
  metric: QuotaMetric;
  at?: Date;
}): Promise<number> {
  const at = opts.at ?? new Date();
  const wsFilter = opts.workspaceId
    ? { workspaceId: opts.workspaceId }
    : {};

  // 过期 reservation 清理（惰性）
  await db.capabilityQuotaReservation.updateMany({
    where: {
      orgId: opts.orgId,
      metric: opts.metric,
      status: "RESERVED",
      expiresAt: { lt: at },
    },
    data: { status: "EXPIRED", releasedAt: at },
  });

  const reservedAgg = await db.capabilityQuotaReservation.aggregate({
    where: {
      orgId: opts.orgId,
      metric: opts.metric,
      status: "RESERVED",
      expiresAt: { gt: at },
      ...wsFilter,
    },
    _sum: { amount: true },
  });
  const reserved = Number(reservedAgg._sum.amount?.toString() ?? 0);

  switch (opts.metric) {
    case "MAX_CONCURRENT_RUNS": {
      const running = await db.agentRun.count({
        where: {
          orgId: opts.orgId,
          status: { in: ["running", "claimed", "queued"] },
          ...(opts.workspaceId
            ? {
                metadata: {
                  path: ["workspaceId"],
                  equals: opts.workspaceId,
                },
              }
            : {}),
        },
      });
      return running + reserved;
    }
    case "DAILY_AGENT_RUNS": {
      const from = startOfDay(at);
      const count = await db.agentRun.count({
        where: {
          orgId: opts.orgId,
          createdAt: { gte: from, lte: at },
          ...(opts.workspaceId
            ? {
                metadata: {
                  path: ["workspaceId"],
                  equals: opts.workspaceId,
                },
              }
            : {}),
        },
      });
      return count + reserved;
    }
    case "DAILY_HIGH_RISK_TOOL_CALLS": {
      const from = startOfDay(at);
      const committed = await db.capabilityQuotaReservation.aggregate({
        where: {
          orgId: opts.orgId,
          metric: opts.metric,
          status: "COMMITTED",
          createdAt: { gte: from, lte: at },
          ...wsFilter,
        },
        _sum: { amount: true },
      });
      return Number(committed._sum.amount?.toString() ?? 0) + reserved;
    }
    case "DAILY_IMAGE_GENERATIONS": {
      const from = startOfDay(at);
      const ledger = await db.aiUsageLedger.aggregate({
        where: {
          orgId: opts.orgId,
          usageType: "IMAGE",
          occurredAt: { gte: from, lte: at },
          ...wsFilter,
        },
        _sum: { imageCount: true },
      });
      return (ledger._sum.imageCount ?? 0) + reserved;
    }
    case "MONTHLY_AI_COST": {
      const from = startOfMonth(at);
      const ledger = await db.aiUsageLedger.aggregate({
        where: {
          orgId: opts.orgId,
          occurredAt: { gte: from, lte: at },
          ...wsFilter,
        },
        _sum: { costAmount: true },
      });
      return Number(ledger._sum.costAmount?.toString() ?? 0) + reserved;
    }
    case "SINGLE_RUN_ESTIMATED_COST":
      return 0;
    default:
      return reserved;
  }
}
