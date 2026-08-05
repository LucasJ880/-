/**
 * Phase E — 页级文本 → facts / requirements（确定性优先 + 可选 LLM）
 */

import { db } from "@/lib/db";
import { extractFactsFromPages } from "./extract/facts";
import { maybeEnrichFactsWithLlm } from "./extract/llm-enrich";
import { extractRequirementsFromPages } from "./extract/requirements";
import type { FactCandidate, PageInput, RequirementCandidate } from "./extract/types";

export type ExtractFromPagesInput = {
  runId: string;
  documentIds?: string[];
};

export type ExtractFromPagesResult = {
  factCount: number;
  requirementCount: number;
};

export type ExtractRequirementsInput = {
  runId: string;
};

export type ExtractRequirementsResult = {
  requirementCount: number;
};

async function loadRunPages(runId: string, documentIds?: string[]): Promise<{
  projectId: string;
  pages: PageInput[];
}> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: {
      projectId: true,
      documents: {
        orderBy: { createdAt: "asc" },
        select: { documentId: true },
      },
    },
  });
  if (!run) {
    throw new Error(`extractFromPages: run not found ${runId}`);
  }

  const ids =
    documentIds && documentIds.length > 0
      ? documentIds
      : run.documents.map((d) => d.documentId);

  if (ids.length === 0) {
    return { projectId: run.projectId, pages: [] };
  }

  const pageRows = await db.projectDocumentPage.findMany({
    where: { documentId: { in: ids } },
    orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }],
    select: {
      documentId: true,
      pageNumber: true,
      contentText: true,
    },
  });

  // 保持 run 文档顺序
  const order = new Map(ids.map((id, i) => [id, i]));
  pageRows.sort((a, b) => {
    const oa = order.get(a.documentId) ?? 0;
    const ob = order.get(b.documentId) ?? 0;
    if (oa !== ob) return oa - ob;
    return a.pageNumber - b.pageNumber;
  });

  return {
    projectId: run.projectId,
    pages: pageRows.map((p) => ({
      documentId: p.documentId,
      pageNumber: p.pageNumber,
      contentText: p.contentText,
    })),
  };
}

async function clearRunFacts(runId: string): Promise<void> {
  await db.tenderAnalysisSourceRef.deleteMany({
    where: { runId, factId: { not: null } },
  });
  await db.tenderAnalysisFact.deleteMany({ where: { runId } });
}

async function clearRunRequirements(runId: string): Promise<void> {
  await db.tenderAnalysisSourceRef.deleteMany({
    where: { runId, requirementId: { not: null } },
  });
  await db.tenderExtractedRequirement.deleteMany({
    where: { analysisRunId: runId },
  });
}

async function persistFacts(
  runId: string,
  facts: FactCandidate[],
): Promise<number> {
  await clearRunFacts(runId);
  let count = 0;
  for (const fact of facts) {
    const created = await db.tenderAnalysisFact.create({
      data: {
        runId,
        statementKind: fact.statementKind,
        contentZh: fact.contentZh,
        contentOriginal: fact.contentOriginal,
        confidence: fact.confidence,
      },
    });
    count += 1;
    for (const ref of fact.sourceRefs) {
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId,
          documentId: ref.documentId,
          pageNumber: ref.pageNumber,
          sectionLabel: ref.sectionLabel ?? null,
          originalTextSnippet: ref.originalTextSnippet,
          extractionMethod: ref.extractionMethod,
          confidence: ref.confidence,
          factId: created.id,
        },
      });
    }
  }
  return count;
}

async function persistRequirements(
  runId: string,
  projectId: string,
  requirements: RequirementCandidate[],
): Promise<number> {
  await clearRunRequirements(runId);
  let count = 0;
  for (const req of requirements) {
    // 硬约束：绝不自动标 COMPLIANT
    const complianceStatus =
      req.complianceStatus === "NEEDS_CLARIFICATION"
        ? "NEEDS_CLARIFICATION"
        : "NOT_ASSESSED";

    const created = await db.tenderExtractedRequirement.create({
      data: {
        projectId,
        analysisRunId: runId,
        requirementCode: req.requirementCode,
        category: req.category,
        originalRequirement: req.originalRequirement,
        chineseTranslation: req.chineseTranslation,
        mandatory: req.mandatory,
        evidenceRequired: req.evidenceRequired,
        complianceStatus,
        reviewStatus: "AI_EXTRACTED",
        sourcePage: req.sourcePage,
        projectionStatus: "NOT_PROJECTED",
      },
    });
    count += 1;
    for (const ref of req.sourceRefs) {
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId,
          documentId: ref.documentId,
          pageNumber: ref.pageNumber,
          sectionLabel: ref.sectionLabel ?? null,
          originalTextSnippet: ref.originalTextSnippet,
          extractionMethod: ref.extractionMethod,
          confidence: ref.confidence,
          requirementId: created.id,
        },
      });
    }
  }
  return count;
}

/**
 * 加载 run 文档页 → 抽取 facts + M1–M15 requirements → 幂等重建入库。
 */
export async function extractFromPages(
  input: ExtractFromPagesInput,
): Promise<ExtractFromPagesResult> {
  const { projectId, pages } = await loadRunPages(
    input.runId,
    input.documentIds,
  );

  let facts = extractFactsFromPages(pages);
  facts = await maybeEnrichFactsWithLlm(facts);
  const requirements = extractRequirementsFromPages(pages);

  const factCount = await persistFacts(input.runId, facts);
  const requirementCount = await persistRequirements(
    input.runId,
    projectId,
    requirements,
  );

  return { factCount, requirementCount };
}

/**
 * Worker EXTRACT_REQUIREMENTS 步骤：幂等重建 requirements（facts 已存在时可单独重跑）。
 */
export async function extractRequirements(
  input: ExtractRequirementsInput,
): Promise<ExtractRequirementsResult> {
  const { projectId, pages } = await loadRunPages(input.runId);
  const requirements = extractRequirementsFromPages(pages);
  const requirementCount = await persistRequirements(
    input.runId,
    projectId,
    requirements,
  );
  return { requirementCount };
}

export { extractFactsFromPages, summarizeExtractedFacts } from "./extract/facts";
export {
  extractRequirementsFromPages,
  looksLikeRcmpBackpackRfp,
} from "./extract/requirements";
export {
  parseClosingFromText,
  computeEnquiryDeadline,
  formatDateYmd,
} from "./extract/closing";
export type {
  PageInput,
  FactCandidate,
  RequirementCandidate,
} from "./extract/types";
