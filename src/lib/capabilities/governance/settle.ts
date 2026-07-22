/**
 * Phase 3A-5：estimated → actual 成本结算
 *
 * 流程：Reservation(RESERVED) → 模型调用 → AiUsageLedger 实际写入
 *      → Reservation SETTLED / RELEASED
 *
 * MONTHLY_AI_COST 用量 = ledger + RESERVED；SETTLED/COMMITTED/RELEASED 不再计入 reserved。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAiUsage } from "@/lib/capabilities/usage/record";
import {
  estimateOpenAiTextCostUsd,
  OPENAI_PRICING_VERSION,
} from "@/lib/capabilities/usage/pricing";
import { writeCapabilityAuditEvent } from "./audit";
import { releaseReservation } from "./reserve";

export type SettlementStatus =
  | "SETTLED"
  | "RELEASED"
  | "SETTLEMENT_FAILED"
  | "ALREADY_SETTLED";

export type SettleAiUsageReservationInput = {
  reservationId: string;
  orgId: string;
  userId: string;
  /** 结算幂等键（含 session） */
  idempotencyKey: string;
  /** 实际费用（USD）；无费用失败传 0 */
  actualCost: number;
  /** 若已有 ledgerId 可传入；否则本函数写入 */
  ledgerId?: string | null;
  workspaceId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  success?: boolean;
  errorCode?: string | null;
  sourceType?: "AGENT_RUNTIME" | "SUPERVISOR" | "WORKFLOW";
  /** 调用是否产生了应计费的成功/部分用量 */
  hadBillableUsage?: boolean;
};

export type SettleAiUsageReservationResult = {
  status: SettlementStatus;
  reservationId: string;
  ledgerId: string | null;
  actualCost: number;
  estimatedCost: number;
  releasedDelta: number;
  duplicate: boolean;
};

