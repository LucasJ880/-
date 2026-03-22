import { db } from "@/lib/db";
import type {
  DashboardRange,
  DashboardOverview,
  DashboardTrends,
  DashboardQuality,
  DashboardRuntime,
  DashboardAssets,
  MetricWithDelta,
  TrendPoint,
} from "./types";
import { buildDashboardRangeToronto, formatISODateToronto } from "@/lib/time";

export function buildRange(days: number): DashboardRange {
  return buildDashboardRangeToronto(days);
}

function delta(current: number, previous: number): MetricWithDelta {
  const d = current - previous;
  const dp = previous === 0 ? (current > 0 ? 100 : 0) : Math.round((d / previous) * 100);
  return { current, previous, delta: d, deltaPercent: dp };
}

function formatDate(d: Date): string {
  return formatISODateToronto(d);
}

function buildDayBuckets(range: DashboardRange): Map<string, number> {
  const map = new Map<string, number>();
  const cur = new Date(range.start);
  while (cur <= range.end) {
    map.set(formatDate(cur), 0);
    cur.setDate(cur.getDate() + 1);
  }
  return map;
}

export async function queryOverview(
  projectId: string,
  range: DashboardRange
): Promise<DashboardOverview> {
  const [
    totalConvCurrent,
    totalConvPrev,
    recentConvCurrent,
    recentConvPrev,
    autoEvalCurrent,
    autoEvalPrev,
    humanFbCurrent,
    humanFbPrev,
    lowScoreCurrent,
    lowScorePrev,
    runtimeFailCurrent,
    runtimeFailPrev,
    openFeedbacks,
    highPriorityNotifs,
  ] = await Promise.all([
    db.conversation.count({ where: { projectId, startedAt: { lte: range.end } } }),
    db.conversation.count({ where: { projectId, startedAt: { lte: range.prevEnd } } }),
    db.conversation.count({ where: { projectId, startedAt: { gte: range.start, lte: range.end } } }),
    db.conversation.count({ where: { projectId, startedAt: { gte: range.prevStart, lte: range.prevEnd } } }),
    db.evaluationRun.aggregate({ where: { projectId, createdAt: { gte: range.start, lte: range.end } }, _avg: { score: true }, _count: true }),
    db.evaluationRun.aggregate({ where: { projectId, createdAt: { gte: range.prevStart, lte: range.prevEnd } }, _avg: { score: true }, _count: true }),
    db.conversationFeedback.aggregate({ where: { projectId, createdAt: { gte: range.start, lte: range.end } }, _avg: { rating: true }, _count: true }),
    db.conversationFeedback.aggregate({ where: { projectId, createdAt: { gte: range.prevStart, lte: range.prevEnd } }, _avg: { rating: true }, _count: true }),
    db.evaluationRun.count({ where: { projectId, createdAt: { gte: range.start, lte: range.end }, score: { lte: 3 } } }),
    db.evaluationRun.count({ where: { projectId, createdAt: { gte: range.prevStart, lte: range.prevEnd }, score: { lte: 3 } } }),
    db.conversation.count({ where: { projectId, runtimeStatus: "failed", startedAt: { gte: range.start, lte: range.end } } }),
    db.conversation.count({ where: { projectId, runtimeStatus: "failed", startedAt: { gte: range.prevStart, lte: range.prevEnd } } }),
    db.conversationFeedback.count({ where: { projectId, status: "open" } }),
    db.notification.count({ where: { projectId, status: "unread", priority: { in: ["high", "urgent"] } } }),
  ]);

  const avgAutoC = autoEvalCurrent._avg.score ?? 0;
  const avgAutoP = autoEvalPrev._avg.score ?? 0;
  const avgHumanC = humanFbCurrent._avg.rating ?? 0;
  const avgHumanP = humanFbPrev._avg.rating ?? 0;

  return {
    totalConversations: delta(totalConvCurrent, totalConvPrev),
    recentConversations: delta(recentConvCurrent, recentConvPrev),
    avgAutoScore: delta(Math.round(avgAutoC * 10) / 10, Math.round(avgAutoP * 10) / 10),
    avgHumanScore: delta(Math.round(avgHumanC * 10) / 10, Math.round(avgHumanP * 10) / 10),
    lowScoreCount: delta(lowScoreCurrent, lowScorePrev),
    runtimeFailures: delta(runtimeFailCurrent, runtimeFailPrev),
    openFeedbacks,
    highPriorityNotifications: highPriorityNotifs,
  };
}

