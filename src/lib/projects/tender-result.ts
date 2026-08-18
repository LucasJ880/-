/**
 * 标记招标结果（won / lost / no_bid / cancelled）
 * 这是写入 tenderStatus 终态的产品入口；PATCH /projects 不允许直接改 tenderStatus。
 */

import { db } from "@/lib/db";
import type { OwnResultBackfillOutcome } from "@/lib/tender-intel/own-result-backfill";
import { maybeCreateReviewDraft } from "@/lib/projects/review";

export const TENDER_RESULTS = ["won", "lost", "no_bid", "cancelled"] as const;
export type TenderResult = (typeof TENDER_RESULTS)[number];

export function isTenderResult(v: unknown): v is TenderResult {
  return typeof v === "string" && (TENDER_RESULTS as readonly string[]).includes(v);
}

export async function markProjectTenderResult(input: {
  projectId: string;
  result: TenderResult;
  ourBidPrice?: number | null;
  winningBidPrice?: number | null;
  currency?: string | null;
  awardDate?: string | Date | null;
  note?: string | null;
  actorUserId: string;
}) {
  const before = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      tenderStatus: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      awardDate: true,
      description: true,
    },
  });
  if (!before) throw new Error("项目不存在");

  const awardDate =
    input.awardDate === undefined
      ? undefined
      : input.awardDate
        ? new Date(input.awardDate)
        : null;

  const updated = await db.project.update({
    where: { id: input.projectId },
    data: {
      tenderStatus: input.result,
      ...(input.ourBidPrice !== undefined ? { ourBidPrice: input.ourBidPrice } : {}),
      ...(input.winningBidPrice !== undefined
        ? { winningBidPrice: input.winningBidPrice }
        : {}),
      ...(input.currency !== undefined && input.currency
        ? { currency: input.currency }
        : {}),
      ...(awardDate !== undefined ? { awardDate } : {}),
      ...(input.note
        ? {
            description: [
              before.description || "",
              `[招标结果备注 ${new Date().toISOString().slice(0, 10)}] ${input.note}`,
            ]
              .filter(Boolean)
              .join("\n"),
          }
        : {}),
    },
  });

  const review = await maybeCreateReviewDraft(input.projectId);

  // 情报阶段2：结果标记（human 动作）回灌 canonical——won → 我方 award 事实
  // （幂等 sourceKey）；买家 → T3 Buyer。失败绝不影响结果标记本身；
  // 边界与语义见 tender-intel/own-result-backfill.ts 头注释。
  let canonicalBackfill: OwnResultBackfillOutcome | null = null;
  try {
    const { backfillOwnResultCanonical } = await import(
      "@/lib/tender-intel/own-result-backfill"
    );
    canonicalBackfill = await backfillOwnResultCanonical({
      projectId: input.projectId,
      result: input.result,
      actorUserId: input.actorUserId,
    });
  } catch {
    canonicalBackfill = null;
  }

  return {
    project: updated,
    review,
    canonicalBackfill,
    before: {
      tenderStatus: before.tenderStatus,
      ourBidPrice: before.ourBidPrice,
      winningBidPrice: before.winningBidPrice,
      currency: before.currency,
      awardDate: before.awardDate,
    },
    actorUserId: input.actorUserId,
  };
}
