/**
 * 候选工作方法提取（后台周任务；不足条件不生成）
 */

import { db } from "@/lib/db";
import { isLearnableForTeam } from "./feedback-service";
import { isStrongOutcomeEvidence } from "./outcome-service";

export const MIN_FEEDBACK = 5;
export const MIN_EMPLOYEES = 2;
export const MIN_OUTCOMES = 2;

export interface MineResult {
  created: number;
  skippedReason?: string;
  practiceIds: string[];
}

export function meetsMiningThresholds(input: {
  feedbackCount: number;
  uniqueUsers: number;
  strongOutcomes: number;
}): { ok: boolean; reason?: string } {
  if (input.feedbackCount < MIN_FEEDBACK) {
    return { ok: false, reason: `反馈不足（需≥${MIN_FEEDBACK}）` };
  }
  if (input.uniqueUsers < MIN_EMPLOYEES) {
    return { ok: false, reason: `员工数不足（需≥${MIN_EMPLOYEES}）` };
  }
  if (input.strongOutcomes < MIN_OUTCOMES) {
    return { ok: false, reason: `可验证 Outcome 不足（需≥${MIN_OUTCOMES}）` };
  }
  return { ok: true };
}

/** 纯函数：从反馈中识别「首次跟进删除折扣」模式 */
export function detectNoDiscountFirstTouchPattern(
  events: Array<{
    id: string;
    userId: string;
    feedbackScope: string;
    humanDecision: string;
    diffSummary: unknown;
    taskType: string;
  }>,
  outcomes: Array<{
    id: string;
    feedbackEventId: string | null;
    sourceType: string;
    manuallyVerified: boolean;
    confidence: number;
  }>,
): {
  title: string;
  description: string;
  feedbackIds: string[];
  outcomeIds: string[];
  uniqueUsers: number;
  confidence: number;
} | null {
  const teamEvents = events.filter(
    (e) =>
      isLearnableForTeam(e.feedbackScope) &&
      e.humanDecision === "edited" &&
      /follow|跟进|mail|email|quote/i.test(e.taskType),
  );
  const matched = teamEvents.filter((e) => {
    const diff = e.diffSummary as { notes?: string[] } | null;
    return diff?.notes?.some((n) => n.includes("折扣"));
  });
  const users = new Set(matched.map((e) => e.userId));
  const feedbackIds = matched.map((e) => e.id);
  const relatedOutcomes = outcomes.filter(
    (o) =>
      o.feedbackEventId &&
      feedbackIds.includes(o.feedbackEventId) &&
      isStrongOutcomeEvidence(o),
  );
  const gate = meetsMiningThresholds({
    feedbackCount: matched.length,
    uniqueUsers: users.size,
    strongOutcomes: relatedOutcomes.length,
  });
  if (!gate.ok) return null;

  return {
    title: "商业客户首次跟进不主动提出折扣",
    description:
      "多位销售在首次跟进草稿中删除折扣表述，且关联可验证业务结果更好。建议首次跟进聚焦价值与下一步，折扣留待后续谈判。",
    feedbackIds,
    outcomeIds: relatedOutcomes.map((o) => o.id),
    uniqueUsers: users.size,
    confidence: Math.min(
      0.95,
      0.5 + matched.length * 0.05 + relatedOutcomes.length * 0.05,
    ),
  };
}

export async function mineCandidatePractices(input: {
  orgId: string;
  department?: string;
  roleScope?: string;
  generatedByRunId?: string;
}): Promise<MineResult> {
  const department = input.department ?? "sales";
  const roleScope = input.roleScope ?? "sales";

  const events = await db.humanFeedbackEvent.findMany({
    where: {
      orgId: input.orgId,
      feedbackScope: "team_candidate",
      createdAt: { gte: new Date(Date.now() - 90 * 86400000) },
    },
    take: 500,
    select: {
      id: true,
      userId: true,
      feedbackScope: true,
      humanDecision: true,
      diffSummary: true,
      taskType: true,
    },
  });

  const outcomes = await db.businessOutcome.findMany({
    where: {
      orgId: input.orgId,
      feedbackEventId: { not: null },
      createdAt: { gte: new Date(Date.now() - 90 * 86400000) },
    },
    take: 500,
    select: {
      id: true,
      feedbackEventId: true,
      sourceType: true,
      manuallyVerified: true,
      confidence: true,
    },
  });

  const pattern = detectNoDiscountFirstTouchPattern(events, outcomes);
  if (!pattern) {
    return {
      created: 0,
      skippedReason: "未达最低生成条件或无匹配模式",
      practiceIds: [],
    };
  }

  // 避免重复：同标题 pending/draft 已存在则跳过
  const existing = await db.candidatePractice.findFirst({
    where: {
      orgId: input.orgId,
      title: pattern.title,
      status: { in: ["draft", "pending_review"] },
    },
  });
  if (existing) {
    return { created: 0, skippedReason: "已有待审候选", practiceIds: [existing.id] };
  }

  const created = await db.candidatePractice.create({
    data: {
      orgId: input.orgId,
      department,
      roleScope,
      title: pattern.title,
      description: pattern.description,
      triggerConditions: {
        customerType: "commercial",
        stage: "first_followup",
      },
      recommendedProcess: {
        steps: [
          "确认报价已收到",
          "强调价值与交付优势",
          "提出明确下一步（会议/现场测量）",
          "首次跟进不主动提折扣",
        ],
      },
      exceptions: {
        notes: ["客户主动询价折扣时可回应，但需记录原因"],
      },
      evidenceSummary: {
        uniqueUsers: pattern.uniqueUsers,
        feedbackCount: pattern.feedbackIds.length,
        outcomeCount: pattern.outcomeIds.length,
      },
      supportingFeedbackIds: pattern.feedbackIds,
      supportingOutcomeIds: pattern.outcomeIds,
      evidenceCount: pattern.feedbackIds.length,
      confidence: pattern.confidence,
      status: "pending_review",
      generatedByRunId: input.generatedByRunId,
    },
  });

  return { created: 1, practiceIds: [created.id] };
}
