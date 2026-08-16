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
