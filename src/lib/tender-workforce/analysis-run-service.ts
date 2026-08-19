/**
 * Tender T1B — Workforce 路径的 canonical Tender Domain 薄服务适配层
 * （任务书 §6/§7/§24）
 *
 * Source of Truth Rule：业务结果只写既有 canonical Tender Domain
 * （TenderAnalysisRun 树）。Workforce Runtime 只承载执行状态与 trace。
 *
 * 与 legacy tender-auto-analysis 的共存（§7）：
 *
 *              ┌ Legacy Trigger（分析投标文件 / 上传自动入队）
 *              │      status: PENDING → EXTRACTING → … （legacy cron 驱动）
 *   Shared Tender Services（page-parse / extract / report / clarifications）
 *              │
 *              └ Workforce Worker（本模块）
 *                     status: AGENT_ANALYZING → REVIEW_REQUIRED / AGENT_FAILED
 *
 * Workforce 专用 status 词汇（String 列，零 schema 变更）：
 * - AGENT_ANALYZING：Workforce Job 执行中。不在 legacy CLAIMABLE_STATUSES /
 *   reaper（EXTRACTING/ANALYZING）/ 候选查询（PENDING/FAILED/EXTRACTING/
 *   ANALYZING）任何集合内 → legacy cron 永不认领、永不回收，不构成
 *   Runtime inside Runtime。
 * - AGENT_FAILED：Workforce 路径终态失败。刻意不用 legacy "FAILED"——
 *   legacy 候选查询会把 FAILED(attemptCount<5) 重新入队跑完整 legacy
 *   pipeline，等于把 Workforce 的 run 复活进第二套编排。
 * - 成功终态复用 REVIEW_REQUIRED：结果进入既有人审/approve 流程，
 *   analysis-panel 与 approveAnalysisRun 无需任何改动即可消费。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { canAutoEnqueueAnalysis } from "@/lib/tender-auto-analysis/gate";
import {
  computePackageFingerprint,
  detectMultiplePrimaryWarning,
  getTenderPackageDocuments,
  MissingPackageContentHashError,
  packageTooLarge,
  type PackageDocument,
} from "@/lib/tender-auto-analysis/package";
import {
  parseTenderAnalysisResultV1,
  type TenderAnalysisResultV1,
} from "./result-contract";

/** Workforce 专用 TenderAnalysisRun 状态（见文件头注释） */
export const TENDER_AGENT_RUN_STATUS = {
  running: "AGENT_ANALYZING",
  failed: "AGENT_FAILED",
  /** 成功终态 = legacy 审阅态（人审/approve 流程原样复用） */
  reviewRequired: "REVIEW_REQUIRED",
} as const;

export const TENDER_WORKFORCE_ANALYSIS_VERSION = "tender-workforce-analysis-v1";
export const TENDER_WORKFORCE_PROMPT_VERSION = "tender-workforce-prompt-v1";

/** 启动幂等锚点：一个 Workforce Job 至多对应一个 domain run */
export function buildWorkforceTenderIdempotencyKey(jobId: string): string {
  return `tender-workforce:v1:${jobId}`;
}

/** Analysis Input Manifest（§16）：本次分析的稳定输入清单 */
export type TenderAnalysisInputManifest = {
  analysisRunId: string;
  projectId: string;
  fingerprint: string;
  mode: "full";
  documents: Array<{
    documentId: string;
    filename: string;
    role: string;
    contentHash: string;
    pageCount: number | null;
  }>;
  addendumCount: number;
  classificationWarning?: string;
};

export type CreateWorkforceTenderRunResult =
  | { ok: true; manifest: TenderAnalysisInputManifest; reused: boolean }
  | {
      ok: false;
      /** §33 错误语义：INPUT_MISSING 一族（fail-closed，绝不虚构文档内容） */
      code:
        | "PROJECT_NOT_FOUND"
        | "NOT_TENDER_PROJECT"
        | "INPUT_MISSING"
        | "PACKAGE_TOO_LARGE";
      error: string;
    };

/**
 * T0 域侧动作：校验 tender 输入并创建（或复用）Workforce 域 run。
 * 全部沿用 legacy 同源原语（gate / package 选择 / fingerprint），
 * 但 run 以 AGENT_ANALYZING 落库，不进 legacy 队列（nextAttemptAt=null）。
 */
