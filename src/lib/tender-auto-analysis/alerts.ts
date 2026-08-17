/**
 * Tender 分析失败告警
 *
 * 2026-08-15 教训：run 在 13:18 就 FAILED，直到晚上用户主动问才被发现——
 * 中间十个小时没有任何人被通知。分片续跑消除了"跑不完"这一类失败，但仍会有
 * 别的终态失败（解析失败、包过大、模型空壳…）。终态一旦出现必须有人知道。
 *
 * 纪律：
 * - 只在**终态**告警（重试中不打扰）；
 * - sourceKey 幂等，同一 run 只提醒一次；
 * - 告警失败绝不反过来影响 worker（best-effort，吞异常）；
 * - 文案面向业务用户，不泄露内部 errorCode 原文以外的实现细节。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";

/** 终态失败原因 → 用户能看懂的一句话（未知 code 用兜底文案，绝不显示原始英文枚举） */
const REASON_TEXT: Record<string, string> = {
  lease_exhausted: "分析多次尝试后仍未完成",
  stale_run: "分析长时间没有进展",
  worker_failed: "分析过程中出错",
  empty_analysis: "模型调用全部失败，未产出有效分析",
};

export function tenderFailureSummary(input: {
  projectName: string | null;
  errorCode: string | null;
  attemptCount: number;
}): string {
  const reason =
    (input.errorCode && REASON_TEXT[input.errorCode]) || "分析未能完成";
  const proj = input.projectName ? `「${input.projectName}」` : "该招标项目";
  return `${proj}的 AI 分析已停止：${reason}（已尝试 ${input.attemptCount} 次）。可在项目里重新发起分析。`;
}

export function tenderFailureSourceKey(runId: string): string {
  return `tender-run-failed:${runId}`;
}

/** 收件人：项目负责人 + 发起人（去重、去空）。 */
export function resolveFailureRecipients(input: {
  ownerId: string | null | undefined;
  createdById: string | null | undefined;
}): string[] {
  return Array.from(
    new Set([input.ownerId, input.createdById].filter((x): x is string => Boolean(x))),
  );
}

/**
 * 对进入终态 FAILED 的 run 发一次站内通知（幂等、best-effort）。
 * 调用方不需要 await 结果正确性——本函数自行吞掉所有异常。
 */
export async function notifyTenderRunFailed(runId: string): Promise<void> {
  try {
    const run = await db.tenderAnalysisRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        orgId: true,
        projectId: true,
        status: true,
        errorCode: true,
        attemptCount: true,
        createdById: true,
        project: { select: { name: true, ownerId: true } },
      },
    });
    if (!run || run.status !== "FAILED") return;

    const recipients = resolveFailureRecipients({
      ownerId: run.project?.ownerId,
      createdById: run.createdById,
    });
    if (recipients.length === 0) return;

    const summary = tenderFailureSummary({
      projectName: run.project?.name ?? null,
      errorCode: run.errorCode,
      attemptCount: run.attemptCount,
    });

    for (const userId of recipients) {
      await createNotification({
        userId,
        orgId: run.orgId,
        projectId: run.projectId,
        type: "runtime_failed",
        category: "tender_analysis",
        priority: "high",
        title: "招标分析未能完成",
        summary,
        entityType: "tender_analysis_run",
        entityId: run.id,
        sourceKey: `${tenderFailureSourceKey(run.id)}:${userId}`,
        metadata: { errorCode: run.errorCode, attemptCount: run.attemptCount },
      });
    }
    console.log(
      `[tender-alert] run=${run.id} notified=${recipients.length} code=${run.errorCode ?? "-"}`,
    );
  } catch (e) {
    console.error(
      "[tender-alert] 通知失败（不影响 worker）:",
      e instanceof Error ? e.message : "unknown",
    );
  }
}

/* ------------------------------ 分析完成通知 ------------------------------ */

export type TenderSuccessFacts = {
  projectName: string | null;
  /** 纳入分析 / 用户上传的文件数（覆盖率，禁止只报好消息） */
  analyzedFiles: number | null;
  uploadedFiles: number | null;
  keyRequirements: number | null;
  risks: number | null;
  clarifications: number | null;
  /** Analyst QA 判定需要人工复核（通常有未解决冲突） */
  needsHumanReview: boolean;
};

