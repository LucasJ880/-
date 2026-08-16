/**
 * Phase E + BLOCKER 2 — 运行 V2 grounded 引擎并 lease-fenced 持久化到现有实体。
 *
 * 结构（fail-closed）：
 *   1. runV2Inference：只做 LLM 推理 + 纯映射，零 canonical 写；
 *   2. persistV2Fenced：单个短事务内先 fence（校验 run.id / leaseOwner / status∈{EXTRACTING,ANALYZING}
 *      / lease 未过期，并原子续租——行锁持有至提交，并发认领会阻塞/失败），fence 通过才允许
 *      clear + 所有 canonical 写；fence 失败 → 抛 TenderV2LeaseLostError，ZERO canonical 写；
 *   3. heartbeat 若 renewLease 返回 false → 记 leaseLost，推理返回后立即 fail-closed，不进入持久化。
 *
 * 复用现有 TenderAnalysisRun leaseOwner 契约，不新建第二套 lease system。
 * 禁 import tender-eval。事务边界内所有写要么全提交要么全回滚（V2-LEASE-03）。
 */

import { db } from "@/lib/db";
import type { AnalyzeOptions } from "@/lib/tender-understanding/analyzer";
import type { AnalyzerInput } from "@/lib/tender-understanding/contract";
import { isTenderAnalysisV2Enabled } from "@/lib/tender-understanding/flag";
import type { AnalystCoverage } from "@/lib/tender-analyst/contract";
import { SECTION_KEYS } from "./constants";
import { mapRunRoleToV2Role, type V2MappedResult } from "./v2-map";
import { TenderV2LeaseLostError } from "./v2-errors";
import {
  advanceV2Analysis,
  fingerprintAnalyzerInput,
  type V2Inference,
} from "./v2-resumable";
import {
  createV2Cursor,
  parseV2Cursor,
  type V2CursorState,
  type V2Phase,
} from "./v2-cursor";

export { isTenderAnalysisV2Enabled, TenderV2LeaseLostError };
export type { V2Inference };

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

/** run 的 package 覆盖率（Analyst coverage 块的事实源）。 */
export async function loadCoverageForRun(
  projectId: string,
  runId: string,
): Promise<AnalystCoverage> {
  const { getPackageCoverage } = await import("./package-coverage");
  const cov = await getPackageCoverage(projectId, runId);
  return {
    uploaded: cov.uploaded,
    eligible: cov.eligible,
    analyzed: cov.analyzed,
    excluded: cov.excludedFiles,
  };
}

/**
 * 只做推理 + 纯映射，绝不触碰 canonical 表（可能长耗时）。
 * 内部走与生产 worker 同一个分片执行器（deadline=∞ → 一次跑完），
 * 保证单次编排与跨 tick 续跑**同源同语义**。
 */
export async function runV2Inference(input: {
  runId: string;
  analysisDate?: string | null;
  opts?: AnalyzeOptions;
}): Promise<V2Inference> {
  const analyzerInput = await buildAnalyzerInputForRun(input.runId);
  if (!analyzerInput) {
    throw new Error(`runV2Inference: no documents/pages for run ${input.runId}`);
  }
  const coverage = await loadCoverageForRun(analyzerInput.projectId, input.runId);
  const outcome = await advanceV2Analysis({
    input: analyzerInput,
    coverage,
    cursor: createV2Cursor({
      fingerprint: fingerprintAnalyzerInput(analyzerInput),
      analysisDate: input.analysisDate ?? new Date().toISOString(),
      now: new Date(),
    }),
    deadlineAt: Number.POSITIVE_INFINITY,
    tickBudgetMs: Number.POSITIVE_INFINITY,
    invoker: input.opts?.invoker,
    maxConcurrency: input.opts?.maxConcurrency,
    windowOptions: input.opts?.windowOptions,
  });
  if (outcome.status !== "READY") {
    // deadline=∞ 下不可能 YIELD；出现即为契约破坏
    throw new Error(`runV2Inference: unexpected yield at ${outcome.phase}`);
  }
  return outcome.inference;
}

/* --------------------------- 可注入事务（便于确定性 race 测试） --------------------------- */

