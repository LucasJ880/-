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
 *   buildGroundedDeliverables()  T5-P1：**严格投影** canonical
 *                                summaryJson.submissionChecklist（语义真相在 tender-understanding，
 *                                本文件不自行判断什么算交付物）；每条可追 requirementCode + 来源页码
 *                                （语义真相在 tender-understanding），落 canonical 表，
 *                                使提交页与 synthesis 都能消费。零 LLM 调用、纯派生。
 */

import { db } from "@/lib/db";
import { DELIVERABLE_DEFINITIONS } from "./constants";

/**
 * T5-P1 §8–§12：交付物语义真相 = TenderAnalysisRun.summaryJson.submissionChecklist
 * （V2 grounded，由 tender-understanding 从 ACTIVE 要求派生）。
 * TenderDeliverable 只是 **operational projection**，绝不自行判断"什么算交付物"。
 *
 * 因此本 materializer：
 *  - 不再维护第二份分类判定（分类只发生在 tender-understanding 一处）
 *    （DELIVERABLE_CLASSIFICATION_SOURCES = 1）
 *  - checklist = [] → 落 0 行，PASS（合法成功）
 *  - V2 run 缺失/畸形 checklist → GROUNDED_CHECKLIST_INVALID fail-closed
 *  - checklist item 的 requirementId 找不到持久化要求 → GROUNDED_CHECKLIST_INTEGRITY_ERROR
 *    fail-closed（禁止静默 drop）
 *  - NEEDS_REVIEW 要求不在 canonical checklist 中 → 自然不会被投影
 *  - 空 checklist 绝不回落 V1 静态模板（V2_STATIC_TEMPLATE_REACHABILITY = 0）
 */

export class GroundedChecklistError extends Error {
  code: "GROUNDED_CHECKLIST_INVALID" | "GROUNDED_CHECKLIST_INTEGRITY_ERROR";
  constructor(
    code: "GROUNDED_CHECKLIST_INVALID" | "GROUNDED_CHECKLIST_INTEGRITY_ERROR",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "GroundedChecklistError";
  }
}

export type ChecklistItem = { requirementId: string; statement: string };

/** 从 summaryJson 读取 canonical checklist（形状校验；缺失/畸形抛错） */
export function readCanonicalSubmissionChecklist(
  summaryJson: unknown,
): ChecklistItem[] {
  if (!summaryJson || typeof summaryJson !== "object") {
    throw new GroundedChecklistError(
      "GROUNDED_CHECKLIST_INVALID",
      "V2 分析结果缺少 summaryJson，无法投影交付物",
    );
  }
  const raw = (summaryJson as Record<string, unknown>).submissionChecklist;
  if (raw === undefined || raw === null) {
    throw new GroundedChecklistError(
      "GROUNDED_CHECKLIST_INVALID",
      "V2 分析结果缺少 submissionChecklist（canonical 交付物语义来源）",
    );
  }
  if (!Array.isArray(raw)) {
    throw new GroundedChecklistError(
      "GROUNDED_CHECKLIST_INVALID",
      "submissionChecklist 不是数组",
    );
  }
  return raw.map((item, idx) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const requirementId = typeof o.requirementId === "string" ? o.requirementId.trim() : "";
    const statement = typeof o.statement === "string" ? o.statement.trim() : "";
    if (!requirementId || !statement) {
      throw new GroundedChecklistError(
        "GROUNDED_CHECKLIST_INVALID",
        `submissionChecklist[${idx}] 缺少 requirementId/statement`,
      );
    }
    return { requirementId, statement };
  });
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
  /** canonical checklist 条目数（可观测：0 表示本标书确实没有提交类强制要求） */
  checklistCount: number;
};

/** requirementCode → 稳定 deliverableKey（幂等锚点） */
function deliverableKeyForRequirement(requirementCode: string): string {
  const slug = requirementCode.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `req_${slug || "unknown"}`;
}

/**
 * T5-P1：把 canonical submissionChecklist **逐条**投影为 TenderDeliverable。
 * 严格 1:1——不增不减、不自行分类、不静默丢弃。
 */
export async function buildGroundedDeliverables(input: {
  runId: string;
}): Promise<BuildGroundedDeliverablesResult> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: input.runId },
    select: { projectId: true, summaryJson: true },
  });
  if (!run) {
    throw new Error(`buildGroundedDeliverables: run not found ${input.runId}`);
  }

  const checklist = readCanonicalSubmissionChecklist(run.summaryJson);
  if (checklist.length === 0) {
    return { deliverableCount: 0, deliverables: [], checklistCount: 0 };
  }

  // requirementId → 持久化要求（缺失即 integrity error，禁止静默 drop）
  const reqs = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: input.runId },
    select: {
      requirementCode: true,
      originalRequirement: true,
      chineseTranslation: true,
      mandatory: true,
      sourcePage: true,
    },
  });
  const byCode = new Map(reqs.map((r) => [r.requirementCode, r]));

  const out: GroundedDeliverable[] = [];
  for (const item of checklist) {
    const req = byCode.get(item.requirementId);
    if (!req) {
      throw new GroundedChecklistError(
        "GROUNDED_CHECKLIST_INTEGRITY_ERROR",
        `canonical checklist 引用的要求 ${item.requirementId} 在本次分析中不存在`,
      );
    }
    const key = deliverableKeyForRequirement(req.requirementCode);
    const title = (req.chineseTranslation || item.statement || req.originalRequirement)
      .trim().slice(0, 200);
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
        mandatory: req.mandatory,
        sourcePage: req.sourcePage,
      },
      update: { title, mandatory: req.mandatory, sourcePage: req.sourcePage },
    });
    out.push({
      deliverableKey: key,
      title,
      mandatory: req.mandatory,
      sourcePage: req.sourcePage,
      requirementCode: req.requirementCode,
    });
  }

  return {
    deliverableCount: out.length,
    deliverables: out,
    checklistCount: checklist.length,
  };
}

/** V1 静态模板入参/结果（legacy 行为，未改动） */
export type BuildDeliverablesInput = { runId: string };
export type BuildDeliverablesResult = { deliverableCount: number; keys: string[] };

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
