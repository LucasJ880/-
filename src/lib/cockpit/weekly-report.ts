/**
 * AI 周报生成器
 *
 * 基于驾驶舱指标数据，AI 生成结构化周报：
 * - 本周业绩摘要
 * - 关键亮点
 * - 风险与需关注事项
 * - 下周行动建议
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { computeCockpitData } from "./metrics-engine";
import type { CockpitData, WeeklyReport } from "./types";

function getWeekLabel(): string {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - yearStart.getTime()) / 86400000);
  const weekNum = Math.ceil((days + yearStart.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function buildReportPrompt(data: CockpitData): string {
  const m = data.metrics;
  return `你是外贸业务分析师。请根据以下驾驶舱数据，生成一份简洁有力的中文周报。

## 核心指标
- 活跃线索: ${m.activeProspects.value} (${m.activeProspects.trendLabel})
- 回复率: ${m.replyRate.value}% (${m.replyRate.trendLabel})
- 报价总额: $${m.quoteValue.value.toLocaleString()} (${m.quoteValue.trendLabel})
- 成交客户: ${m.wonDeals.value} (${m.wonDeals.trendLabel})

## 漏斗数据
${data.funnel.stages.map((s) => `- ${s.label}: ${s.count}`).join("\n")}
- 总转化率: ${(data.funnel.overallConversion * 100).toFixed(1)}%

## ROI
- 已发开发信: ${data.roi.outreachCount}
- 客户回复: ${data.roi.replyCount}
- 报价金额: $${data.roi.totalQuoteValue.toLocaleString()}
- 成交金额: $${data.roi.wonQuoteValue.toLocaleString()}

## 趋势（最近4周）
新增线索: ${data.trends.newProspects.data.map((p) => p.value).join(" → ")}
客户回复: ${data.trends.replies.data.map((p) => p.value).join(" → ")}
发出报价: ${data.trends.quotesSent.data.map((p) => p.value).join(" → ")}

## 热门活动
${data.topCampaigns.map((c) => `- ${c.name}: ${c.prospects}线索, ${c.qualified}合格, 回复率${(c.replyRate * 100).toFixed(0)}%`).join("\n")}

请严格按以下 JSON 格式输出：
\`\`\`json
{
  "summary": "本周业绩总结（3-5句话，包含关键数据）",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "concerns": ["需关注事项1", "需关注事项2"],
  "recommendations": ["具体建议1", "具体建议2", "具体建议3"]
}
\`\`\`

要求：
- 用数据说话，避免空泛表述
- highlights 选 2-4 个最有价值的正向变化
- concerns 只列真正需要注意的问题（趋势下降、瓶颈等）
- recommendations 给出可执行的下周行动建议`;
}

interface ReportContent {
  summary: string;
  highlights: string[];
  concerns: string[];
  recommendations: string[];
}

function parseReportContent(raw: string): ReportContent {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.summary && Array.isArray(parsed.highlights)) {
      return {
        summary: parsed.summary,
        highlights: parsed.highlights ?? [],
        concerns: parsed.concerns ?? [],
        recommendations: parsed.recommendations ?? [],
      };
    }
  } catch {
    /* parse failed */
  }
  return {
    summary: raw.slice(0, 500),
    highlights: [],
    concerns: [],
    recommendations: [],
  };
}

export async function generateWeeklyReport(orgId: string): Promise<WeeklyReport> {
  const data = await computeCockpitData(orgId);
  const prompt = buildReportPrompt(data);

  const raw = await createCompletion({
    systemPrompt: "你是外贸业务分析师。请严格按照要求的 JSON 格式输出周报。",
    userPrompt: prompt,
    mode: "deep",
    maxTokens: 2000,
  });

  const content = parseReportContent(raw);
  const weekLabel = getWeekLabel();
  const { start, end } = getWeekRange();

  // 存储到 Notification 供前端展示
  const membership = await db.organizationMember.findFirst({
    where: { orgId },
    select: { userId: true },
  });

  if (membership) {
    const sourceKey = `weekly_report_${weekLabel}_${membership.userId}`;
    const metaJson = JSON.stringify({
      weekLabel,
      highlights: content.highlights,
      concerns: content.concerns,
      recommendations: content.recommendations,
      metrics: {
        activeProspects: data.metrics.activeProspects.value,
        replyRate: data.metrics.replyRate.value,
        quoteValue: data.metrics.quoteValue.value,
        wonDeals: data.metrics.wonDeals.value,
      },
    });

    await db.notification.upsert({
      where: { sourceKey },
      create: {
        userId: membership.userId,
        type: "weekly_report",
        title: `周报 ${weekLabel}`,
        summary: content.summary,
        sourceKey,
        metadata: metaJson,
      },
      update: {
        summary: content.summary,
        metadata: metaJson,
        readAt: null,
      },
    });
  }

  return {
    id: `report_${weekLabel}`,
    weekLabel,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    summary: content.summary,
    highlights: content.highlights,
    concerns: content.concerns,
    recommendations: content.recommendations,
    metrics: data,
    generatedAt: new Date().toISOString(),
  };
}

export async function getLatestReport(orgId: string): Promise<WeeklyReport | null> {
  const weekLabel = getWeekLabel();

  const membership = await db.organizationMember.findFirst({
    where: { orgId },
    select: { userId: true },
  });
  if (!membership) return null;

  const sourceKey = `weekly_report_${weekLabel}_${membership.userId}`;
  const notification = await db.notification.findUnique({
    where: { sourceKey },
  });

  if (!notification) return null;

  let meta: Record<string, unknown> = {};
  try {
    meta = typeof notification.metadata === "string"
      ? JSON.parse(notification.metadata)
      : (notification.metadata as unknown as Record<string, unknown>) ?? {};
  } catch { /* ignore */ }

  const { start, end } = getWeekRange();

  return {
    id: notification.id,
    weekLabel,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    summary: notification.summary ?? "",
    highlights: (meta.highlights as string[]) ?? [],
    concerns: (meta.concerns as string[]) ?? [],
    recommendations: (meta.recommendations as string[]) ?? [],
    metrics: null as unknown as CockpitData,
    generatedAt: notification.createdAt.toISOString(),
  };
}