export async function createOrReuseWorkforceTenderAnalysisRun(input: {
  orgId: string;
  projectId: string;
  jobId: string;
  userId: string;
}): Promise<CreateWorkforceTenderRunResult> {
  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId },
    select: {
      id: true,
      orgId: true,
      workDomain: true,
      intelligenceRoom: { select: { id: true } },
    },
  });
  if (!project) {
    return {
      ok: false,
      code: "PROJECT_NOT_FOUND",
      error: "项目不存在或不属于当前组织",
    };
  }

  const gate = canAutoEnqueueAnalysis({
    workDomain: project.workDomain,
    hasIntelligenceRoom: Boolean(project.intelligenceRoom),
  });
  if (!gate.ok) {
    return {
      ok: false,
      code: "NOT_TENDER_PROJECT",
      error: "该项目未标记为投标项目，无法执行投标 AI 分析",
    };
  }

  let docs: PackageDocument[];
  try {
    docs = await getTenderPackageDocuments(input.projectId, {
      failOnMissingHash: true,
    });
  } catch (e) {
    if (e instanceof MissingPackageContentHashError) {
      return {
        ok: false,
        code: "INPUT_MISSING",
        error: "INPUT_MISSING: 投标文件缺少内容指纹，无法建立稳定分析输入",
      };
    }
    throw e;
  }
  if (docs.length === 0) {
    return {
      ok: false,
      code: "INPUT_MISSING",
      error: "INPUT_MISSING: 项目内没有可分析的投标文件（请先上传招标文件）",
    };
  }
  if (packageTooLarge(docs)) {
    return {
      ok: false,
      code: "PACKAGE_TOO_LARGE",
      error: "投标文件包超出单次分析页数上限，请缩小文件包后重试",
    };
  }

  const fingerprint = computePackageFingerprint(docs);
  const idempotencyKey = buildWorkforceTenderIdempotencyKey(input.jobId);
  const warning = detectMultiplePrimaryWarning(docs);

  const toManifest = (runId: string): TenderAnalysisInputManifest => ({
    analysisRunId: runId,
    projectId: input.projectId,
    fingerprint,
    mode: "full",
    documents: docs.map((d) => ({
      documentId: d.documentId,
      filename: d.filename,
      role: d.role,
      contentHash: d.contentHash,
      pageCount: d.pageCount,
    })),
    addendumCount: docs.filter((d) => d.role === "ADDENDUM").length,
    ...(warning ? { classificationWarning: warning } : {}),
  });

  // 工具重试幂等：同 Job 的第二次调用直接复用既有域 run
  const existing = await db.tenderAnalysisRun.findFirst({
    where: { idempotencyKey, orgId: input.orgId, projectId: input.projectId },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, manifest: toManifest(existing.id), reused: true };
  }

  try {
    const run = await db.tenderAnalysisRun.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        roomId: project.intelligenceRoom?.id ?? null,
        status: TENDER_AGENT_RUN_STATUS.running,
        runKind: "FULL",
        analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        promptVersion: TENDER_WORKFORCE_PROMPT_VERSION,
        idempotencyKey,
        sourceHashFingerprint: fingerprint,
        createdById: input.userId,
        startedAt: new Date(),
        // 不进 legacy 队列：无 nextAttemptAt / 无 lease
        nextAttemptAt: null,
        summaryJson: {
          source: "tender_workforce",
          jobId: input.jobId,
          documentCount: docs.length,
          ...(warning ? { classificationWarning: warning } : {}),
        },
        documents: {
          create: docs.map((d) => ({
            documentId: d.documentId,
            contentHash: d.contentHash,
            role: d.role,
          })),
        },
      },
      select: { id: true },
    });
    return { ok: true, manifest: toManifest(run.id), reused: false };
  } catch (err) {
    // 并发创建撞唯一键（idempotencyKey）：读回既有行
    const raced = await db.tenderAnalysisRun.findFirst({
      where: { idempotencyKey, orgId: input.orgId },
      select: { id: true },
    });
    if (raced) {
      return { ok: true, manifest: toManifest(raced.id), reused: true };
    }
    throw err;
  }
}

/**
 * 域 run 归属校验（§35 双保险之一）：analysisRunId 必须属于
 * (orgId, projectId) 且是 Workforce 路径创建的 run。
 */
