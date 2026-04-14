/**
 * 商机生命周期自动化引擎
 *
 * 事件驱动的阶段推进：
 *   报价创建 → quoted + 回填金额
 *   客户查看报价 → negotiation
 *   客户签约 → signed
 *   创建量房预约 → measure_booked（已有，此处统一）
 *   工单生产 → producing
 *   安装排期 → installing
 *   安装完成 → completed
 */

import { db } from "@/lib/db";

const STAGE_ORDER = [
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
  "signed",
  "producing",
  "installing",
  "completed",
] as const;

type Stage = (typeof STAGE_ORDER)[number] | "lost" | "on_hold";

/**
 * 只向前推进（不回退），且不影响 lost/on_hold 状态
 */
function shouldAdvance(currentStage: string, targetStage: string): boolean {
  if (currentStage === "lost" || currentStage === "on_hold") return false;
  if (currentStage === "completed") return false;

  const currentIdx = STAGE_ORDER.indexOf(currentStage as typeof STAGE_ORDER[number]);
  const targetIdx = STAGE_ORDER.indexOf(targetStage as typeof STAGE_ORDER[number]);

  if (currentIdx === -1 || targetIdx === -1) return false;
  return targetIdx > currentIdx;
}

interface AdvanceResult {
  advanced: boolean;
  previousStage: string;
  newStage: string;
  opportunityId: string;
}

async function advanceStage(
  opportunityId: string,
  targetStage: Stage,
  extraData?: Record<string, unknown>,
): Promise<AdvanceResult> {
  const opp = await db.salesOpportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, stage: true },
  });

  if (!opp) return { advanced: false, previousStage: "", newStage: "", opportunityId };

  if (!shouldAdvance(opp.stage, targetStage)) {
    return { advanced: false, previousStage: opp.stage, newStage: opp.stage, opportunityId };
  }

  await db.salesOpportunity.update({
    where: { id: opportunityId },
    data: { stage: targetStage, ...extraData },
  });

  return {
    advanced: true,
    previousStage: opp.stage,
    newStage: targetStage,
    opportunityId,
  };
}

/**
 * 报价创建时：自动关联商机 + 推进到 quoted + 回填金额
 */
export async function onQuoteCreated(
  quoteId: string,
  customerId: string,
  grandTotal: number,
  explicitOpportunityId?: string | null,
): Promise<{ opportunityId: string | null; advanced: boolean }> {
  let opportunityId = explicitOpportunityId || null;

  // 如果没有明确指定商机，尝试自动匹配
  if (!opportunityId) {
    const activeOpps = await db.salesOpportunity.findMany({
      where: {
        customerId,
        stage: { notIn: ["lost", "completed", "on_hold"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    if (activeOpps.length === 1) {
      opportunityId = activeOpps[0].id;
    }
    // 多个活跃商机时不自动关联，需前端选择
  }

  if (opportunityId) {
    // 关联报价到商机
    await db.salesQuote.update({
      where: { id: quoteId },
      data: { opportunityId },
    });

    // 推进阶段 + 回填报价金额
    const result = await advanceStage(opportunityId, "quoted", {
      estimatedValue: grandTotal,
    });

    return { opportunityId, advanced: result.advanced };
  }

  return { opportunityId: null, advanced: false };
}

/**
 * 客户查看报价时：推进到 negotiation
 */
export async function onQuoteViewed(quoteId: string): Promise<AdvanceResult | null> {
  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    select: { opportunityId: true },
  });

  if (!quote?.opportunityId) return null;

  return advanceStage(quote.opportunityId, "negotiation");
}

/**
 * 客户签约时：推进到 signed
 */
export async function onQuoteSigned(quoteId: string): Promise<AdvanceResult | null> {
  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    select: { opportunityId: true, grandTotal: true },
  });

  if (!quote?.opportunityId) return null;

  return advanceStage(quote.opportunityId, "signed", {
    wonAt: new Date(),
    estimatedValue: quote.grandTotal,
  });
}

/**
 * 创建量房预约时：推进到 measure_booked
 */
export async function onMeasureBooked(
  opportunityId: string,
  measureDate: Date,
): Promise<AdvanceResult> {
  return advanceStage(opportunityId, "measure_booked", {
    measureDate,
  });
}

/**
 * 给客户查找可关联的活跃商机列表（供前端选择器使用）
 */
export async function getActiveOpportunities(customerId: string) {
  return db.salesOpportunity.findMany({
    where: {
      customerId,
      stage: { notIn: ["lost", "completed", "on_hold"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      stage: true,
      estimatedValue: true,
      productTypes: true,
    },
  });
}

/**
 * Deal 成交时：触发 RAG 分析 + 画像更新 + 洞察提炼
 */
export async function onDealWon(opportunityId: string): Promise<void> {
  const { analyzeDealOutcome } = await import("./insight-extractor");
  const { updateCustomerProfile } = await import("./profile-engine");
  const { attributeOutcome } = await import("./coaching-service");

  const opp = await db.salesOpportunity.findUnique({
    where: { id: opportunityId },
    select: { customerId: true, estimatedValue: true },
  });

  analyzeDealOutcome(opportunityId, "won").catch((e) =>
    console.error("[Lifecycle] Won deal analysis failed:", e),
  );

  attributeOutcome(opportunityId, "won", opp?.estimatedValue ?? undefined).catch((e) =>
    console.error("[Lifecycle] Coaching attribution on won failed:", e),
  );

  if (opp?.customerId) {
    updateCustomerProfile({
      customerId: opp.customerId,
      dealOutcome: "won",
    }).catch((e) =>
      console.error("[Lifecycle] Profile update on won failed:", e),
    );
  }
}

/**
 * Deal 丢单时：触发 RAG 分析 + 画像更新
 */
export async function onDealLost(opportunityId: string): Promise<void> {
  const { analyzeDealOutcome } = await import("./insight-extractor");
  const { updateCustomerProfile } = await import("./profile-engine");
  const { attributeOutcome } = await import("./coaching-service");

  const opp = await db.salesOpportunity.findUnique({
    where: { id: opportunityId },
    select: { customerId: true, estimatedValue: true },
  });

  analyzeDealOutcome(opportunityId, "lost").catch((e) =>
    console.error("[Lifecycle] Lost deal analysis failed:", e),
  );

  attributeOutcome(opportunityId, "lost", opp?.estimatedValue ?? undefined).catch((e) =>
    console.error("[Lifecycle] Coaching attribution on lost failed:", e),
  );

  if (opp?.customerId) {
    updateCustomerProfile({
      customerId: opp.customerId,
      dealOutcome: "lost",
    }).catch((e) =>
      console.error("[Lifecycle] Profile update on lost failed:", e),
    );
  }
}