type CountResult = { count: number };
type IdResult = { id: string };

/** 事务内使用的最小 Prisma 委托子集。 */
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

export type RunV2Tx = <T>(fn: (tx: V2PersistTx) => Promise<T>) => Promise<T>;

const defaultRunTx: RunV2Tx = (fn) =>
  db.$transaction((tx) => fn(tx as unknown as V2PersistTx), {
    // 真实 package（多文档、几十条 facts/requirements 逐行写 + Neon 网络往返）
    // 会超出 Prisma 默认 5s interactive transaction 上限，导致 fence 事务过期
    // 整体回滚（UAT 实测）。fence 语义不变：仍是单事务先 fence 后写、异常全回滚。
    maxWait: 10_000,
    timeout: 120_000,
  });

export type PersistV2Result = {
  factCount: number;
  requirementCount: number;
  clarificationCount: number;
  changeCount: number;
  sectionCount: number;
};

/**
 * Lease-fenced 持久化：单事务内先 fence，再写全部 canonical 实体。
 * fence 失败 → TenderV2LeaseLostError（零写）；事务内异常 → 全回滚。
 */
export async function persistV2Fenced(
  args: {
    runId: string;
    projectId: string;
    leaseOwner: string;
    leaseMs: number;
    parentRunId?: string | null;
    mapped: V2MappedResult;
    model: string | null;
    now?: Date;
  },
  runTx: RunV2Tx = defaultRunTx,
): Promise<PersistV2Result> {
  const now = args.now ?? new Date();
  return runTx(async (tx) => {
    // —— FENCE：确认执行权 + 原子续租；行锁持有至提交 —— //
    const fence = await tx.tenderAnalysisRun.updateMany({
      where: {
        id: args.runId,
        leaseOwner: args.leaseOwner,
        status: { in: ["EXTRACTING", "ANALYZING"] },
        leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt: new Date(now.getTime() + args.leaseMs) },
    });
    if (fence.count === 0) {
      // 租约已失/被接管/终态 → 绝不写 canonical 数据
      throw new TenderV2LeaseLostError(args.runId);
    }

    const { mapped } = args;

    // —— 幂等重建（fence 之后、同一事务内） —— //
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

    return { factCount, requirementCount, clarificationCount, changeCount, sectionCount };
  });
}

export type AnalyzeAndPersistV2Result = PersistV2Result & {
  llmCalls: number;
  llmFailures: number;
};

/**
 * FB-18 护栏（纯函数）：零成功 LLM 调用且零抽取产出 = 空壳分析。
 * 此类 run 绝不允许进入 REVIEW_REQUIRED（用户会把空结果当真分析）——
 * 典型场景：模型 key 额度耗尽时全部调用 429（UAT 实录 0/120 成功仍到审核态）。
 */
export function isEmptyAnalysisOutcome(r: {
  llmCalls: number;
  llmFailures: number;
  factCount: number;
  requirementCount: number;
}): boolean {
  const zeroLlmSuccess = r.llmCalls === 0 || r.llmFailures >= r.llmCalls;
  return zeroLlmSuccess && r.factCount === 0 && r.requirementCount === 0;
}

export type V2StepOutcome =
  | { status: "PERSISTED"; result: AnalyzeAndPersistV2Result }
  | { status: "YIELD"; phase: V2Phase; reason: string; ticks: number };

/**
 * 生产 worker 入口：推进一个 tick（预算内尽量多跑），把检查点写进 workerCursor。
 *
 * - 未跑完 → YIELD：本 tick 的 LLM 成果已落盘，下个 cron tick 从断点继续；
 *   run 保持 EXTRACTING/ANALYZING，workerStep 不前进。
 * - 跑完 → 立即 lease-fenced 落 canonical 数据，返回 PERSISTED。
 *
 * 所有 LLM 调用仍在 DB 事务之外（§9）；检查点写入本身过 lease fence，
 * stale worker 既不写检查点也不写 canonical（saveCursor=false → LeaseLost）。
 */