export async function requireWorkforceTenderRun(input: {
  orgId: string;
  projectId: string;
  analysisRunId: string;
}): Promise<
  | { ok: true; run: { id: string; status: string } }
  | { ok: false; error: string }
> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.analysisRunId,
      orgId: input.orgId,
      projectId: input.projectId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
    },
    select: { id: true, status: true },
  });
  if (!run) {
    return {
      ok: false,
      error: "分析记录不存在或不属于当前项目（拒绝跨项目/跨组织访问）",
    };
  }
  return { ok: true, run };
}

/** RISKS 章节 upsert（真实风险分析覆盖 legacy 模板文案；同 report.ts 形状） */
export async function upsertWorkforceRiskSection(input: {
  orgId: string;
  projectId: string;
  analysisRunId: string;
  contentZh: string;
  structuredJson: Prisma.InputJsonValue;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const owned = await requireWorkforceTenderRun(input);
  if (!owned.ok) return owned;
  await db.tenderAnalysisSection.upsert({
    where: {
      runId_sectionKey: { runId: input.analysisRunId, sectionKey: "RISKS" },
    },
    create: {
      runId: input.analysisRunId,
      sectionKey: "RISKS",
      contentZh: input.contentZh,
      structuredJson: input.structuredJson,
      confidence: "MEDIUM",
      reviewStatus: "AI_DRAFT",
    },
    update: {
      contentZh: input.contentZh,
      structuredJson: input.structuredJson,
      confidence: "MEDIUM",
      reviewStatus: "AI_DRAFT",
    },
  });
  return { ok: true };
}

/**
 * T5-P1 Segment 1 — 语义保全（CANONICAL V2 FINALIZE）
 *
 * 背景（实证缺陷）：`finalizeWorkforceTenderAnalysisRun` 用
 * `summaryJson = TenderAnalysisResultV1` **整体替换**已有 summaryJson。
 * 一旦 Workforce 路径接入 canonical V2 管线（Segment 2/3），这一步会把
 * V2 的 submissionChecklist / analystSynthesis / brief / criticalFacts /
 * unknowns / conflicts / addendumChanges / evidenceCoverage / metadata
 * 全部抹掉——canonical 语义真相被 Runtime 执行摘要覆盖。
 *
 * 本函数提供**仅状态转换**的终态化：AGENT_ANALYZING → REVIEW_REQUIRED，
 * 只写 status / completedAt / 清错误字段，**绝不触碰 summaryJson 与 summaryText**
 * （V2_SUMMARY_TEXT_POLICY = PRESERVE）。
 *
 * 刻意不做 `{...old, ...v1}` 盲合并：两个 contract 语义不同，同名字段会互相污染。
 * V1 执行摘要在 V2 模式下作为 tool result / handoff 返回，不落 canonical 位置
 * （本段不为它新增 schema）。
 *
 * ⚠️ 能力就绪 ≠ 已启用：当前 deterministic DAG 仍走 legacy 语义抽取，
 * 因此 **t9 尚未切到本函数**（CURRENT_DAG_CANONICAL_V2_FINALIZE_ENABLED = NO）。
 * 切换属于 Segment 3——提前切会造成「旧语义抽取 + V2 状态终态化」的另一种半迁移状态。
 *
 * ownership / fail-closed 条件与 V1 路径完全一致：org + project + analysisVersion
 * + status=running 的条件更新；终态（cancelled/failed/superseded）不可复活。
 */
export async function finalizeWorkforceTenderCanonicalV2Run(input: {
  orgId: string;
  projectId: string;
  analysisRunId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await db.tenderAnalysisRun.updateMany({
    where: {
      id: input.analysisRunId,
      orgId: input.orgId,
      projectId: input.projectId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      status: TENDER_AGENT_RUN_STATUS.running,
    },
    // 仅状态转换：summaryJson / summaryText 不在 data 中 → canonical V2 结果原样保留
    data: {
      status: TENDER_AGENT_RUN_STATUS.reviewRequired,
      completedAt: new Date(),
      errorCode: null,
      errorMessageSanitized: null,
    },
  });
  if (updated.count === 0) {
    return {
      ok: false,
      error:
        "分析记录不处于进行中状态（可能已被取消或被新的分析取代），拒绝终态化",
    };
  }
  // 包2：完成通知（sourceKey 幂等去重；best-effort——通知失败绝不回滚 canonical）
  try {
    const { notifyTenderRunSucceeded } = await import(
      "@/lib/tender-auto-analysis/alerts"
    );
    await notifyTenderRunSucceeded(input.analysisRunId);
  } catch {
    /* 通知失败不影响终态化 */
  }
  return { ok: true };
}

/**
 * 终态化（成功，**V1 兼容投影**）：AGENT_ANALYZING → REVIEW_REQUIRED + 结构化结果落
 * summaryJson（tender-analysis-result/v1）。条件更新：run 已被取消/
 * 失败/superseded 时拒绝覆盖（fail-closed，不复活终态）。
 *
 * T5-P1 Segment 1：本函数保持**现有行为完全不变**，服务于 flag OFF /
 * legacy T1B Workforce 路径。canonical V2 路径请显式调用
 * {@link finalizeWorkforceTenderCanonicalV2Run}——调用方必须显式选择语义，
 * 禁止靠"summaryJson 里有没有某个字段"猜模式。
 */
export async function finalizeWorkforceTenderAnalysisRun(input: {
  orgId: string;
  projectId: string;
  analysisRunId: string;
  result: TenderAnalysisResultV1;
  summaryText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseTenderAnalysisResultV1(input.result);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const updated = await db.tenderAnalysisRun.updateMany({
    where: {
      id: input.analysisRunId,
      orgId: input.orgId,
      projectId: input.projectId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      status: TENDER_AGENT_RUN_STATUS.running,
    },
    data: {
      status: TENDER_AGENT_RUN_STATUS.reviewRequired,
      summaryJson: parsed.result as unknown as Prisma.InputJsonValue,
      summaryText: input.summaryText.slice(0, 2000),
      completedAt: new Date(),
      errorCode: null,
      errorMessageSanitized: null,
    },
  });
  if (updated.count === 0) {
    return {
      ok: false,
      error:
        "分析记录不处于进行中状态（可能已被取消或被新的分析取代），拒绝写入结果",
    };
  }
  // 包2：完成通知（sourceKey 幂等去重；best-effort——通知失败绝不回滚 canonical）
  try {
    const { notifyTenderRunSucceeded } = await import(
      "@/lib/tender-auto-analysis/alerts"
    );
    await notifyTenderRunSucceeded(input.analysisRunId);
  } catch {
    /* 通知失败不影响终态化 */
  }
  return { ok: true };
}

/** 终态化（失败/取消）：AGENT_ANALYZING → AGENT_FAILED（幂等；不覆盖其它终态） */
export async function failWorkforceTenderAnalysisRun(input: {
  orgId: string;
  analysisRunId?: string | null;
  jobId?: string | null;
  errorCode: string;
  errorMessage: string;
}): Promise<{ updated: boolean }> {
  const where: Prisma.TenderAnalysisRunWhereInput = {
    orgId: input.orgId,
    analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
    status: TENDER_AGENT_RUN_STATUS.running,
  };
  if (input.analysisRunId) {
    where.id = input.analysisRunId;
  } else if (input.jobId) {
    where.idempotencyKey = buildWorkforceTenderIdempotencyKey(input.jobId);
  } else {
    return { updated: false };
  }
  const updated = await db.tenderAnalysisRun.updateMany({
    where,
    data: {
      status: TENDER_AGENT_RUN_STATUS.failed,
      errorCode: input.errorCode.slice(0, 100),
      errorMessageSanitized: input.errorMessage.slice(0, 1000),
      failedAt: new Date(),
    },
  });
  // 包2：失败通知（cancelled=用户主动重新分析，不算失败、不打扰；
  // best-effort——通知失败绝不影响终态化）
  if (updated.count > 0 && input.errorCode !== "cancelled") {
    try {
      const failedRun = input.analysisRunId
        ? { id: input.analysisRunId }
        : await db.tenderAnalysisRun.findFirst({
            where: {
              orgId: input.orgId,
              analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
              status: TENDER_AGENT_RUN_STATUS.failed,
              idempotencyKey: input.jobId
                ? buildWorkforceTenderIdempotencyKey(input.jobId)
                : undefined,
            },
            select: { id: true },
          });
      if (failedRun) {
        const { notifyTenderRunFailed } = await import(
          "@/lib/tender-auto-analysis/alerts"
        );
        await notifyTenderRunFailed(failedRun.id);
      }
    } catch {
      /* 通知失败不影响终态化 */
    }
  }
  return { updated: updated.count > 0 };
}
