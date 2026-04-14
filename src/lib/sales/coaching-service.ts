/**
 * Coaching 自学习服务
 *
 * 管理 AI 销售建议的全生命周期：
 * 1. 创建建议记录（CoachingRecord）
 * 2. 记录销售是否采纳
 * 3. deal 关闭时自动归因效果
 * 4. 反向更新 SalesInsight effectiveness
 */

import { db } from "@/lib/db";

interface CreateCoachingInput {
  userId: string;
  customerId: string;
  opportunityId?: string;
  insightId?: string;
  coachingType: "tactic" | "objection_response" | "email_draft" | "next_action";
  recommendation: string;
  context?: Record<string, string | number | boolean | null>;
}

export async function createCoachingRecord(
  input: CreateCoachingInput,
): Promise<{ id: string }> {
  const record = await db.coachingRecord.create({
    data: {
      userId: input.userId,
      customerId: input.customerId,
      opportunityId: input.opportunityId,
      insightId: input.insightId,
      coachingType: input.coachingType,
      recommendation: input.recommendation,
      context: input.context as Record<string, string | number | boolean | null> ?? undefined,
    },
    select: { id: true },
  });
  return record;
}

export async function recordAdoption(
  recordId: string,
  adopted: boolean,
): Promise<void> {
  await db.coachingRecord.update({
    where: { id: recordId },
    data: {
      adopted,
      adoptedAt: adopted ? new Date() : null,
    },
  });
}

/**
 * deal 关闭时，自动归因所有关联的 CoachingRecord
 * 并反向更新 SalesInsight 的 effectiveness
 */
export async function attributeOutcome(
  opportunityId: string,
  outcome: "won" | "lost",
  dealValue?: number,
): Promise<{ updated: number }> {
  const records = await db.coachingRecord.findMany({
    where: {
      opportunityId,
      outcome: null,
    },
    select: { id: true, insightId: true, adopted: true, createdAt: true },
  });

  if (records.length === 0) return { updated: 0 };

  const now = new Date();

  let updated = 0;
  for (const record of records) {
    const daysToOutcome = Math.ceil(
      (now.getTime() - record.createdAt.getTime()) / 86_400_000,
    );

    // 贡献分：采纳 + 成单 = 高分；采纳 + 丢单 = 低分；未采纳 = 中性
    let contributionScore = 0.5;
    if (record.adopted === true && outcome === "won") contributionScore = 0.9;
    else if (record.adopted === true && outcome === "lost") contributionScore = 0.2;
    else if (record.adopted === false && outcome === "won") contributionScore = 0.4;
    else if (record.adopted === false && outcome === "lost") contributionScore = 0.5;

    await db.coachingRecord.update({
      where: { id: record.id },
      data: {
        outcome,
        outcomeAt: now,
        daysToOutcome,
        dealValue: dealValue ?? null,
        contributionScore,
      },
    });

    updated++;

    if (record.insightId) {
      await updateInsightEffectiveness(record.insightId);
    }
  }

  return { updated };
}

/**
 * 根据所有关联的 CoachingRecord 重新计算 SalesInsight 的 effectiveness
 *
 * 公式：加权平均
 *   - adopted + won → 权重 1.0
 *   - adopted + lost → 权重 0.8（负面证据很重要）
 *   - not adopted + won → 权重 0.3（建议没被采纳但成单了，说明可能无关）
 *   - not adopted + lost → 权重 0.2
 */
async function updateInsightEffectiveness(insightId: string): Promise<void> {
  const records = await db.coachingRecord.findMany({
    where: { insightId, outcome: { not: null } },
    select: { adopted: true, outcome: true, contributionScore: true },
  });

  if (records.length < 2) return;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of records) {
    let weight = 0.3;
    if (r.adopted === true && r.outcome === "won") weight = 1.0;
    else if (r.adopted === true && r.outcome === "lost") weight = 0.8;
    else if (r.adopted === false && r.outcome === "won") weight = 0.3;
    else if (r.adopted === false && r.outcome === "lost") weight = 0.2;

    const score = r.contributionScore ?? 0.5;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  const effectiveness = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

  await db.salesInsight.update({
    where: { id: insightId },
    data: {
      effectiveness: Math.max(0, Math.min(1, effectiveness)),
      usageCount: records.length,
      successCount: records.filter((r) => r.adopted && r.outcome === "won").length,
    },
  });
}

/**
 * 获取某客户/商机的 coaching 统计
 */
export async function getCoachingStats(filters: {
  userId?: string;
  customerId?: string;
  opportunityId?: string;
}): Promise<{
  total: number;
  adopted: number;
  adoptionRate: number;
  wonWithAdoption: number;
  avgContribution: number;
}> {
  const where: Record<string, unknown> = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.opportunityId) where.opportunityId = filters.opportunityId;

  const all = await db.coachingRecord.findMany({
    where,
    select: { adopted: true, outcome: true, contributionScore: true },
  });

  const total = all.length;
  const adopted = all.filter((r) => r.adopted === true).length;
  const wonWithAdoption = all.filter(
    (r) => r.adopted === true && r.outcome === "won",
  ).length;
  const withContrib = all.filter((r) => r.contributionScore != null);
  const avgContribution =
    withContrib.length > 0
      ? withContrib.reduce((s, r) => s + (r.contributionScore ?? 0), 0) / withContrib.length
      : 0;

  return {
    total,
    adopted,
    adoptionRate: total > 0 ? adopted / total : 0,
    wonWithAdoption,
    avgContribution,
  };
}
