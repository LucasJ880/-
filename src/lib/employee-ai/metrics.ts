/**
 * 试点指标（不做员工排名）
 */

import { db } from "@/lib/db";

export async function getPersonalLearningMetrics(input: {
  orgId: string;
  userId: string;
}) {
  const events = await db.humanFeedbackEvent.findMany({
    where: { orgId: input.orgId, userId: input.userId },
    select: { humanDecision: true, reasonCode: true, feedbackScope: true },
  });
  const total = events.length;
  const accepted = events.filter((e) => e.humanDecision === "accepted").length;
  const edited = events.filter((e) => e.humanDecision === "edited").length;
  const rejected = events.filter((e) => e.humanDecision === "rejected").length;
  const reasonCounts: Record<string, number> = {};
  for (const e of events) {
    if (!e.reasonCode) continue;
    reasonCounts[e.reasonCode] = (reasonCounts[e.reasonCode] || 0) + 1;
  }
  const profile = await db.employeeAiProfile.findUnique({
    where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
  });
  const confirmed =
    ((profile?.manuallyConfirmedPreferences as Record<string, unknown>)
      ?.confirmed as Record<string, unknown>) || {};

  return {
    totalSuggestions: total,
    acceptRate: total ? accepted / total : 0,
    editRate: total ? edited / total : 0,
    rejectRate: total ? rejected / total : 0,
    commonReasonCodes: reasonCounts,
    confirmedPreferenceCount: Object.keys(confirmed).length,
    // 明确不返回排名
    ranking: null,
  };
}

export async function getTeamLearningMetrics(input: { orgId: string }) {
  const events = await db.humanFeedbackEvent.findMany({
    where: {
      orgId: input.orgId,
      feedbackScope: { not: "do_not_learn" },
    },
    select: { humanDecision: true, reasonCode: true },
  });
  const total = events.length;
  const accepted = events.filter((e) => e.humanDecision === "accepted").length;
  const edited = events.filter((e) => e.humanDecision === "edited").length;
  const rejected = events.filter((e) => e.humanDecision === "rejected").length;
  const reasonCounts: Record<string, number> = {};
  for (const e of events) {
    if (!e.reasonCode) continue;
    reasonCounts[e.reasonCode] = (reasonCounts[e.reasonCode] || 0) + 1;
  }

  const [candidates, playbooks, outcomesLinked] = await Promise.all([
    db.candidatePractice.count({ where: { orgId: input.orgId } }),
    db.rolePlaybook.count({ where: { orgId: input.orgId, status: "active" } }),
    db.businessOutcome.count({
      where: { orgId: input.orgId, feedbackEventId: { not: null } },
    }),
  ]);

  return {
    usageCount: total,
    acceptRate: total ? accepted / total : 0,
    editRate: total ? edited / total : 0,
    rejectRate: total ? rejected / total : 0,
    commonErrorTypes: reasonCounts,
    outcomeLinkRate: total ? outcomesLinked / total : 0,
    candidatePracticeCount: candidates,
    activePlaybookCount: playbooks,
    employeeRanking: null,
    note: "本面板不做员工绩效排名",
  };
}
