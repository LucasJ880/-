import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readBlobBuffer } from "@/lib/files/blob-access";
import type {
  ProductFidelityQaResult,
  QaRecommendedStatus,
  VisualGenerationMode,
} from "@/lib/product-content/types";
import {
  isMultimodalQaEnabled,
  mergeFidelityQaResults,
  runMultimodalFidelityQa,
} from "@/lib/product-content/qa/multimodal";
import { recordCostEntry } from "@/lib/product-content/cost/ledger";

export const FIDELITY_QA_THRESHOLDS = {
  /** 90–100：可批准 */
  approve: 90,
  /** 75–89：人工审核 */
  review: 75,
  reject: 0,
} as const;

const MODE_BASE_SCORES: Record<VisualGenerationMode, number> = {
  EXACT: 82,
  STUDIO: 78,
  CREATIVE: 70,
};

function toChange(
  category: ProductFidelityQaResult["detectedChanges"][number]["category"],
  severity: ProductFidelityQaResult["detectedChanges"][number]["severity"],
  description: string,
): ProductFidelityQaResult["detectedChanges"][number] {
  return { category, severity, description };
}

export function recommendedStatusFromScore(
  score: number,
  mode: VisualGenerationMode,
): QaRecommendedStatus {
  if (mode === "CREATIVE" && score < FIDELITY_QA_THRESHOLDS.review) {
    return "REJECT";
  }
  if (score >= FIDELITY_QA_THRESHOLDS.approve) return "APPROVE";
  if (score >= FIDELITY_QA_THRESHOLDS.review) return "REVIEW";
  return "REJECT";
}

export function runHeuristicFidelityQa(args: {
  mode: VisualGenerationMode;
  metadata?: Record<string, unknown>;
  protectionViolations?: string[];
}): ProductFidelityQaResult {
  const base = MODE_BASE_SCORES[args.mode];
  let overall = base;
  const detectedChanges: ProductFidelityQaResult["detectedChanges"] = [];

  if (args.metadata?.placeholder || args.metadata?.provider === "placeholder") {
    overall -= 5;
    detectedChanges.push(
      toChange("unknown", "low", "dry-run 占位输出，仅供流程验证"),
    );
  }

  if (args.metadata?.referenceCount === 0 && args.mode === "EXACT") {
    overall -= 3;
    detectedChanges.push(
      toChange("unknown", "medium", "EXACT 模式未附带参考图"),
    );
  }

  const violations = args.protectionViolations ?? [];
  for (const v of violations) {
    if (/logo/i.test(v)) {
      overall = Math.min(overall, FIDELITY_QA_THRESHOLDS.review - 1);
      detectedChanges.push(toChange("logo", "high", `Logo 可能发生变化：${v}`));
    } else if (/text|label/i.test(v)) {
      overall = Math.min(overall, FIDELITY_QA_THRESHOLDS.review - 1);
      detectedChanges.push(toChange("text", "high", `印刷文字可能发生变化：${v}`));
    } else if (/color/i.test(v)) {
      detectedChanges.push(toChange("color", "medium", `颜色偏差：${v}`));
    } else if (/pattern/i.test(v)) {
      detectedChanges.push(toChange("pattern", "high", `图案偏差：${v}`));
    } else if (/shape/i.test(v)) {
      detectedChanges.push(toChange("shape", "high", `形状偏差：${v}`));
    } else {
      detectedChanges.push(toChange("unknown", "medium", v));
    }
  }

  overall = Math.max(0, Math.min(100, overall));

  let recommendedStatus = recommendedStatusFromScore(overall, args.mode);
  if (
    detectedChanges.some((c) => c.severity === "high") &&
    recommendedStatus === "APPROVE"
  ) {
    recommendedStatus = "REVIEW";
  }

  return {
    overallScore: overall,
    shapeScore: Math.max(0, overall - 2),
    colorScore: Math.max(0, overall - 1),
    patternScore: args.mode === "EXACT" ? overall : Math.max(0, overall - 5),
    textureScore: Math.max(0, overall - 3),
    logoScore: detectedChanges.some((c) => c.category === "logo") ? 60 : overall,
    textScore: detectedChanges.some((c) => c.category === "text") ? 60 : overall,
    accessoryScore: overall,
    detectedChanges,
    recommendedStatus,
    rawJson: { mode: args.mode, heuristic: true },
  };
}