function toUsd(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * 按真实用量结算 reservation，并保证 ledger 入账。
 * 重试安全：idempotencyKey + reservation 终态短路。
 */
export async function settleAiUsageReservation(
  opts: SettleAiUsageReservationInput,
): Promise<SettleAiUsageReservationResult> {
  const actualCost = toUsd(opts.actualCost);
  const row = await db.capabilityQuotaReservation.findFirst({
    where: { id: opts.reservationId, orgId: opts.orgId },
  });

  if (!row) {
    return {
      status: "SETTLEMENT_FAILED",
      reservationId: opts.reservationId,
      ledgerId: opts.ledgerId ?? null,
      actualCost,
      estimatedCost: 0,
      releasedDelta: 0,
      duplicate: false,
    };
  }

  const estimatedCost = Number(row.amount.toString());

  if (
    row.status === "SETTLED" ||
    row.status === "COMMITTED" ||
    row.status === "RELEASED"
  ) {
    return {
      status: "ALREADY_SETTLED",
      reservationId: row.id,
      ledgerId: opts.ledgerId ?? null,
      actualCost,
      estimatedCost,
      releasedDelta: 0,
      duplicate: true,
    };
  }

  if (row.status !== "RESERVED" && row.status !== "EXPIRED") {
    return {
      status: "SETTLEMENT_FAILED",
      reservationId: row.id,
      ledgerId: opts.ledgerId ?? null,
      actualCost,
      estimatedCost,
      releasedDelta: 0,
      duplicate: false,
    };
  }

  let ledgerId = opts.ledgerId ?? null;
  const hadBillable =
    opts.hadBillableUsage ?? (actualCost > 0 || Boolean(opts.success));

  try {
    if (hadBillable && actualCost >= 0) {
      const priced =
        opts.inputTokens != null || opts.outputTokens != null
          ? estimateOpenAiTextCostUsd({
              model: opts.model ?? "unknown",
              inputTokens: opts.inputTokens,
              outputTokens: opts.outputTokens,
            })
          : {
              costAmount: actualCost,
              pricingMode: "estimated" as const,
              pricingVersion: OPENAI_PRICING_VERSION,
            };

      // 优先使用调用方给出的 actualCost（已按真实 usage 算好）
      const costAmount = actualCost > 0 ? actualCost : priced.costAmount;

      const written = await recordAiUsage({
        orgId: opts.orgId,
        workspaceId: opts.workspaceId ?? row.workspaceId,
        userId: opts.userId,
        traceId: opts.traceId ?? row.traceId,
        runId: opts.runId ?? row.runId,
        sourceType: opts.sourceType ?? "AGENT_RUNTIME",
        sourceId: row.id,
        idempotencyKey: opts.idempotencyKey,
        provider: "openai",
        model: opts.model ?? "unknown",
        usageType: "TEXT",
        inputTokens: opts.inputTokens ?? null,
        outputTokens: opts.outputTokens ?? null,
        durationMs: null,
        costAmount,
        currency: "USD",
        pricingVersion: priced.pricingVersion ?? OPENAI_PRICING_VERSION,
        pricingMode: "exact",
        status: opts.success === false && costAmount === 0 ? "FAILED" : "SUCCEEDED",
        errorCode: opts.errorCode ?? null,
        occurredAt: new Date(),
        metadata: {
          settlement: true,
          reservationId: row.id,
          estimatedCost,
          actualCost: costAmount,
        },
      });

      if (written.ok) {
        ledgerId = written.id;
      } else if (!written.retriable && written.reason !== "missing_orgId") {
        // 不可重试写入失败：标记 SETTLEMENT_FAILED，保留 RESERVED 供排查
        await db.capabilityQuotaReservation.update({
          where: { id: row.id },
          data: { status: "SETTLEMENT_FAILED" },
        });
        await writeCapabilityAuditEvent({
          orgId: opts.orgId,
          userId: opts.userId,
          workspaceId: row.workspaceId,
          action: "QUOTA_SETTLEMENT_FAILED",
          resourceType: "quota_reservation",
          resourceId: row.id,
          result: "error",
          metadata: { reason: written.reason, idempotencyKey: opts.idempotencyKey },
        });
        return {
          status: "SETTLEMENT_FAILED",
          reservationId: row.id,
          ledgerId: null,
          actualCost,
          estimatedCost,
          releasedDelta: 0,
          duplicate: false,
        };
      }
    }

    if (actualCost <= 0 && !hadBillable) {
      await releaseReservation({
        reservationId: row.id,
        orgId: opts.orgId,
        userId: opts.userId,
      });
      // releaseReservation 只处理 RESERVED；EXPIRED 直接改
      if (row.status === "EXPIRED") {
        await db.capabilityQuotaReservation.update({
          where: { id: row.id },
          data: { status: "RELEASED", releasedAt: new Date() },
        });
      }
      await writeCapabilityAuditEvent({
        orgId: opts.orgId,
        userId: opts.userId,
        workspaceId: row.workspaceId,
        action: "QUOTA_SETTLED_RELEASED",
        resourceType: "quota_reservation",
        resourceId: row.id,
        result: "ok",
        metadata: {
          estimatedCost,
          actualCost: 0,
          ledgerId,
        },
      });
      return {
        status: "RELEASED",
        reservationId: row.id,
        ledgerId,
        actualCost: 0,
        estimatedCost,
        releasedDelta: estimatedCost,
        duplicate: false,
      };
    }

    // 有费用：SETTLED，amount 改为实际（差额从 reserved 池释放）
    await db.capabilityQuotaReservation.update({
      where: { id: row.id },
      data: {
        status: "SETTLED",
        amount: new Prisma.Decimal(actualCost),
        committedAt: new Date(),
        releasedAt: actualCost < estimatedCost ? new Date() : null,
      },
    });

    const releasedDelta = Math.max(0, estimatedCost - actualCost);
    await writeCapabilityAuditEvent({
      orgId: opts.orgId,
      userId: opts.userId,
      workspaceId: row.workspaceId,
      action: "QUOTA_SETTLED",
      resourceType: "quota_reservation",
      resourceId: row.id,
      result: "ok",
      riskLevel: actualCost > estimatedCost ? "MEDIUM" : undefined,
      metadata: {
        estimatedCost,
        actualCost,
        releasedDelta,
        ledgerId,
        overEstimate: actualCost > estimatedCost,
      },
    });

    return {
      status: "SETTLED",
      reservationId: row.id,
      ledgerId,
      actualCost,
      estimatedCost,
      releasedDelta,
      duplicate: false,
    };
  } catch (err) {
    await db.capabilityQuotaReservation
      .update({
        where: { id: row.id },
        data: { status: "SETTLEMENT_FAILED" },
      })
      .catch(() => undefined);
    await writeCapabilityAuditEvent({
      orgId: opts.orgId,
      userId: opts.userId,
      workspaceId: row.workspaceId,
      action: "QUOTA_SETTLEMENT_FAILED",
      resourceType: "quota_reservation",
      resourceId: row.id,
      result: "error",
      metadata: {
        err: err instanceof Error ? err.message : String(err),
      },
    });
    return {
      status: "SETTLEMENT_FAILED",
      reservationId: row.id,
      ledgerId,
      actualCost,
      estimatedCost,
      releasedDelta: 0,
      duplicate: false,
    };
  }
}

/**
 * 从 stream usage 估算实际 USD 成本（pricingVersion 固定，不重算历史）。
 */
export function actualCostFromStreamUsage(opts: {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}): number {
  return estimateOpenAiTextCostUsd({
    model: opts.model,
    inputTokens: opts.promptTokens,
    outputTokens: opts.completionTokens,
  }).costAmount;
}
