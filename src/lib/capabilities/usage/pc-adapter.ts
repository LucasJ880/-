/**
 * Product Content CostEntry → 统一查询 adapter（只读汇入，不物理合并）
 * - 能确认 orgId + source + 费用才展示
 * - 已双写到 AiUsageLedger 的 entry 不重复计费
 */

import { db } from "@/lib/db";
import { centsToUsd } from "./pricing";
import type { AiUsageLedgerView } from "./types";

function categoryToUsageType(
  category: string,
): "TEXT" | "IMAGE" | "EMBEDDING" | "AUDIO" | "OTHER" {
  if (category === "image_edit" || category === "fidelity_qa") return "IMAGE";
  if (category === "copy" || category === "document") return "TEXT";
  return "OTHER";
}

export async function listProductContentUsageViaAdapter(opts: {
  orgId: string;
  from: Date;
  to: Date;
  workspaceIds?: string[] | null;
  /** 已存在于 AiUsageLedger 的 PC sourceId，用于去重 */
  excludeSourceIds?: Set<string>;
  take?: number;
}): Promise<AiUsageLedgerView[]> {
  const take = Math.min(Math.max(opts.take ?? 500, 1), 2000);
  const entries = await db.productContentCostEntry.findMany({
    where: {
      orgId: opts.orgId,
      createdAt: { gte: opts.from, lte: opts.to },
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      orgId: true,
      jobId: true,
      category: true,
      provider: true,
      model: true,
      estimatedCents: true,
      actualCents: true,
      currency: true,
      latencyMs: true,
      createdAt: true,
      job: { select: { createdById: true } },
    },
  });

  const out: AiUsageLedgerView[] = [];
  for (const e of entries) {
    if (!e.orgId) continue;
    if (opts.excludeSourceIds?.has(e.id)) continue;

    // PC Job 当前无 workspaceId；WS 过滤仅在 ledger 有 workspace 时生效
    const cents = e.actualCents > 0 ? e.actualCents : e.estimatedCents;
    out.push({
      id: `pc_adapter:${e.id}`,
      orgId: e.orgId,
      workspaceId: null,
      projectId: null,
      userId: e.job?.createdById ?? null,
      traceId: null,
      runId: null,
      parentRunId: null,
      sourceType: "PRODUCT_CONTENT",
      sourceId: e.id,
      provider: (e.provider ?? "openai").toLowerCase(),
      model: e.model ?? "product-content",
      usageType: categoryToUsageType(e.category),
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      imageCount: e.category === "image_edit" ? 1 : null,
      audioSeconds: null,
      durationMs: e.latencyMs,
      costAmount: centsToUsd(cents),
      currency: e.currency || "USD",
      pricingVersion: "product-content-cents-v1",
      pricingMode: "estimated",
      status: "ESTIMATED",
      errorCode: null,
      occurredAt: e.createdAt,
      fromAdapter: true,
    });
  }
  return out;
}

/** 查询已双写的 PC sourceId，避免汇总重复 */
export async function listDualWrittenPcSourceIds(
  orgId: string,
  sourceIds: string[],
): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();
  const rows = await db.aiUsageLedger.findMany({
    where: {
      orgId,
      sourceType: "PRODUCT_CONTENT",
      sourceId: { in: sourceIds },
    },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId).filter(Boolean) as string[]);
}