export async function queryTrends(
  projectId: string,
  range: DashboardRange
): Promise<DashboardTrends> {
  const convBuckets = buildDayBuckets(range);
  const evalBuckets = buildDayBuckets(range);
  const fbBuckets = buildDayBuckets(range);
  const failBuckets = buildDayBuckets(range);

  const [conversations, evaluations, feedbacks, failures] = await Promise.all([
    db.conversation.findMany({
      where: { projectId, startedAt: { gte: range.start, lte: range.end } },
      select: { startedAt: true },
    }),
    db.evaluationRun.findMany({
      where: { projectId, createdAt: { gte: range.start, lte: range.end } },
      select: { createdAt: true, score: true },
    }),
    db.conversationFeedback.findMany({
      where: { projectId, createdAt: { gte: range.start, lte: range.end } },
      select: { createdAt: true },
    }),
    db.conversation.findMany({
      where: { projectId, runtimeStatus: "failed", startedAt: { gte: range.start, lte: range.end } },
      select: { startedAt: true },
    }),
  ]);

  for (const c of conversations) {
    const d = formatDate(c.startedAt);
    convBuckets.set(d, (convBuckets.get(d) ?? 0) + 1);
  }

  const evalScoreBuckets = new Map<string, { sum: number; count: number }>();
  for (const [key] of evalBuckets) {
    evalScoreBuckets.set(key, { sum: 0, count: 0 });
  }
  for (const e of evaluations) {
    const d = formatDate(e.createdAt);
    const bucket = evalScoreBuckets.get(d);
    if (bucket && e.score != null) {
      bucket.sum += e.score;
      bucket.count += 1;
    }
  }
  for (const [key, val] of evalScoreBuckets) {
    evalBuckets.set(key, val.count > 0 ? Math.round((val.sum / val.count) * 10) / 10 : 0);
  }

  for (const f of feedbacks) {
    const d = formatDate(f.createdAt);
    fbBuckets.set(d, (fbBuckets.get(d) ?? 0) + 1);
  }

  for (const f of failures) {
    const d = formatDate(f.startedAt);
    failBuckets.set(d, (failBuckets.get(d) ?? 0) + 1);
  }

  const toTrend = (m: Map<string, number>): TrendPoint[] =>
    Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));

  return {
    conversations: toTrend(convBuckets),
    evaluationScores: toTrend(evalBuckets),
    feedbacks: toTrend(fbBuckets),
    runtimeFailures: toTrend(failBuckets),
  };
}