/**
 * 完成通知文案：只陈述可核对的事实 + 一个明确的下一步。
 * 纪律：有排除文件就明说（覆盖率不许只报分子）；需人工复核就点出来。
 */
export function tenderSuccessSummary(f: TenderSuccessFacts): string {
  const parts: string[] = [];
  if (f.analyzedFiles != null && f.uploadedFiles != null) {
    parts.push(
      f.analyzedFiles < f.uploadedFiles
        ? `已分析 ${f.analyzedFiles}/${f.uploadedFiles} 个文件（其余格式不支持逐条溯源）`
        : `已分析全部 ${f.analyzedFiles} 个文件`,
    );
  }
  const counts: string[] = [];
  if (f.keyRequirements != null) counts.push(`关键要求 ${f.keyRequirements} 条`);
  if (f.risks != null) counts.push(`风险 ${f.risks} 项`);
  if (f.clarifications != null) counts.push(`待澄清 ${f.clarifications} 条`);
  if (counts.length > 0) parts.push(counts.join("、"));
  parts.push(
    f.needsHumanReview
      ? "AI 审校标记了需要人工复核的地方，请优先查看"
      : "可以开始确认招标要求",
  );
  const proj = f.projectName ? `「${f.projectName}」` : "招标项目";
  return `${proj}：${parts.join("；")}。`;
}

export function tenderSuccessSourceKey(runId: string): string {
  return `tender-run-succeeded:${runId}`;
}

/**
 * 分析进入待审核（REVIEW_REQUIRED）时通知负责人与发起人。
 * 与失败告警同一套纪律：幂等、best-effort、异常全吞。
 */
export async function notifyTenderRunSucceeded(runId: string): Promise<void> {
  try {
    const run = await db.tenderAnalysisRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        orgId: true,
        projectId: true,
        status: true,
        createdById: true,
        summaryJson: true,
        project: { select: { name: true, ownerId: true } },
      },
    });
    if (!run || run.status !== "REVIEW_REQUIRED") return;

    const recipients = resolveFailureRecipients({
      ownerId: run.project?.ownerId,
      createdById: run.createdById,
    });
    if (recipients.length === 0) return;

    const sj = (run.summaryJson ?? {}) as Record<string, unknown>;
    const syn = sj.analystSynthesis as
      | {
          coverage?: { analyzed?: number; uploaded?: number };
          keyRequirements?: unknown[];
          risksAndGaps?: unknown[];
          clarifications?: unknown[];
          qa?: { needsHumanReview?: boolean };
        }
      | undefined;

    const summary = tenderSuccessSummary({
      projectName: run.project?.name ?? null,
      analyzedFiles: syn?.coverage?.analyzed ?? null,
      uploadedFiles: syn?.coverage?.uploaded ?? null,
      keyRequirements: syn?.keyRequirements?.length ?? null,
      risks: syn?.risksAndGaps?.length ?? null,
      clarifications: syn?.clarifications?.length ?? null,
      needsHumanReview: syn?.qa?.needsHumanReview === true,
    });

    for (const userId of recipients) {
      await createNotification({
        userId,
        orgId: run.orgId,
        projectId: run.projectId,
        type: "project_update",
        category: "tender_analysis",
        priority: syn?.qa?.needsHumanReview === true ? "high" : "medium",
        title: "招标分析已完成，待确认",
        summary,
        entityType: "tender_analysis_run",
        entityId: run.id,
        sourceKey: `${tenderSuccessSourceKey(run.id)}:${userId}`,
        metadata: {
          analyzed: syn?.coverage?.analyzed ?? null,
          uploaded: syn?.coverage?.uploaded ?? null,
          needsHumanReview: syn?.qa?.needsHumanReview === true,
        },
      });
    }
    console.log(`[tender-alert] run=${run.id} success_notified=${recipients.length}`);
  } catch (e) {
    console.error(
      "[tender-alert] 完成通知失败（不影响 worker）:",
      e instanceof Error ? e.message : "unknown",
    );
  }
}
