/**
 * T2-P1.6 落标结构化复盘（Tender Loss Review）
 *
 * 硬边界（任务书 §10 / §15）：
 * - AI **只能**写 `aiSuggested*` 三列；`primaryLossReason` / `secondaryLossReasons` 只能由
 *   `confirmLossReview()` 这条**人工**路径写入，且必须带 `humanConfirmedById`（LOSS-02 / LOSS-03）。
 *   `suggestLossReasons()` 结构上无法写最终原因 —— 它连 `primaryLossReason` 字段都不 update。
 * - primary 至多一个；secondary 可多个且不得与 primary 重复。
 * - 落标项目的费用**继续保留**（本服务不碰任何 ProjectCost / expense）。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import type { LedgerActor } from "@/lib/project-ledger/types";
import {
  lossReviewAiSuggestedEventKey,
  lossReviewConfirmedEventKey,
  lossReviewCreatedEventKey,
} from "./event-keys";
import { isProfitabilitySchemaReady } from "./flags";
import { dec, roundMoney, type DecimalInput } from "./money";
import {
  FinanceContractError,
  FinanceTenantError,
  LossReviewError,
  TENDER_LOSS_REASONS,
  resolveTenderOutcome,
  type TenderLossReason,
} from "./types";

type Tx = Prisma.TransactionClient;

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

function assertSchemaReady() {
  if (!isProfitabilitySchemaReady()) {
    throw new FinanceContractError(
      "落标复盘功能未启用（TENDER_PROFITABILITY_SCHEMA_READY=OFF）",
      404,
    );
  }
}

function assertReason(v: string): asserts v is TenderLossReason {
  if (!(TENDER_LOSS_REASONS as readonly string[]).includes(v)) {
    throw new LossReviewError(`落标原因非法: ${v}`, 400);
  }
}

/** 复盘草稿（幂等：每项目至多一条，重复调用返回既有）。 */
export async function ensureLossReview(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  createdById: string;
  notes?: string | null;
}) {
  assertSchemaReady();
  return inTx(input.tx, async (tx) => {
    const existing = await tx.projectTenderLossReview.findFirst({
      where: { projectId: input.projectId, orgId: input.orgId },
    });
    if (existing) return { review: existing, created: false as const };

    const project = await tx.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      select: { id: true, bidPhaseStatus: true, tenderStatus: true, workDomain: true, submittedAt: true },
    });
    if (!project) throw new FinanceTenantError();

    const outcome = resolveTenderOutcome(project);
    if (outcome !== "LOST") {
      throw new LossReviewError(
        `仅落标项目可建落标复盘；当前结果 ${outcome}（结果读自 tenderStatus / bidPhaseStatus，本服务不新造 outcome 状态）`,
      );
    }

    const review = await tx.projectTenderLossReview.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        status: "DRAFT",
        secondaryLossReasons: [],
        aiSuggestedSecondaryReasons: [],
        notes: input.notes?.trim() || null,
        createdById: input.createdById,
      },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "tender.loss_review_created",
      eventKey: lossReviewCreatedEventKey(review.id),
      occurredAt: review.createdAt,
      actor: input.actor,
      title: "落标复盘已创建",
      payload: { schemaVersion: 1, reviewId: review.id, createdById: input.createdById },
      refs: { lossReviewId: review.id },
    });
    return { review, created: true as const };
  });
}

/**
 * 写入 AI 建议（**永远不会**成为最终原因）。
 * 本函数刻意不接受、也不写 primaryLossReason / secondaryLossReasons —— 结构性保证 LOSS-03。
 */
export async function suggestLossReasons(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  suggestedPrimary: string;
  suggestedSecondary?: string[];
  /** 溯源："analysisRun:{id}" | "agentRun:{id}" 等 */
  sourceRef?: string | null;
  createdById: string;
}) {
  assertSchemaReady();
  assertReason(input.suggestedPrimary);
  for (const s of input.suggestedSecondary ?? []) assertReason(s);

  return inTx(input.tx, async (tx) => {
    const { review } = await ensureLossReview({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      actor: input.actor,
      createdById: input.createdById,
    });
    // 建议次数用于事件键版本化（可重复建议）
    const seq = await tx.projectEvent.count({
      where: { projectId: input.projectId, eventType: "tender.loss_review_ai_suggested" },
    });
    const updated = await tx.projectTenderLossReview.update({
      where: { id: review.id },
      data: {
        aiSuggestedPrimaryReason: input.suggestedPrimary,
        aiSuggestedSecondaryReasons: input.suggestedSecondary ?? [],
        aiSuggestionAt: new Date(),
        aiSuggestionSourceRef: input.sourceRef ?? null,
      },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "tender.loss_review_ai_suggested",
      eventKey: lossReviewAiSuggestedEventKey(review.id, seq + 1),
      occurredAt: new Date(),
      actor: input.actor,
      title: `AI 建议落标原因：${input.suggestedPrimary}（待人工确认）`,
      result: "suggested",
      payload: {
        schemaVersion: 1,
        reviewId: review.id,
        suggestedPrimary: input.suggestedPrimary,
        suggestedSecondary: input.suggestedSecondary ?? [],
        sourceRef: input.sourceRef ?? null,
        note: "AI_SUGGESTION_ONLY_NOT_FINAL",
      },
      refs: { lossReviewId: review.id },
    });
    return updated;
  });
}