export async function queryQuality(
  projectId: string,
  range: DashboardRange
): Promise<DashboardQuality> {
  const [autoAgg, humanAgg, issueDist, lowScores, negFeedbacks] = await Promise.all([
    db.evaluationRun.aggregate({
      where: { projectId, createdAt: { gte: range.start, lte: range.end } },
      _avg: { score: true },
      _count: true,
    }),
    db.conversationFeedback.aggregate({
      where: { projectId, createdAt: { gte: range.start, lte: range.end } },
      _avg: { rating: true },
      _count: true,
    }),
    db.conversationFeedback.groupBy({
      by: ["issueType"],
      where: { projectId, issueType: { not: null }, createdAt: { gte: range.start, lte: range.end } },
      _count: true,
    }),
    db.evaluationRun.findMany({
      where: { projectId, score: { lte: 3 }, createdAt: { gte: range.start, lte: range.end } },
      select: { id: true, score: true, createdAt: true, conversationId: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.conversationFeedback.findMany({
      where: { projectId, rating: { lte: 2 }, createdAt: { gte: range.start, lte: range.end } },
      select: { id: true, rating: true, note: true, createdAt: true, conversationId: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    avgAutoScore: autoAgg._avg.score != null ? Math.round(autoAgg._avg.score * 10) / 10 : null,
    avgHumanRating: humanAgg._avg.rating != null ? Math.round(humanAgg._avg.rating * 10) / 10 : null,
    totalAutoEvaluations: autoAgg._count,
    totalHumanFeedbacks: humanAgg._count,
    issueDistribution: issueDist.map((d) => ({
      type: d.issueType ?? "unknown",
      count: d._count,
    })),
    recentLowScores: lowScores.map((s) => ({
      id: s.id,
      score: s.score ?? 0,
      createdAt: s.createdAt.toISOString(),
      conversationId: s.conversationId,
    })),
    recentNegativeFeedbacks: negFeedbacks.map((f) => ({
      id: f.id,
      rating: f.rating,
      note: f.note,
      createdAt: f.createdAt.toISOString(),
      conversationId: f.conversationId,
    })),
  };
}

export async function queryRuntime(
  projectId: string,
  range: DashboardRange
): Promise<DashboardRuntime> {
  const [total, successes, failures, latencyAgg, toolCalls, recentFails] = await Promise.all([
    db.conversation.count({
      where: { projectId, runCount: { gt: 0 }, startedAt: { gte: range.start, lte: range.end } },
    }),
    db.conversation.count({
      where: { projectId, runtimeStatus: "idle", runCount: { gt: 0 }, startedAt: { gte: range.start, lte: range.end } },
    }),
    db.conversation.count({
      where: { projectId, runtimeStatus: "failed", startedAt: { gte: range.start, lte: range.end } },
    }),
    db.conversation.aggregate({
      where: { projectId, runCount: { gt: 0 }, avgLatencyMs: { gt: 0 }, startedAt: { gte: range.start, lte: range.end } },
      _avg: { avgLatencyMs: true },
    }),
    db.toolCallTrace.count({
      where: {
        projectId,
        createdAt: { gte: range.start, lte: range.end },
      },
    }),
    db.conversation.findMany({
      where: { projectId, runtimeStatus: "failed", startedAt: { gte: range.start, lte: range.end } },
      select: { id: true, title: true, lastErrorMessage: true, startedAt: true },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    totalRuns: total,
    successCount: successes,
    failureCount: failures,
    successRate: total > 0 ? Math.round((successes / total) * 1000) / 10 : 100,
    avgLatencyMs: latencyAgg._avg.avgLatencyMs != null ? Math.round(latencyAgg._avg.avgLatencyMs) : null,
    toolCallCount: toolCalls,
    recentFailures: recentFails.map((f) => ({
      id: f.id,
      title: f.title || "无标题会话",
      error: f.lastErrorMessage,
      createdAt: f.startedAt.toISOString(),
    })),
  };
}

export async function queryAssets(
  projectId: string,
  range: DashboardRange
): Promise<DashboardAssets> {
  const [counts, docCount, toolCount, recentPublishes] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        _count: {
          select: {
            prompts: true,
            knowledgeBases: true,
            agents: true,
            environments: true,
          },
        },
      },
    }),
    db.knowledgeDocument.count({
      where: { knowledgeBase: { projectId } },
    }),
    db.toolRegistry.count({ where: { projectId } }),
    db.auditLog.count({
      where: {
        projectId,
        action: { in: ["publish_prompt", "publish_knowledge_base"] },
        createdAt: { gte: range.start, lte: range.end },
      },
    }),
  ]);

  const c = counts?._count;
  return {
    prompts: c?.prompts ?? 0,
    knowledgeBases: c?.knowledgeBases ?? 0,
    documents: docCount,
    agents: c?.agents ?? 0,
    tools: toolCount,
    environments: c?.environments ?? 0,
    recentPublishes,
  };
}
