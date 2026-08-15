/**
 * T5-P1 Segment 2 — canonical V2 写入核心（**唯一实现**，零 ownership 判定）
 *
 * 抽出的动机：canonical V2 落库此前与 legacy Tender lease fence 焊死在
 * persistV2Fenced 一个函数里。Workforce Runtime 用的是 AgentRun RunFence，
 * 复制一份写入逻辑就会立刻出现两套 V2 真相（字段漂移只是时间问题）。
 * 因此把「写什么」与「凭什么能写」彻底分开：
 *
 *   legacy:    persistV2Fenced        → Tender lease fence  ─┐
 *                                                            ├→ persistV2CanonicalTx
 *   workforce: persistV2ForWorkforce  → AgentRun RunFence   ─┘
 *
 * 本模块**故意不做**的事（做了就是绕过 fence）：
 *   - 不开事务（必须由调用方在已 fence 的事务里传入 tx）
 *   - 不判定 lease / RunFence / 任何执行权
 *   - 不判定 org / project / job 归属
 *   - 不调用 LLM
 *   - 不改 TenderAnalysisRun.status（终态化是另一个语义，见 analysis-run-service）
 *
 * 纪律：**禁止业务代码直接 import 本模块**。允许的调用方只有上面两个 fenced
 * wrapper，由 v2-persist-core-encapsulation 测试（V2-SPINE-01）机械校验。
 */

import { SECTION_KEYS } from "./constants";
import type { V2MappedResult } from "./v2-map";

type CountResult = { count: number };
type IdResult = { id: string };

/** 事务内使用的最小 Prisma 委托子集（可注入 fake tx 做确定性测试）。 */
export interface V2PersistTx {
  tenderAnalysisRun: {
    updateMany(args: unknown): Promise<CountResult>;
    update(args: unknown): Promise<unknown>;
  };
  tenderAnalysisSourceRef: {
    deleteMany(args: unknown): Promise<CountResult>;
    create(args: unknown): Promise<IdResult>;
  };
  tenderAnalysisFact: {
    deleteMany(args: unknown): Promise<CountResult>;
    create(args: unknown): Promise<IdResult>;
  };
  tenderExtractedRequirement: {
    deleteMany(args: unknown): Promise<CountResult>;
    create(args: unknown): Promise<IdResult>;
  };
  tenderClarificationQuestion: {
    deleteMany(args: unknown): Promise<CountResult>;
    create(args: unknown): Promise<IdResult>;
  };
  tenderAnalysisChangeCandidate: {
    deleteMany(args: unknown): Promise<CountResult>;
    createMany(args: unknown): Promise<CountResult>;
  };
  tenderAnalysisSection: {
    upsert(args: unknown): Promise<unknown>;
  };
}

export type PersistV2Result = {
  factCount: number;
  requirementCount: number;
  clarificationCount: number;
  changeCount: number;
  sectionCount: number;
};

export type PersistV2CanonicalArgs = {
  runId: string;
  projectId: string;
  parentRunId?: string | null;
  mapped: V2MappedResult;
  model: string | null;
};

/**
 * canonical V2 写入：幂等重建（先 delete 后 create）+ 16 个章节 upsert +
 * summaryText/summaryJson/model。**调用方必须已在同一事务内完成 fence 与归属断言。**
 *
 * 事务语义：任一步异常 → 调用方事务整体回滚，绝不留半套 V2 结果。
 */
export async function persistV2CanonicalTx(
  tx: V2PersistTx,
  args: PersistV2CanonicalArgs,
): Promise<PersistV2Result> {
  const { mapped } = args;

  // —— 幂等重建（必须在 fence 之后、同一事务内） —— //
  await tx.tenderAnalysisSourceRef.deleteMany({ where: { runId: args.runId } });
  await tx.tenderAnalysisFact.deleteMany({ where: { runId: args.runId } });
  await tx.tenderExtractedRequirement.deleteMany({
    where: { analysisRunId: args.runId },
  });
  await tx.tenderClarificationQuestion.deleteMany({
    where: { analysisRunId: args.runId },
  });
  await tx.tenderAnalysisChangeCandidate.deleteMany({
    where: { runId: args.runId },
  });

  let factCount = 0;
  for (const fct of mapped.facts) {
    const created = await tx.tenderAnalysisFact.create({
      data: {
        runId: args.runId,
        statementKind: fct.statementKind,
        contentZh: fct.contentZh,
        contentOriginal: fct.contentOriginal,
        confidence: fct.confidence,
      },
    });
    factCount += 1;
    for (const ref of fct.sourceRefs) {
      await tx.tenderAnalysisSourceRef.create({
        data: {
          runId: args.runId,
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
    const created = await tx.tenderExtractedRequirement.create({
      data: {
        projectId: args.projectId,
        analysisRunId: args.runId,
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
      await tx.tenderAnalysisSourceRef.create({
        data: {
          runId: args.runId,
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
    const created = await tx.tenderClarificationQuestion.create({
      data: {
        projectId: args.projectId,
        analysisRunId: args.runId,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        enquiryDeadline: c.enquiryDeadline,
        status: "OPEN",
      },
    });
    clarificationCount += 1;
    for (const ref of c.sourceRefs) {
      await tx.tenderAnalysisSourceRef.create({
        data: {
          runId: args.runId,
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
    await tx.tenderAnalysisChangeCandidate.createMany({
      data: mapped.changeCandidates.map((c) => ({
        runId: args.runId,
        parentRunId: args.parentRunId ?? null,
        changeType: c.changeType,
        entityType: c.entityType,
        entityKey: c.entityKey,
        summaryZh: c.summaryZh,
        status: "PENDING_REVIEW",
      })),
    });
    changeCount = mapped.changeCandidates.length;
  }

  const sectionByKey = new Map(mapped.sections.map((s) => [s.sectionKey, s]));
  let sectionCount = 0;
  for (const sectionKey of SECTION_KEYS) {
    const s = sectionByKey.get(sectionKey);
    const contentZh = s?.contentZh ?? "（暂无）";
    const structuredJson = (s?.structuredJson ?? {}) as object;
    const confidence = s?.confidence ?? "INFERRED";
    await tx.tenderAnalysisSection.upsert({
      where: { runId_sectionKey: { runId: args.runId, sectionKey } },
      create: {
        runId: args.runId,
        sectionKey,
        contentZh,
        structuredJson,
        confidence,
        reviewStatus: "AI_DRAFT",
      },
      update: { contentZh, structuredJson, confidence, reviewStatus: "AI_DRAFT" },
    });
    sectionCount += 1;
  }

  await tx.tenderAnalysisRun.update({
    where: { id: args.runId },
    data: {
      summaryText: mapped.summaryText,
      summaryJson: mapped.summaryJson as object,
      model: args.model,
    },
  });

  return {
    factCount,
    requirementCount,
    clarificationCount,
    changeCount,
    sectionCount,
  };
}
