/**
 * 标记招标结果（won / lost / no_bid / cancelled）
 * 这是写入 tenderStatus 终态的产品入口；PATCH /projects 不允许直接改 tenderStatus。
 * P2-0：未中标时可选填中标方——写进结果备注，并经人工确认路径沉淀为授标事实（见 own-result-backfill）。
 */

import { db } from "@/lib/db";
import type { OwnResultBackfillOutcome } from "@/lib/tender-intel/own-result-backfill";
import { maybeCreateReviewDraft } from "@/lib/projects/review";

export const TENDER_RESULTS = ["won", "lost", "no_bid", "cancelled"] as const;
export type TenderResult = (typeof TENDER_RESULTS)[number];

export function isTenderResult(v: unknown): v is TenderResult {
  return typeof v === "string" && (TENDER_RESULTS as readonly string[]).includes(v);
}

export const WINNER_NAME_MAX = 200;

/**
 * P2-0：结果表单的「中标方（选填）」——只在未中标（lost）时接受；空白视为未填。
 * 返回 { ok: true, winnerName: string | null } 或 { ok: false, error }（路由直接回 400）。
 */
export function parseOutcomeWinner(
  result: TenderResult,
  raw: unknown,
): { ok: true; winnerName: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, winnerName: null };
  if (typeof raw !== "string") return { ok: false, error: "winnerName 必须是文字" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: true, winnerName: null };
  if (result !== "lost") return { ok: false, error: "只有「未中标」时才填写中标方" };
  if (name.length > WINNER_NAME_MAX) return { ok: false, error: `中标方名称不超过 ${WINNER_NAME_MAX} 字` };
  return { ok: true, winnerName: name };
}

/** 中标方是否就是我方组织（按与 AwardRecord 相同的规范化比较） */
export function isOwnOrgWinner(winnerName: string, orgName: string | null | undefined, normalize: (s: string) => string): boolean {
  const own = (orgName ?? "").trim();
  if (!own) return false;
  return normalize(winnerName) === normalize(own);
}

export async function markProjectTenderResult(input: {
  projectId: string;
  result: TenderResult;
  ourBidPrice?: number | null;
  winningBidPrice?: number | null;
  currency?: string | null;
  awardDate?: string | Date | null;
  note?: string | null;
  /** P2-0：未中标时的中标方（已由 parseOutcomeWinner 校验） */
  winnerName?: string | null;
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
      org: { select: { name: true } },
    },
  });
  if (!before) throw new Error("项目不存在");
  const winnerName = input.result === "lost" ? input.winnerName?.trim() || null : null;
  if (winnerName) {
    const { normalizeVendorName } = await import("@/lib/tender-intel/awards");
    if (isOwnOrgWinner(winnerName, before.org?.name, normalizeVendorName)) {
      throw new Error("未中标时，中标方不能填我方组织");
    }
  }
  // 结果备注：用户备注 + 中标方（关掉授标情报开关时，中标方也不会丢）
  const noteLines = [
    input.note ? `[招标结果备注 ${new Date().toISOString().slice(0, 10)}] ${input.note}` : null,
    winnerName ? `[中标方 ${new Date().toISOString().slice(0, 10)}] ${winnerName}` : null,
  ].filter((x): x is string => Boolean(x));

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
      ...(noteLines.length
        ? {
            description: [before.description || "", ...noteLines]
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
      winnerName,
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
