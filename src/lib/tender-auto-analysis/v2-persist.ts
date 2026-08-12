/**
 * Phase E — 运行 V2 grounded 引擎并持久化到现有实体（生产侧，flag 门控）
 *
 * 幂等：按 runId 先删后建（facts/requirements/clarifications/sourceRefs/changeCandidates），
 * sections upsert，最后写 run.summaryText/summaryJson。禁 import tender-eval。
 *
 * 长任务：analyzeTender 为多 LLM 调用，可能超过单次 lease；调用方（worker）需在
 * 执行期间心跳续租（见 worker.ts stepExtractFacts 的 heartbeat 包裹）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { analyzeTender, type AnalyzeOptions } from "@/lib/tender-understanding/analyzer";
import type { AnalyzerInput } from "@/lib/tender-understanding/contract";
import { isTenderAnalysisV2Enabled } from "@/lib/tender-understanding/flag";
import { SECTION_KEYS } from "./constants";
import { mapRunRoleToV2Role, mapV2Result, type V2SectionInput } from "./v2-map";

export { isTenderAnalysisV2Enabled };

/** 从 run 文档 + 页文本构建 AnalyzerInput（project-scoped）。 */
export async function buildAnalyzerInputForRun(
  runId: string,
): Promise<AnalyzerInput | null> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: {
      projectId: true,
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          documentId: true,
          role: true,
          contentHash: true,
          document: { select: { title: true, fileType: true } },
        },
      },
    },
  });
  if (!run || run.documents.length === 0) return null;

  const ids = run.documents.map((d) => d.documentId);
  const pageRows = await db.projectDocumentPage.findMany({
    where: { documentId: { in: ids } },
    orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }],
    select: { documentId: true, pageNumber: true, contentText: true },
  });

  const pagesByDoc = new Map<string, { pageNumber: number; contentText: string }[]>();
  for (const p of pageRows) {
    const arr = pagesByDoc.get(p.documentId) ?? [];
    arr.push({ pageNumber: p.pageNumber, contentText: p.contentText });
    pagesByDoc.set(p.documentId, arr);
  }

  return {
    projectId: run.projectId,
    documents: run.documents.map((d) => ({
      documentId: d.documentId,
      name: d.document?.title ?? d.documentId,
      type: d.document?.fileType ?? "pdf",
      sourceRole: mapRunRoleToV2Role(d.role),
      pages: pagesByDoc.get(d.documentId) ?? [],
      contentHash: d.contentHash ?? null,
    })),
  };
}

async function clearRunV2Entities(runId: string): Promise<void> {
  await db.tenderAnalysisSourceRef.deleteMany({ where: { runId } });
  await db.tenderAnalysisFact.deleteMany({ where: { runId } });
  await db.tenderExtractedRequirement.deleteMany({ where: { analysisRunId: runId } });
  await db.tenderClarificationQuestion.deleteMany({ where: { analysisRunId: runId } });
  await db.tenderAnalysisChangeCandidate.deleteMany({ where: { runId } });
}

export type AnalyzeAndPersistV2Result = {
  factCount: number;
  requirementCount: number;
  clarificationCount: number;
  changeCount: number;
  sectionCount: number;
  llmCalls: number;
  llmFailures: number;
};

/**
 * 运行 V2 并持久化 facts/requirements/clarifications/changeCandidates/sections/summary。
 * 由 worker EXTRACT_FACTS 步在 flag ON 时调用；GENERATE_SECTIONS / EXTRACT_REQUIREMENTS /
 * BUILD_CLARIFICATIONS 步在 flag ON 时转为 no-op（数据已在此写入）。
 */
