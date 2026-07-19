/**
 * 项目结束复盘：终态触发草稿 → 用户确认写入企业记忆
 */

import { db } from "@/lib/db";
import { computePriceGap } from "@/lib/projects/price-gap";

export const TERMINAL_TENDER_STATUSES = new Set([
  "won",
  "lost",
  "passed",
  "archived",
  "cancelled",
  "no_bid",
  "completed",
  "terminated",
]);

export function mapTenderStatusToOutcome(
  tenderStatus: string | null | undefined,
): string | null {
  const s = (tenderStatus || "").toLowerCase();
  if (s === "won") return "awarded";
  if (s === "lost") return "lost";
  if (s === "passed" || s === "no_bid") return "no_bid";
  if (s === "cancelled") return "cancelled";
  if (s === "completed") return "completed";
  if (s === "terminated") return "terminated";
  if (s === "archived") return "lost";
  return null;
}

export async function maybeCreateReviewDraft(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      orgId: true,
      tenderStatus: true,
      status: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      name: true,
      awardDate: true,
      intelligence: { select: { summary: true, riskLevel: true } },
    },
  });
  if (!project) return null;

  const terminal =
    TERMINAL_TENDER_STATUSES.has((project.tenderStatus || "").toLowerCase()) ||
    project.status === "abandoned" ||
    !!project.awardDate;
  if (!terminal) return null;

  const existing = await db.projectReview.findFirst({
    where: { projectId, status: { in: ["draft", "confirmed"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.status === "confirmed") return existing;
  if (existing?.status === "draft") return existing;

  const outcome =
    project.status === "abandoned"
      ? "cancelled"
      : mapTenderStatusToOutcome(project.tenderStatus);

  const price = computePriceGap({
    ourBidPrice: project.ourBidPrice,
    winningBidPrice: project.winningBidPrice,
    currency: project.currency,
  });

  const reasonTags: string[] = [];
  if (outcome === "lost") {
    reasonTags.push("总报价过高");
    if (price && price.oursPremiumPctVsWinning > 15) {
      reasonTags.push("价格竞争力不足");
    }
  }

  const narrativeParts = [
    `项目「${project.name}」进入终态（${project.tenderStatus || project.status}）。`,
    project.intelligence?.summary
      ? `既有 AI 摘要：${project.intelligence.summary}`
      : "",
    price ? price.summaryLines.join("\n") : "价格信息不完整，请人工补录我方报价与中标价。",
    outcome === "lost"
      ? "建议核对：是否未取得项目专属价、安装/运输成本偏高、资格限制或提交文件遗漏。"
      : "",
  ].filter(Boolean);

  return db.projectReview.create({
    data: {
      orgId: project.orgId,
      projectId,
      status: "draft",
      outcome,
      priceAnalysisJson: price ? JSON.stringify(price) : null,
      reasonTagsJson: JSON.stringify(reasonTags),
      narrative: narrativeParts.join("\n\n"),
    },
  });
}

export async function confirmProjectReview(input: {
  reviewId: string;
  userId: string;
  patch?: {
    outcome?: string;
    reasonTags?: string[];
    narrative?: string;
    customerFeedback?: string;
    ourBidPrice?: number | null;
    winningBidPrice?: number | null;
  };
}) {
  const review = await db.projectReview.findUnique({
    where: { id: input.reviewId },
    include: {
      project: {
        select: {
          id: true,
          orgId: true,
          currency: true,
          ourBidPrice: true,
          winningBidPrice: true,
        },
      },
    },
  });
  if (!review) throw new Error("复盘不存在");
  if (review.status === "confirmed") return review;

  let our = review.project.ourBidPrice;
  let win = review.project.winningBidPrice;
  if (input.patch?.ourBidPrice !== undefined || input.patch?.winningBidPrice !== undefined) {
    our =
      input.patch.ourBidPrice !== undefined
        ? input.patch.ourBidPrice
        : our;
    win =
      input.patch.winningBidPrice !== undefined
        ? input.patch.winningBidPrice
        : win;
    await db.project.update({
      where: { id: review.projectId },
      data: {
        ...(input.patch.ourBidPrice !== undefined
          ? { ourBidPrice: input.patch.ourBidPrice }
          : {}),
        ...(input.patch.winningBidPrice !== undefined
          ? { winningBidPrice: input.patch.winningBidPrice }
          : {}),
      },
    });
  }

  const price = computePriceGap({
    ourBidPrice: our,
    winningBidPrice: win,
    currency: review.project.currency,
  });

  const updated = await db.projectReview.update({
    where: { id: review.id },
    data: {
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedById: input.userId,
      outcome: input.patch?.outcome ?? review.outcome,
      narrative: input.patch?.narrative ?? review.narrative,
      customerFeedback:
        input.patch?.customerFeedback ?? review.customerFeedback,
      reasonTagsJson: input.patch?.reasonTags
        ? JSON.stringify(input.patch.reasonTags)
        : review.reasonTagsJson,
      priceAnalysisJson: price
        ? JSON.stringify(price)
        : review.priceAnalysisJson,
    },
  });

  // 企业记忆：写入已确认 Insight，供后续相似检索/上下文使用
  const tags: string[] = input.patch?.reasonTags
    ? input.patch.reasonTags
    : (() => {
        try {
          return JSON.parse(updated.reasonTagsJson || "[]") as string[];
        } catch {
          return [];
        }
      })();

  await db.projectInsight.create({
    data: {
      orgId: review.project.orgId,
      projectId: review.projectId,
      kind: "lesson",
      title: `复盘确认：${updated.outcome || "结果"}`,
      content: [
        updated.narrative || "",
        tags.length ? `原因标签：${tags.join("、")}` : "",
        price ? price.summaryLines.join("；") : "",
      ]
        .filter(Boolean)
        .join("\n"),
      source: "review",
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedBy: input.userId,
    },
  });

  return updated;
}