/**
 * 人工确认最终落标原因（唯一能写 primary/secondary 的路径）。
 * 幂等：已 CONFIRMED 再次调用允许更新内容（复盘可修订），但每次都刷新 humanConfirmed*，
 * 事件键仅认 reviewId（首次确认产生事件；后续修订通过 updatedAt + AuditLog 追溯）。
 */
export async function confirmLossReview(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  /** 服务端可信确认人（必须是真人；AI actor 会被拒） */
  confirmedByUserId: string;
  primaryLossReason: string;
  secondaryLossReasons?: string[];
  evidence?: Prisma.InputJsonValue;
  ourBidAmountCad?: DecimalInput | null;
  winningBidAmountCad?: DecimalInput | null;
  winnerName?: string | null;
  notes?: string | null;
}) {
  assertSchemaReady();
  if (input.actor.actorType !== "user") {
    throw new LossReviewError("最终落标原因必须由人工确认（actorType 必须为 user）", 403);
  }
  if (!input.confirmedByUserId?.trim()) {
    throw new LossReviewError("确认人必填", 400);
  }
  assertReason(input.primaryLossReason);
  const secondary = [...new Set(input.secondaryLossReasons ?? [])];
  for (const s of secondary) assertReason(s);
  if (secondary.includes(input.primaryLossReason)) {
    throw new LossReviewError("次要原因不得与主要原因重复", 400);
  }

  return inTx(input.tx, async (tx) => {
    const { review } = await ensureLossReview({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      actor: input.actor,
      createdById: input.confirmedByUserId,
    });
    const wasConfirmed = review.status === "CONFIRMED";
    const now = new Date();
    const updated = await tx.projectTenderLossReview.update({
      where: { id: review.id },
      data: {
        status: "CONFIRMED",
        primaryLossReason: input.primaryLossReason,
        secondaryLossReasons: secondary,
        ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
        ourBidAmountCad:
          input.ourBidAmountCad != null ? roundMoney(dec(input.ourBidAmountCad)) : null,
        winningBidAmountCad:
          input.winningBidAmountCad != null ? roundMoney(dec(input.winningBidAmountCad)) : null,
        winnerName: input.winnerName?.trim() || null,
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        reviewedById: input.confirmedByUserId,
        reviewedAt: now,
        humanConfirmedById: input.confirmedByUserId,
        humanConfirmedAt: now,
      },
    });

    if (!wasConfirmed) {
      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        eventType: "tender.loss_review_confirmed",
        eventKey: lossReviewConfirmedEventKey(review.id),
        occurredAt: now,
        actor: input.actor,
        title: `落标原因已人工确认：${input.primaryLossReason}`,
        result: "confirmed",
        actors: [
          {
            actorKey: `user:${input.confirmedByUserId}`,
            userId: input.confirmedByUserId,
            role: "approver",
          },
        ],
        payload: {
          schemaVersion: 1,
          reviewId: review.id,
          primaryLossReason: input.primaryLossReason,
          secondaryLossReasons: secondary,
          aiSuggestedPrimaryReason: review.aiSuggestedPrimaryReason,
          humanConfirmedById: input.confirmedByUserId,
          winnerName: updated.winnerName,
        },
        refs: { lossReviewId: review.id },
      });
    }
    return updated;
  });
}

/** 读侧：项目落标复盘。flag OFF → available=false。 */
export async function getLossReview(orgId: string, projectId: string) {
  if (!isProfitabilitySchemaReady()) return { available: false, review: null };
  const r = await db.projectTenderLossReview.findFirst({ where: { orgId, projectId } });
  if (!r) return { available: true, review: null };
  return {
    available: true,
    review: {
      id: r.id,
      status: r.status,
      primaryLossReason: r.primaryLossReason,
      secondaryLossReasons: r.secondaryLossReasons,
      evidence: r.evidence,
      ourBidAmountCad: r.ourBidAmountCad?.toString() ?? null,
      winningBidAmountCad: r.winningBidAmountCad?.toString() ?? null,
      winnerName: r.winnerName,
      notes: r.notes,
      aiSuggestedPrimaryReason: r.aiSuggestedPrimaryReason,
      aiSuggestedSecondaryReasons: r.aiSuggestedSecondaryReasons,
      aiSuggestionAt: r.aiSuggestionAt?.toISOString() ?? null,
      humanConfirmedById: r.humanConfirmedById,
      humanConfirmedAt: r.humanConfirmedAt?.toISOString() ?? null,
      reviewedById: r.reviewedById,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    },
  };
}
