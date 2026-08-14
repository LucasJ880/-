/**
 * Phase G — 投标交付物清单（幂等 upsert by deliverableKey）
 *
 * 本文件是交付物的**唯一领域实现**，legacy pipeline 与 Workforce 工具都调用这里，
 * 不存在 buildDeliverablesLegacy() / buildDeliverablesForWorkforce() 两套业务逻辑。
 *
 * 两种产出方式（互斥，按分析版本选择）：
 *
 *   buildDeliverables()          V1 静态模板（DELIVERABLE_DEFINITIONS，与标书内容无关）。
 *                                V2 开启后 legacy worker 已刻意不再调用它——固定模板会
 *                                对任何标书产出同一批交付物，属编造。保留仅为 V1 历史行为。
 *
 *   buildGroundedDeliverables()  T5-P1：从**本次真实抽取的要求**派生交付物。
 *                                每条都能追到 requirementCode + 来源页码，
 *                                与 tender-understanding 的 submissionChecklist 同一口径
 *                                （SUBMISSION_CATEGORIES + mandatory），但落 canonical 表，
 *                                使提交页与 synthesis 都能消费。零 LLM 调用、纯派生。
 */

import { db } from "@/lib/db";
import { DELIVERABLE_DEFINITIONS } from "./constants";

/**
 * 与 tender-understanding/synthesize.ts 的 SUBMISSION_CATEGORIES 同口径；
 * DB 侧 category 为小写（v2-map.ts:199 `r.category.toLowerCase()`）。
 */
const SUBMISSION_CATEGORIES_DB = new Set([
  "submission",
  "administrative",
  "pricing",
  "samples",
  "shop_drawings",
  "bonding",
  "insurance",
]);

/** requirementCode → 稳定的 deliverableKey（幂等锚点；同一要求重复运行不产生重复行） */
function deliverableKeyForRequirement(requirementCode: string): string {
  const slug = requirementCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `req_${slug || "unknown"}`;
}

export type GroundedDeliverable = {
  deliverableKey: string;
  title: string;
  mandatory: boolean;
  sourcePage: number | null;
  requirementCode: string;
};

export type BuildGroundedDeliverablesResult = {
  deliverableCount: number;
  deliverables: GroundedDeliverable[];
  /** 派生自多少条候选要求（可观测：0 表示本标书确实没有提交类强制要求） */
  consideredRequirements: number;
};

/**
 * T5-P1：从 canonical 抽取要求派生 grounded 交付物（幂等 upsert）。
 *
 * 纪律：只做派生，不发明。没有对应要求就不产出交付物——
 * 空结果是诚实结果，绝不回落静态模板补数。
 */
export async function buildGroundedDeliverables(input: {
  runId: string;
}): Promise<BuildGroundedDeliverablesResult> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: input.runId },
    select: { projectId: true },
  });
  if (!run) {
    throw new Error(`buildGroundedDeliverables: run not found ${input.runId}`);
  }

  const requirements = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: input.runId },
    select: {
      requirementCode: true,
      originalRequirement: true,
      chineseTranslation: true,
      category: true,
      mandatory: true,
      evidenceRequired: true,
      sourcePage: true,
    },
    orderBy: { requirementCode: "asc" },
  });

  const candidates = requirements.filter(
    (r) =>
      r.mandatory &&
      (SUBMISSION_CATEGORIES_DB.has((r.category ?? "").toLowerCase()) ||
        r.evidenceRequired),
  );

  const out: GroundedDeliverable[] = [];
  for (const r of candidates) {
    const key = deliverableKeyForRequirement(r.requirementCode);
    const title = (r.chineseTranslation || r.originalRequirement || r.requirementCode)
      .trim()
      .slice(0, 200);
    await db.tenderDeliverable.upsert({
      where: {
        analysisRunId_deliverableKey: {
          analysisRunId: input.runId,
          deliverableKey: key,
        },
      },
      create: {
        projectId: run.projectId,
        analysisRunId: input.runId,
        deliverableKey: key,
        title,
        mandatory: r.mandatory,
        sourcePage: r.sourcePage,
      },
      // 幂等：标题/来源页可随重跑刷新；人工设置的 owner/dueAt/status 不覆盖
      update: { title, mandatory: r.mandatory, sourcePage: r.sourcePage },
    });
    out.push({
      deliverableKey: key,
      title,
      mandatory: r.mandatory,
      sourcePage: r.sourcePage,
      requirementCode: r.requirementCode,
    });
  }

  return {
    deliverableCount: out.length,
    deliverables: out,
    consideredRequirements: requirements.length,
  };
}

export type BuildDeliverablesInput = {
  runId: string;
};

export type BuildDeliverablesResult = {
  deliverableCount: number;
  keys: string[];
};

export async function buildDeliverables(
  input: BuildDeliverablesInput,
): Promise<BuildDeliverablesResult> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: input.runId },
    select: { projectId: true },
  });
  if (!run) throw new Error(`buildDeliverables: run not found ${input.runId}`);

  const keys: string[] = [];
  for (const def of DELIVERABLE_DEFINITIONS) {
    await db.tenderDeliverable.upsert({
      where: {
        analysisRunId_deliverableKey: {
          analysisRunId: input.runId,
          deliverableKey: def.key,
        },
      },
      create: {
        projectId: run.projectId,
        analysisRunId: input.runId,
        deliverableKey: def.key,
        title: def.title,
        mandatory: def.mandatory,
        status: "PENDING",
      },
      update: {
        title: def.title,
        mandatory: def.mandatory,
      },
    });
    keys.push(def.key);
  }

  return { deliverableCount: keys.length, keys };
}

/** 纯函数：交付物 key 列表（单测） */
export function listDeliverableKeys(): string[] {
  return DELIVERABLE_DEFINITIONS.map((d) => d.key);
}