export async function analyzeAndPersistV2(input: {
  runId: string;
  projectId: string;
  parentRunId?: string | null;
  analysisDate?: string | null;
  opts?: AnalyzeOptions;
}): Promise<AnalyzeAndPersistV2Result> {
  const analyzerInput = await buildAnalyzerInputForRun(input.runId);
  if (!analyzerInput) {
    throw new Error(`analyzeAndPersistV2: no documents/pages for run ${input.runId}`);
  }

  const { result } = await analyzeTender(analyzerInput, {
    analysisDate: input.analysisDate ?? new Date().toISOString(),
    ...input.opts,
  });

  const mapped = mapV2Result(result);

  // —— 幂等重建 ——
  await clearRunV2Entities(input.runId);

  let factCount = 0;
  for (const f of mapped.facts) {
    const created = await db.tenderAnalysisFact.create({
      data: {
        runId: input.runId,
        statementKind: f.statementKind,
        contentZh: f.contentZh,
        contentOriginal: f.contentOriginal,
        confidence: f.confidence,
      },
    });
    factCount += 1;
    for (const ref of f.sourceRefs) {
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId: input.runId,
          documentId: ref.documentId,
          pageNumber: ref.pageNumber,
          sectionLabel: ref.sectionLabel,
          originalTextSnippet: ref.originalTextSnippet,
          extractionMethod: ref.extractionMethod,
          confidence: ref.confidence,
          factId: created.id,
        },
      });
    }
  }

  let requirementCount = 0;
  for (const r of mapped.requirements) {
    const created = await db.tenderExtractedRequirement.create({
      data: {
        projectId: input.projectId,
        analysisRunId: input.runId,
        requirementCode: r.requirementCode,
        category: r.category,
        originalRequirement: r.originalRequirement,
        chineseTranslation: r.chineseTranslation,
        mandatory: r.mandatory,
        evidenceRequired: r.evidenceRequired,
        complianceStatus: r.complianceStatus,
        reviewStatus: "AI_EXTRACTED",
        sourcePage: r.sourcePage,
        projectionStatus: "NOT_PROJECTED",
      },
    });
    requirementCount += 1;
    for (const ref of r.sourceRefs) {
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId: input.runId,
          documentId: ref.documentId,
          pageNumber: ref.pageNumber,
          sectionLabel: ref.sectionLabel,
          originalTextSnippet: ref.originalTextSnippet,
          extractionMethod: ref.extractionMethod,
          confidence: ref.confidence,
          requirementId: created.id,
        },
      });
    }
  }

  let clarificationCount = 0;
  for (const c of mapped.clarifications) {
    const created = await db.tenderClarificationQuestion.create({
      data: {
        projectId: input.projectId,
        analysisRunId: input.runId,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        enquiryDeadline: c.enquiryDeadline,
        status: "OPEN",
      },
    });
    clarificationCount += 1;
    for (const ref of c.sourceRefs) {
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId: input.runId,
          documentId: ref.documentId,
          pageNumber: ref.pageNumber,
          sectionLabel: ref.sectionLabel,
          originalTextSnippet: ref.originalTextSnippet,
          extractionMethod: ref.extractionMethod,
          confidence: ref.confidence,
          clarificationQuestionId: created.id,
        },
      });
    }
  }

  let changeCount = 0;
  if (mapped.changeCandidates.length > 0) {
    await db.tenderAnalysisChangeCandidate.createMany({
      data: mapped.changeCandidates.map((c) => ({
        runId: input.runId,
        parentRunId: input.parentRunId ?? null,
        changeType: c.changeType,
        entityType: c.entityType,
        entityKey: c.entityKey,
        summaryZh: c.summaryZh,
        status: "PENDING_REVIEW",
      })),
    });
    changeCount = mapped.changeCandidates.length;
  }

  // —— sections（16 键 upsert） ——
  const sectionByKey = new Map<string, V2SectionInput>(
    mapped.sections.map((s) => [s.sectionKey, s]),
  );
  let sectionCount = 0;
  for (const sectionKey of SECTION_KEYS) {
    const s = sectionByKey.get(sectionKey);
    const contentZh = s?.contentZh ?? "（暂无）";
    const structuredJson = (s?.structuredJson ?? {}) as Prisma.InputJsonValue;
    const confidence = s?.confidence ?? "INFERRED";
    await db.tenderAnalysisSection.upsert({
      where: { runId_sectionKey: { runId: input.runId, sectionKey } },
      create: {
        runId: input.runId,
        sectionKey,
        contentZh,
        structuredJson,
        confidence,
        reviewStatus: "AI_DRAFT",
      },
      update: {
        contentZh,
        structuredJson,
        confidence,
        reviewStatus: "AI_DRAFT",
      },
    });
    sectionCount += 1;
  }

  await db.tenderAnalysisRun.update({
    where: { id: input.runId },
    data: {
      summaryText: mapped.summaryText,
      summaryJson: mapped.summaryJson as Prisma.InputJsonValue,
      model: result.metadata.models[0] ?? null,
    },
  });

  return {
    factCount,
    requirementCount,
    clarificationCount,
    changeCount,
    sectionCount,
    llmCalls: result.metadata.llmCalls,
    llmFailures: result.metadata.llmFailures,
  };
}
