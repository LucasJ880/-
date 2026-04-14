/**
 * 销售沟通分析器
 *
 * 对客户沟通内容做深度 AI 分析：
 * - 意图/情绪/异议分类
 * - 买方信号 / 风险信号提取
 * - deal 健康度评分
 * - 建议下一步行动
 */

import { createCompletion } from "@/lib/ai/client";

export interface CommunicationAnalysis {
  sentiment: "positive" | "negative" | "neutral";
  intent: "objection" | "inquiry" | "negotiation" | "closing" | "smalltalk" | "complaint" | "other";
  objectionType?: "price" | "timing" | "competition" | "authority" | "need" | "trust";
  buyerSignals: string[];
  riskSignals: string[];
  keyNeeds: string[];
  topicTags: string[];
  dealHealthScore: number; // 0-100
  suggestedNextAction: string;
  summary: string;
}

export interface InteractionAnalysisInput {
  content: string;
  customerName?: string;
  dealStage?: string;
  productTypes?: string;
  previousInteractions?: string;
}

const ANALYSIS_PROMPT = `Analyze this sales communication for a blinds/curtain company. Return ONLY valid JSON (no code blocks).

Input context:
- Customer: {{customerName}}
- Current deal stage: {{dealStage}}
- Products discussed: {{productTypes}}
{{previousContext}}

Communication to analyze:
"""
{{content}}
"""

Return this exact JSON structure:
{
  "sentiment": "positive" | "negative" | "neutral",
  "intent": "objection" | "inquiry" | "negotiation" | "closing" | "smalltalk" | "complaint" | "other",
  "objectionType": "price" | "timing" | "competition" | "authority" | "need" | "trust" | null,
  "buyerSignals": ["string array of positive buying indicators found"],
  "riskSignals": ["string array of deal risk indicators found"],
  "keyNeeds": ["string array of customer needs/requirements mentioned"],
  "topicTags": ["3-5 topic tags like price_discussion, product_comparison, installation"],
  "dealHealthScore": 0-100 (0=dead, 50=neutral, 100=very likely to close),
  "suggestedNextAction": "specific next action recommendation",
  "summary": "1-2 sentence summary of this interaction"
}

Rules:
- Be conservative with dealHealthScore; default to 50 if uncertain
- Only set objectionType if a clear objection is present
- buyerSignals: concrete indicators like "asked about delivery date", "compared with competitor favorably"
- riskSignals: concrete indicators like "mentioned budget constraints", "long response delay"
- suggestedNextAction should be specific and actionable`;

export async function analyzeCommunication(
  input: InteractionAnalysisInput,
): Promise<CommunicationAnalysis> {
  const prompt = ANALYSIS_PROMPT
    .replace("{{customerName}}", input.customerName || "Unknown")
    .replace("{{dealStage}}", input.dealStage || "unknown")
    .replace("{{productTypes}}", input.productTypes || "not specified")
    .replace(
      "{{previousContext}}",
      input.previousInteractions
        ? `- Recent interaction context: ${input.previousInteractions.slice(0, 500)}`
        : "",
    )
    .replace("{{content}}", input.content.slice(0, 3000));

  try {
    const result = await createCompletion({
      systemPrompt:
        "You are a sales communication analyst for a blinds/window treatment company. " +
        "Analyze communications precisely and return structured JSON. " +
        "Be conservative in assessments — only flag signals you're confident about.",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.2,
      maxTokens: 800,
    });

    const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      sentiment: parsed.sentiment || "neutral",
      intent: parsed.intent || "other",
      objectionType: parsed.objectionType || undefined,
      buyerSignals: Array.isArray(parsed.buyerSignals) ? parsed.buyerSignals : [],
      riskSignals: Array.isArray(parsed.riskSignals) ? parsed.riskSignals : [],
      keyNeeds: Array.isArray(parsed.keyNeeds) ? parsed.keyNeeds : [],
      topicTags: Array.isArray(parsed.topicTags) ? parsed.topicTags : [],
      dealHealthScore: typeof parsed.dealHealthScore === "number"
        ? Math.max(0, Math.min(100, parsed.dealHealthScore))
        : 50,
      suggestedNextAction: parsed.suggestedNextAction || "",
      summary: parsed.summary || "",
    };
  } catch {
    return {
      sentiment: "neutral",
      intent: "other",
      buyerSignals: [],
      riskSignals: [],
      keyNeeds: [],
      topicTags: [],
      dealHealthScore: 50,
      suggestedNextAction: "",
      summary: "",
    };
  }
}

/**
 * 计算商机整体健康度（综合所有互动分析）
 */
export function aggregateDealHealth(
  analyses: Array<{ dealHealthScore: number; createdAt: Date }>,
): number {
  if (analyses.length === 0) return 50;

  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const a of analyses) {
    const daysSince = (now - a.createdAt.getTime()) / 86_400_000;
    const weight = Math.exp(-daysSince / 14); // 2 周半衰期
    weightedSum += a.dealHealthScore * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
}
