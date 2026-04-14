/**
 * 赢单/丢单模式提炼引擎
 *
 * 从已关闭的 deal 中提取成功/失败模式，生成 SalesInsight。
 * - 单 deal 分析：deal 关闭时触发
 * - 批量对比分析：定期运行，发现跨客户的规律
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { generateEmbedding } from "@/lib/ai/embedding";
import { setInsightEmbedding } from "./vector-search";

interface DealData {
  opportunityId: string;
  customerName: string;
  stage: string;
  outcome: "won" | "lost";
  estimatedValue: number | null;
  productTypes: string | null;
  lostReason: string | null;
  durationDays: number;
  chunks: Array<{
    content: string;
    intent: string | null;
    sentiment: string | null;
    isWinPattern: boolean;
    isLossSignal: boolean;
  }>;
  interactionCount: number;
}

const SINGLE_DEAL_PROMPT = `Analyze this closed sales deal and extract key insights. Return ONLY valid JSON (no code blocks).

Deal: {{outcome}} | Customer: {{customerName}} | Value: {{dealValue}} | Duration: {{duration}} days
Products: {{products}}
{{lostReason}}

Communication timeline ({{chunkCount}} segments):
{{chunks}}

Return this JSON structure:
{
  "insights": [
    {
      "insightType": "win_pattern" | "loss_signal" | "objection_response" | "best_practice" | "stage_tactic",
      "title": "short descriptive title",
      "description": "detailed description of what worked/failed and why",
      "dealStage": "the stage this insight applies to" | null,
      "productType": "relevant product type" | null,
      "customerTags": ["tags describing customer profile this applies to"],
      "objectionType": "price" | "timing" | "competition" | null
    }
  ]
}

Rules:
- Extract 1-3 insights per deal (quality over quantity)
- For won deals: focus on what techniques/approaches led to success
- For lost deals: focus on warning signs and what could have been done differently
- Be specific: "offered 10% discount on 3+ windows" not "gave discount"
- Include applicable context: stage, product type, customer type`;

export async function analyzeDealOutcome(
  opportunityId: string,
  outcome: "won" | "lost",
): Promise<{ insightsCreated: number }> {
  const opp = await db.salesOpportunity.findUnique({
    where: { id: opportunityId },
    include: {
      customer: { select: { name: true, tags: true, source: true } },
    },
  });

  if (!opp) return { insightsCreated: 0 };

  const chunks = await db.salesKnowledgeChunk.findMany({
    where: { opportunityId },
    select: {
      content: true,
      intent: true,
      sentiment: true,
      isWinPattern: true,
      isLossSignal: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const interactionCount = await db.customerInteraction.count({
    where: { opportunityId },
  });

  const durationDays = opp.wonAt || opp.lostAt
    ? Math.ceil(
        ((opp.wonAt ?? opp.lostAt ?? new Date()).getTime() - opp.createdAt.getTime()) /
          86_400_000,
      )
    : 0;

  const dealData: DealData = {
    opportunityId,
    customerName: opp.customer.name,
    stage: opp.stage,
    outcome,
    estimatedValue: opp.estimatedValue,
    productTypes: opp.productTypes,
    lostReason: opp.lostReason,
    durationDays,
    chunks: chunks.map((c) => ({
      content: c.content,
      intent: c.intent,
      sentiment: c.sentiment,
      isWinPattern: c.isWinPattern,
      isLossSignal: c.isLossSignal,
    })),
    interactionCount,
  };

  return extractInsightsFromDeal(dealData, opp.createdById);
}

async function extractInsightsFromDeal(
  deal: DealData,
  userId: string,
): Promise<{ insightsCreated: number }> {
  const chunkSummary = deal.chunks
    .slice(0, 15)
    .map(
      (c, i) =>
        `[${i + 1}] ${c.intent ? `(${c.intent}) ` : ""}${c.sentiment ? `[${c.sentiment}] ` : ""}` +
        `${c.isWinPattern ? "★WIN " : ""}${c.isLossSignal ? "⚠LOSS " : ""}` +
        c.content.slice(0, 200),
    )
    .join("\n");

  const prompt = SINGLE_DEAL_PROMPT
    .replace("{{outcome}}", deal.outcome.toUpperCase())
    .replace("{{customerName}}", deal.customerName)
    .replace("{{dealValue}}", `$${deal.estimatedValue ?? "unknown"}`)
    .replace("{{duration}}", String(deal.durationDays))
    .replace("{{products}}", deal.productTypes ?? "not specified")
    .replace(
      "{{lostReason}}",
      deal.lostReason ? `Lost reason: ${deal.lostReason}` : "",
    )
    .replace("{{chunkCount}}", String(deal.chunks.length))
    .replace("{{chunks}}", chunkSummary || "No communication data indexed");

  try {
    const result = await createCompletion({
      systemPrompt:
        "You are a sales analyst for a blinds/window treatment company. " +
        "Extract actionable insights from closed deals. Be specific and practical.",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.3,
      maxTokens: 1000,
    });

    const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.insights)) return { insightsCreated: 0 };

    let created = 0;
    for (const ins of parsed.insights.slice(0, 3)) {
      try {
        const insight = await db.salesInsight.create({
          data: {
            userId,
            insightType: ins.insightType || (deal.outcome === "won" ? "win_pattern" : "loss_signal"),
            title: ins.title || `${deal.outcome === "won" ? "Win" : "Loss"} pattern`,
            description: ins.description || "",
            dealStage: ins.dealStage || undefined,
            productType: ins.productType || undefined,
            customerTags: Array.isArray(ins.customerTags) ? ins.customerTags : [],
            objectionType: ins.objectionType || undefined,
            effectiveness: deal.outcome === "won" ? 0.6 : 0.4,
            sourceChunkIds: deal.chunks.length > 0 ? [deal.opportunityId] : [],
          },
        });

        const embText = `${ins.title}. ${ins.description}. ${ins.dealStage || ""} ${ins.productType || ""}`;
        try {
          const emb = await generateEmbedding(embText);
          await setInsightEmbedding(insight.id, emb);
        } catch {
          // embedding 失败不阻塞
        }

        created++;
      } catch (e) {
        console.error("[InsightExtractor] Create insight failed:", e);
      }
    }

    if (deal.outcome === "won") {
      await db.salesKnowledgeChunk.updateMany({
        where: { opportunityId: deal.opportunityId },
        data: { isWinPattern: true },
      });
    }

    return { insightsCreated: created };
  } catch (err) {
    console.error("[InsightExtractor] Analysis failed:", err);
    return { insightsCreated: 0 };
  }
}

// ── 批量对比分析（定期任务） ──

const BATCH_COMPARE_PROMPT = `Compare these won deals vs lost deals and extract patterns. Return ONLY valid JSON.

Won deals ({{wonCount}}):
{{wonSummary}}

Lost deals ({{lostCount}}):
{{lostSummary}}

Return:
{
  "insights": [
    {
      "insightType": "win_pattern" | "loss_signal" | "best_practice",
      "title": "pattern title",
      "description": "detailed description of the pattern found across multiple deals",
      "dealStage": "applicable stage" | null,
      "productType": "applicable product" | null,
      "customerTags": ["applicable customer tags"]
    }
  ]
}

Focus on:
- Techniques that appear in multiple won deals but not lost deals
- Warning signs that appear in multiple lost deals
- Timing patterns (how fast/slow successful vs unsuccessful deals moved)
- Product/customer type correlations with outcomes`;

export async function runBatchInsightExtraction(
  userId: string,
  opts?: { lookbackDays?: number; limit?: number },
): Promise<{ insightsCreated: number }> {
  const lookback = opts?.lookbackDays ?? 90;
  const since = new Date(Date.now() - lookback * 86_400_000);

  const wonDeals = await db.salesOpportunity.findMany({
    where: {
      wonAt: { gte: since },
      stage: "completed",
    },
    include: {
      customer: { select: { name: true, tags: true } },
      _count: { select: { interactions: true } },
    },
    take: opts?.limit ?? 20,
    orderBy: { wonAt: "desc" },
  });

  const lostDeals = await db.salesOpportunity.findMany({
    where: {
      lostAt: { gte: since },
      stage: "lost",
    },
    include: {
      customer: { select: { name: true, tags: true } },
      _count: { select: { interactions: true } },
    },
    take: opts?.limit ?? 20,
    orderBy: { lostAt: "desc" },
  });

  if (wonDeals.length + lostDeals.length < 2) {
    return { insightsCreated: 0 };
  }

  const summarizeDeal = (d: typeof wonDeals[number]) =>
    `${d.customer.name} | $${d.estimatedValue ?? "?"} | ${d.productTypes ?? "?"} | ` +
    `${d._count.interactions} interactions | ` +
    `${d.lostReason ? "Reason: " + d.lostReason : ""}`;

  const prompt = BATCH_COMPARE_PROMPT
    .replace("{{wonCount}}", String(wonDeals.length))
    .replace("{{wonSummary}}", wonDeals.map(summarizeDeal).join("\n") || "None")
    .replace("{{lostCount}}", String(lostDeals.length))
    .replace("{{lostSummary}}", lostDeals.map(summarizeDeal).join("\n") || "None");

  try {
    const result = await createCompletion({
      systemPrompt:
        "You are a sales analytics expert. Compare won vs lost deals and extract actionable patterns.",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.3,
      maxTokens: 1200,
    });

    const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.insights)) return { insightsCreated: 0 };

    let created = 0;
    for (const ins of parsed.insights.slice(0, 5)) {
      try {
        const insight = await db.salesInsight.create({
          data: {
            userId,
            insightType: ins.insightType || "best_practice",
            title: ins.title || "Pattern",
            description: ins.description || "",
            dealStage: ins.dealStage || undefined,
            productType: ins.productType || undefined,
            customerTags: Array.isArray(ins.customerTags) ? ins.customerTags : [],
            effectiveness: 0.5,
            sourceChunkIds: [],
          },
        });

        const embText = `${ins.title}. ${ins.description}`;
        try {
          const emb = await generateEmbedding(embText);
          await setInsightEmbedding(insight.id, emb);
        } catch {}

        created++;
      } catch {}
    }

    return { insightsCreated: created };
  } catch (err) {
    console.error("[InsightExtractor] Batch analysis failed:", err);
    return { insightsCreated: 0 };
  }
}