export async function advanceAndPersistV2(input: {
  runId: string;
  projectId: string;
  leaseOwner: string;
  leaseMs: number;
  parentRunId?: string | null;
  analysisDate?: string | null;
  opts?: AnalyzeOptions;
  /** epoch ms（本次 cron 调用的硬截止，留足 serverless 余量） */
  deadlineAt: number;
  tickBudgetMs: number;
  /** run.workerCursor 原值（指纹不符/结构不符 → 自动从头开始） */
  cursorRaw: unknown;
  saveCursor: (cursor: V2CursorState) => Promise<boolean>;
  checkLease?: () => boolean;
  runTx?: RunV2Tx;
  now?: () => number;
}): Promise<V2StepOutcome> {
  const analyzerInput = await buildAnalyzerInputForRun(input.runId);
  if (!analyzerInput) {
    throw new Error(`advanceAndPersistV2: no documents/pages for run ${input.runId}`);
  }
  const now = input.now ?? (() => Date.now());
  const fingerprint = fingerprintAnalyzerInput(analyzerInput);
  const cursor =
    parseV2Cursor(input.cursorRaw, fingerprint) ??
    createV2Cursor({
      fingerprint,
      analysisDate: input.analysisDate ?? new Date(now()).toISOString(),
      now: new Date(now()),
    });

  const coverage = await loadCoverageForRun(analyzerInput.projectId, input.runId);

  const outcome = await advanceV2Analysis({
    input: analyzerInput,
    coverage,
    cursor,
    deadlineAt: input.deadlineAt,
    tickBudgetMs: input.tickBudgetMs,
    invoker: input.opts?.invoker,
    maxConcurrency: input.opts?.maxConcurrency,
    windowOptions: input.opts?.windowOptions,
    now,
    saveCursor: input.saveCursor,
    checkLease: input.checkLease,
  });

  if (outcome.status === "YIELD") {
    return {
      status: "YIELD",
      phase: outcome.phase,
      reason: outcome.reason,
      ticks: outcome.cursor.ticks,
    };
  }

  // heartbeat 已判定租约丢失 → 落库前 fail-closed（fence 仍是权威防线）
  if (input.checkLease && input.checkLease() === false) {
    throw new TenderV2LeaseLostError(input.runId);
  }

  const persisted = await persistV2Fenced(
    {
      runId: input.runId,
      projectId: input.projectId,
      leaseOwner: input.leaseOwner,
      leaseMs: input.leaseMs,
      parentRunId: input.parentRunId,
      mapped: outcome.inference.mapped,
      model: outcome.inference.model,
    },
    input.runTx,
  );

  return {
    status: "PERSISTED",
    result: {
      ...persisted,
      llmCalls: outcome.inference.llmCalls,
      llmFailures: outcome.inference.llmFailures,
    },
  };
}

/**
 * 编排：推理（长耗时，无写）→ heartbeat fail-closed 检查 → fenced 持久化。
 * worker 传入 leaseOwner/leaseMs/checkLease；fence 是权威防线，checkLease 为提前 fail-closed。
 */
export async function analyzeAndPersistV2(input: {
  runId: string;
  projectId: string;
  leaseOwner: string;
  leaseMs: number;
  parentRunId?: string | null;
  analysisDate?: string | null;
  opts?: AnalyzeOptions;
  checkLease?: () => boolean;
  runTx?: RunV2Tx;
}): Promise<AnalyzeAndPersistV2Result> {
  const { mapped, model, llmCalls, llmFailures } = await runV2Inference({
    runId: input.runId,
    analysisDate: input.analysisDate,
    opts: input.opts,
  });

  // heartbeat 已判定租约丢失 → 推理返回后立即 fail-closed，不进入持久化
  if (input.checkLease && input.checkLease() === false) {
    throw new TenderV2LeaseLostError(input.runId);
  }

  const persisted = await persistV2Fenced(
    {
      runId: input.runId,
      projectId: input.projectId,
      leaseOwner: input.leaseOwner,
      leaseMs: input.leaseMs,
      parentRunId: input.parentRunId,
      mapped,
      model,
    },
    input.runTx,
  );

  return { ...persisted, llmCalls, llmFailures };
}
