/**
 * Phase 3A-2：统一 AI 使用账本写入
 * - 失败默认不阻断业务
 * - idempotencyKey 防重复计费
 * - 无 orgId 不得写入
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { sanitizeUsageMetadata } from "./sanitize";
import type { RecordAiUsageInput } from "./types";

export type RecordAiUsageResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; reason: string; retriable: boolean };

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) ? Math.max(0, n) : 0);
}

export async function recordAiUsage(
  input: RecordAiUsageInput,
): Promise<RecordAiUsageResult> {
  if (!input.orgId?.trim()) {
    logger.error("ai.usage.ledger.skip_no_org", {
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
    });
    return { ok: false, reason: "missing_orgId", retriable: false };
  }

  if (!input.idempotencyKey?.trim()) {
    logger.error("ai.usage.ledger.skip_no_idempotency", {
      orgId: input.orgId,
      sourceType: input.sourceType,
    });
    return { ok: false, reason: "missing_idempotencyKey", retriable: false };
  }

  const provider = input.provider.trim().toLowerCase();
  if (!provider) {
    return { ok: false, reason: "missing_provider", retriable: false };
  }

  const metadataJson = sanitizeUsageMetadata({
    ...(input.metadata ?? {}),
    pricingMode: input.pricingMode ?? "estimated",
  });

  try {
    const row = await db.aiUsageLedger.create({
      data: {
        orgId: input.orgId,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        userId: input.userId ?? null,
        traceId: input.traceId ?? null,
        runId: input.runId ?? null,
        parentRunId: input.parentRunId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey,
        provider,
        model: input.model || "unknown",
        usageType: input.usageType,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        cachedInputTokens: input.cachedInputTokens ?? null,
        imageCount: input.imageCount ?? null,
        audioSeconds: input.audioSeconds ?? null,
        durationMs: input.durationMs ?? null,
        costAmount: toDecimal(input.costAmount),
        currency: input.currency ?? "USD",
        pricingVersion: input.pricingVersion ?? null,
        status: input.status,
        errorCode: input.errorCode ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        metadataJson:
          metadataJson == null
            ? undefined
            : (metadataJson as Prisma.InputJsonValue),
      },
      select: { id: true },
    });
    return { ok: true, id: row.id, duplicate: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await db.aiUsageLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      return {
        ok: true,
        id: existing?.id ?? "duplicate",
        duplicate: true,
      };
    }
    logger.error("ai.usage.ledger.write_failed", {
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      reason: "write_failed",
      retriable: true,
    };
  }
}

/** 业务路径用：永不抛错 */
export function recordAiUsageBestEffort(input: RecordAiUsageInput): void {
  void recordAiUsage(input).catch((err) => {
    logger.error("ai.usage.ledger.best_effort_crash", {
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}
