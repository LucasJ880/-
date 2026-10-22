/**
 * 配额用量计数（账本 + Run + Reservation）
 */

import { db } from "@/lib/db";
import { AGENT_RUN_TERMINAL_STATUSES } from "@/lib/agent-runtime/types";
import type { QuotaMetric } from "./types";

/**
 * 并发预留按 runId 关联 AgentRun。run.ts 的终态路径会立即释放；
 * v2 / workforce / reconcile 等模块直接写终态，这里在计数前惰性补释放，
 * 避免已结束的 run 继续占额度直到 5 分钟 TTL。
 */
async function releaseEndedRunSlots(orgId: string, at: Date): Promise<void> {
  const held = await db.capabilityQuotaReservation.findMany({
    where: {
      orgId,
      metric: "MAX_CONCURRENT_RUNS",
      status: "RESERVED",
      runId: { not: null },
    },
    select: { id: true, runId: true },
  });
  if (held.length === 0) return;
  const ended = await db.agentRun.findMany({
    where: {
      orgId,
      id: { in: held.map((r) => r.runId as string) },
      status: { in: [...AGENT_RUN_TERMINAL_STATUSES] },
    },
    select: { id: true },
  });
  if (ended.length === 0) return;
  const endedRunIds = new Set(ended.map((r) => r.id));
  await db.capabilityQuotaReservation.updateMany({
    where: {
      id: { in: held.filter((r) => endedRunIds.has(r.runId as string)).map((r) => r.id) },
      status: "RESERVED",
    },
    data: { status: "RELEASED", releasedAt: at },
  });
}

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
  if (opts.metric === "MAX_CONCURRENT_RUNS") {
    await releaseEndedRunSlots(opts.orgId, at);
  }

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
      // 预留仍计入 reserved 的 run，不再按 run 行重复计数（否则进行中的 run 占 2 个额度）；
      // 预留过期或已释放后，进行中的 run 仍按 run 行计 1 个。条件与 reservedAgg 一致。
      const heldRunIds = (
        await db.capabilityQuotaReservation.findMany({
          where: {
            orgId: opts.orgId,
            metric: opts.metric,
            status: "RESERVED",
            expiresAt: { gt: at },
            runId: { not: null },
            ...wsFilter,
          },
          select: { runId: true },
        })
      ).map((r) => r.runId as string);
      const running = await db.agentRun.count({
        where: {
          orgId: opts.orgId,
          status: { in: ["running", "claimed", "queued"] },
          ...(heldRunIds.length > 0 ? { id: { notIn: heldRunIds } } : {}),
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
