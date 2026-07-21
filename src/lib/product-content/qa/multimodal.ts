import { getAIConfig } from "@/lib/ai/config";
import type {
  MultimodalFidelityQaResult,
  ProductFidelityDetectedChange,
  ProductFidelityQaResult,
  QaRecommendedStatus,
} from "@/lib/product-content/types";
import { recommendedStatusFromScore } from "@/lib/product-content/qa/fidelity";

const MAX_IMAGE_BYTES = 1_500_000;

export function isMultimodalQaEnabled(opts?: { dryRun?: boolean }): boolean {
  const env = process.env.PRODUCT_CONTENT_MULTIMODAL_QA;
  if (env === "0") return false;
  if (env === "1") return true;
  return !opts?.dryRun;
}

function toDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

const SYSTEM_PROMPT = `You are a product fidelity QA inspector for export home textile merchandising.
Compare the SOURCE product image with the GENERATED image.
Evaluate shape, color, pattern, texture, logo, and printed text fidelity.
Return strict JSON only:
{
  "overallScore": number,
  "shapeScore": number,
  "colorScore": number,
  "patternScore": number,
  "textureScore": number,
  "logoScore": number,
  "textScore": number,
  "detectedChanges": [{"category":"shape|color|pattern|texture|logo|text|accessory|unknown","severity":"low|medium|high","description":"中文描述"}],
  "recommendedStatus": "APPROVE|REVIEW|REJECT"
}
Hard rules: if any high severity issue in logo, text, pattern, color, or shape, recommendedStatus cannot be APPROVE.`;

export async function runMultimodalFidelityQa(input: {
  sourceBuffer: Buffer;
  sourceMime: string;
  generatedBuffer: Buffer;
  generatedMime: string;
  mode: string;
}): Promise<MultimodalFidelityQaResult | null> {
  if (
    input.sourceBuffer.byteLength > MAX_IMAGE_BYTES ||
    input.generatedBuffer.byteLength > MAX_IMAGE_BYTES
  ) {
    return null;
  }

  const cfg = getAIConfig();
  if (!cfg.apiKey) return null;

  const userPrompt = `Mode: ${input.mode}. Source image bytes: ${input.sourceBuffer.byteLength}. Generated image bytes: ${input.generatedBuffer.byteLength}. Compare fidelity and respond in JSON.`;

  const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.miniModel,
      messages: [
        { role: "developer", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: { url: toDataUrl(input.sourceBuffer, input.sourceMime), detail: "low" },
            },
            {
              type: "image_url",
              image_url: {
                url: toDataUrl(input.generatedBuffer, input.generatedMime),
                detail: "low",
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(stripJsonFence(content)) as MultimodalFidelityQaResult;
    return applyMultimodalHardRules(parsed);
  } catch {
    return null;
  }
}

const HARD_RULE_CATEGORIES = new Set([
  "shape",
  "color",
  "pattern",
  "texture",
  "logo",
  "text",
]);

export function applyMultimodalHardRules(
  result: MultimodalFidelityQaResult,
): MultimodalFidelityQaResult {
  const changes = (result.detectedChanges ?? []).map((c) => ({
    ...c,
    description: c.description || "未提供描述",
  }));

  const hasHighHardRule = changes.some(
    (c) => c.severity === "high" && HARD_RULE_CATEGORIES.has(c.category),
  );

  let recommendedStatus = result.recommendedStatus;
  if (hasHighHardRule && recommendedStatus === "APPROVE") {
    recommendedStatus = "REVIEW";
  }

  return {
    ...result,
    detectedChanges: changes,
    recommendedStatus,
  };
}

export function mergeFidelityQaResults(
  heuristic: ProductFidelityQaResult,
  multimodal: MultimodalFidelityQaResult | null,
  mode: Parameters<typeof recommendedStatusFromScore>[1],
): ProductFidelityQaResult {
  if (!multimodal) return heuristic;

  const overallScore = Math.min(heuristic.overallScore, multimodal.overallScore);
  const detectedChanges: ProductFidelityDetectedChange[] = [
    ...heuristic.detectedChanges,
    ...multimodal.detectedChanges.map((c) => ({
      ...c,
      description: c.description.startsWith("[多模态]")
        ? c.description
        : `[多模态] ${c.description}`,
    })),
  ];

  let recommendedStatus: QaRecommendedStatus = recommendedStatusFromScore(
    overallScore,
    mode,
  );

  const hasHighHardRule = detectedChanges.some(
    (c) => c.severity === "high" && HARD_RULE_CATEGORIES.has(c.category),
  );
  if (hasHighHardRule && recommendedStatus === "APPROVE") {
    recommendedStatus = "REVIEW";
  }
  if (multimodal.recommendedStatus === "REJECT") {
    recommendedStatus = "REJECT";
  } else if (
    multimodal.recommendedStatus === "REVIEW" &&
    recommendedStatus === "APPROVE"
  ) {
    recommendedStatus = "REVIEW";
  }

  return {
    overallScore,
    shapeScore: Math.min(heuristic.shapeScore, multimodal.shapeScore),
    colorScore: Math.min(heuristic.colorScore, multimodal.colorScore),
    patternScore: Math.min(
      heuristic.patternScore ?? overallScore,
      multimodal.patternScore ?? overallScore,
    ),
    textureScore: Math.min(
      heuristic.textureScore ?? overallScore,
      multimodal.textureScore ?? overallScore,
    ),
    logoScore: Math.min(heuristic.logoScore ?? overallScore, multimodal.logoScore ?? overallScore),
    textScore: Math.min(heuristic.textScore ?? overallScore, multimodal.textScore ?? overallScore),
    accessoryScore: heuristic.accessoryScore,
    detectedChanges,
    recommendedStatus,
    rawJson: {
      ...(heuristic.rawJson ?? {}),
      multimodal: true,
      multimodalScores: {
        overall: multimodal.overallScore,
        recommendedStatus: multimodal.recommendedStatus,
      },
    },
  };
}