async function loadMultimodalQa(input: {
  orgId: string;
  visualOutputId: string;
  mode: VisualGenerationMode;
  dryRun?: boolean;
}) {
  const output = await db.visualOutput.findFirst({
    where: { id: input.visualOutputId, orgId: input.orgId },
    include: { visualJob: { include: { job: { include: { assets: true } } } } },
  });
  if (!output?.blobPathname) return null;

  const job = output.visualJob.job;
  const primaryAsset = job.assets.find(
    (a) =>
      a.roleAuto === "primary" ||
      a.roleAuto === "primary_product" ||
      a.roleConfirmed === "primary",
  );
  if (!primaryAsset) return null;

  const [source, generated] = await Promise.all([
    readBlobBuffer(primaryAsset.blobPathname),
    readBlobBuffer(output.blobPathname),
  ]);
  if (!source?.buffer || !generated?.buffer) return null;

  return runMultimodalFidelityQa({
    sourceBuffer: source.buffer,
    sourceMime: source.contentType || "image/png",
    generatedBuffer: generated.buffer,
    generatedMime: generated.contentType || "image/png",
    mode: input.mode,
  });
}

export async function runProductFidelityQa(input: {
  orgId: string;
  jobId?: string;
  visualOutputId: string;
  mode: VisualGenerationMode;
  metadata?: Record<string, unknown>;
  protectionViolations?: string[];
  dryRun?: boolean;
}) {
  const output = await db.visualOutput.findFirst({
    where: { id: input.visualOutputId, orgId: input.orgId },
    include: { visualJob: true },
  });
  if (!output) throw new Error("视觉输出不存在");

  const meta = (input.metadata ?? output.metadata ?? {}) as Record<string, unknown>;
  const dryRun = input.dryRun ?? Boolean(meta.placeholder);

  const heuristic = runHeuristicFidelityQa({
    mode: input.mode,
    metadata: meta,
    protectionViolations: input.protectionViolations,
  });

  let qa = heuristic;
  if (isMultimodalQaEnabled({ dryRun }) && !dryRun && output.blobPathname?.endsWith(".png")) {
    const multimodal = await loadMultimodalQa({
      orgId: input.orgId,
      visualOutputId: output.id,
      mode: input.mode,
      dryRun,
    });
    if (multimodal) {
      qa = mergeFidelityQaResults(heuristic, multimodal, input.mode);
      const jobId = input.jobId ?? output.visualJob.jobId;
      await recordCostEntry({
        orgId: input.orgId,
        jobId,
        category: "fidelity_qa",
        provider: "openai",
        model: "vision",
        estimatedCents: 2,
        actualCents: 2,
        meta: { visualOutputId: output.id, multimodal: true },
      }).catch(() => undefined);
    }
  }

  const result = await db.visualQaResult.upsert({
    where: { visualOutputId: output.id },
    create: {
      orgId: input.orgId,
      visualOutputId: output.id,
      overallScore: qa.overallScore,
      shapeScore: qa.shapeScore,
      colorScore: qa.colorScore,
      patternScore: qa.patternScore,
      textureScore: qa.textureScore,
      logoScore: qa.logoScore,
      textScore: qa.textScore,
      accessoryScore: qa.accessoryScore,
      detectedChangesJson: qa.detectedChanges as unknown as Prisma.InputJsonValue,
      recommendedStatus: qa.recommendedStatus,
      rawJson: (qa.rawJson ?? {}) as Prisma.InputJsonValue,
    },
    update: {
      overallScore: qa.overallScore,
      shapeScore: qa.shapeScore,
      colorScore: qa.colorScore,
      patternScore: qa.patternScore,
      textureScore: qa.textureScore,
      logoScore: qa.logoScore,
      textScore: qa.textScore,
      accessoryScore: qa.accessoryScore,
      detectedChangesJson: qa.detectedChanges as unknown as Prisma.InputJsonValue,
      recommendedStatus: qa.recommendedStatus,
      rawJson: (qa.rawJson ?? {}) as Prisma.InputJsonValue,
    },
  });

  await db.visualOutput.update({
    where: { id: output.id },
    data: {
      qaOverallScore: qa.overallScore,
      status: qa.recommendedStatus === "REJECT" ? "rejected" : output.status,
    },
  });

  return { qa, result };
}
