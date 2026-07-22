import { db } from "@/lib/db";
import { getOrCreateApprovalSettings } from "@/lib/product-content/approval/settings";
import { recordAiUsageBestEffort } from "@/lib/capabilities/usage/record";
import { centsToUsd } from "@/lib/capabilities/usage/pricing";

export type CostCategory =
  | "image_edit"
  | "fidelity_qa"
  | "copy"
  | "document"
  | "other";

export interface RecordCostEntryInput {
  orgId: string;
  jobId: string;
  category: CostCategory;
  provider?: string;
  model?: string;
  estimatedCents?: number;
  actualCents?: number;
  currency?: string;
  requestId?: string;
  latencyMs?: number;
  meta?: Record<string, unknown>;
}

export interface JobCostSummary {
  estimatedCents: number;
  actualCents: number;
  byCategory: Record<string, { estimatedCents: number; actualCents: number }>;
  budgetCents: number | null;
  withinBudget: boolean;
}

export async function recordCostEntry(input: RecordCostEntryInput) {
  const estimated = input.estimatedCents ?? 0;
  const actual = input.actualCents ?? estimated;

  const entry = await db.productContentCostEntry.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      category: input.category,
      provider: input.provider,
      model: input.model,
      estimatedCents: estimated,
      actualCents: actual,
      currency: input.currency ?? "USD",
      requestId: input.requestId,
      latencyMs: input.latencyMs,
      metaJson: input.meta as object | undefined,
    },
  });

  const summary = await summarizeJobCost(input.orgId, input.jobId);
  await db.productContentJob.update({
    where: { id: input.jobId },
    data: {
      estimatedCostCents: summary.estimatedCents,
      costCents: summary.actualCents,
    },
  });

  // Phase 3A-2：双写统一账本（稳定 idempotency；失败不阻断 PC 业务）
  const usageType =
    input.category === "image_edit" || input.category === "fidelity_qa"
      ? ("IMAGE" as const)
      : input.category === "copy" || input.category === "document"
        ? ("TEXT" as const)
        : ("OTHER" as const);
  recordAiUsageBestEffort({
    orgId: input.orgId,
    sourceType: "PRODUCT_CONTENT",
    sourceId: entry.id,
    idempotencyKey: `product_content_cost:${entry.id}`,
    provider: (input.provider ?? "openai").toLowerCase(),
    model: input.model ?? `pc:${input.category}`,
    usageType,
    imageCount: input.category === "image_edit" ? 1 : null,
    durationMs: input.latencyMs ?? null,
    costAmount: centsToUsd(actual),
    currency: input.currency ?? "USD",
    pricingVersion: "product-content-cents-v1",
    pricingMode: "estimated",
    status: "ESTIMATED",
    occurredAt: entry.createdAt,
    metadata: {
      jobId: input.jobId,
      category: input.category,
      pricingMode: "estimated",
    },
  });

  return { entry, summary };
}

export async function summarizeJobCost(
  orgId: string,
  jobId: string,
): Promise<JobCostSummary> {
  const [entries, settings] = await Promise.all([
    db.productContentCostEntry.findMany({ where: { orgId, jobId } }),
    getOrCreateApprovalSettings(orgId),
  ]);

  const byCategory: Record<string, { estimatedCents: number; actualCents: number }> =
    {};
  let estimatedCents = 0;
  let actualCents = 0;

  for (const e of entries) {
    estimatedCents += e.estimatedCents;
    actualCents += e.actualCents;
    if (!byCategory[e.category]) {
      byCategory[e.category] = { estimatedCents: 0, actualCents: 0 };
    }
    byCategory[e.category].estimatedCents += e.estimatedCents;
    byCategory[e.category].actualCents += e.actualCents;
  }

  const budgetCents = settings.maxAutoCostPerJobCents ?? null;
  const withinBudget = budgetCents == null || estimatedCents <= budgetCents;

  return { estimatedCents, actualCents, byCategory, budgetCents, withinBudget };
}

export async function checkJobBudget(orgId: string, jobId: string) {
  const summary = await summarizeJobCost(orgId, jobId);
  if (summary.budgetCents == null) {
    return { allowed: true as const, summary };
  }
  if (summary.estimatedCents > summary.budgetCents) {
    return {
      allowed: false as const,
      summary,
      reason: `预估成本 ${summary.estimatedCents} 分超出预算 ${summary.budgetCents} 分`,
    };
  }
  return { allowed: true as const, summary };
}

/** 图像编辑单次预估成本（美分） */
export function estimateImageEditCostCents(mode: string): number {
  if (mode === "EXACT") return 8;
  if (mode === "STUDIO") return 12;
  return 15;
}
