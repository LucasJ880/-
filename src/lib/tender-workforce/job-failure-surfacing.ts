/**
 * CHAIN-0c — 招投标 AI 分析 Job 失败 / 卡住时立刻告诉人
 *
 * 2026-11-19「12-01 21C31-254242」：第 3 步失败后项目页 1 小时 40 分钟仍显示「分析中」、
 * 没有任何通知——项目上的分析记录只在第 9 步终态化或人手动重新发起 / 取消时才改状态。
 *
 * 处理器把 Job 写成 failed / needs_human 且写入成功之后（经 workforce-runtime/domain-hooks.ts），
 * 本模块把对应分析记录收尾为「AI 分析未完成」（既有 failWorkforceTenderAnalysisRun，它顺带
 * 触发既有失败通知），并写一条审计。幂等闸就是那次状态 CAS：已收尾的再调一次什么都不做。
 *
 * 纪律：原因只用确定性的中文（步骤名 + 查表），不复述原始错误文本；不读开关；不发出站；
 * 收尾失败只记日志，绝不影响 Job（调用方 try/catch）。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  findStoppedStepOrLast,
  stopReasonFromCodes,
  stopReasonSentenceZh,
  type StopReasonStep,
  type WorkforceStopReason,
} from "@/lib/workforce-runtime/read-model/stop-reason";
import { buildWorkforceTenderIdempotencyKey, failWorkforceTenderAnalysisRun, TENDER_WORKFORCE_ANALYSIS_VERSION } from "./analysis-run-service";

export const TENDER_JOB_FAILED_SURFACED_AUDIT_ACTION = "tender.workforce.failed_surfaced" as const;

/** 招投标工具在错误文本里会写的已知标记 → 固定中文（只输出固定文字，不复述原文） */
// 只认停住那一步自己的错误文本；模式收紧，避免「第 429 页」「Transaction timeout」这类误认
const KNOWN_TENDER_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bANALYSIS_EMPTY\b/, "模型调用全部失败，未产出有效分析"],
  [/(?:HTTP|status|code)[\s:=]*429\b|\b429 Too Many Requests|\brate[\s_-]?limit(?:ed|_exceeded)?\b/i, "模型调用被限流"],
  [/\bETIMEDOUT\b|\b(?:request|call|model|LLM) timed out\b/i, "单次调用超时"],
];

export type TenderStopStep = StopReasonStep & { errorMessage: string | null };

/** 招投标的停止原因：先认已知标记，再按错误码查表（与读模型同一张表） */
export function tenderJobStopReason(input: {
  steps: readonly TenderStopStep[];
  jobStatus: string;
  jobErrorCode: string | null;
  jobErrorMessage: string | null;
}): WorkforceStopReason | null {
  const found = findStoppedStepOrLast(input.steps);
  if (!found) return null;
  const [stepIndex, step] = found;
  const text = step.status === "failed" ? step.errorMessage ?? "" : "";
  const marker = KNOWN_TENDER_MARKERS.find(([re]) => re.test(text));
  return {
    stepIndex,
    stepTitle: step.title,
    reasonZh: marker ? marker[1] : stopReasonFromCodes({ stepErrorCode: step.errorCode, jobErrorCode: input.jobErrorCode, jobStatus: input.jobStatus }),
  };
}

export function tenderJobStopMessageZh(input: Parameters<typeof tenderJobStopReason>[0]): string {
  return stopReasonSentenceZh(tenderJobStopReason(input));
}

const SURFACED_STATUSES: ReadonlySet<string> = new Set(["failed", "needs_human"]);

export type SurfaceResult = { surfaced: boolean; reason?: "not_found" | "not_tender" | "not_stopped" | "already_terminal" };

/** Job 停下后的收尾（由 workforce-runtime/domain-hooks 调用；调用方 try/catch） */
export async function surfaceTenderJobStopped(runId: string): Promise<SurfaceResult> {
  const job = await db.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, orgId: true, status: true, errorCode: true, errorMessage: true, metadata: true },
  });
  if (!job) return { surfaced: false, reason: "not_found" };
  const meta = (job.metadata && typeof job.metadata === "object" ? job.metadata : {}) as Record<string, unknown>;
  if (meta.workDomain !== "tender") return { surfaced: false, reason: "not_tender" };
  if (!SURFACED_STATUSES.has(job.status)) return { surfaced: false, reason: "not_stopped" };

  const steps = await db.agentRunStep.findMany({
    where: { orgId: job.orgId, runId: job.id },
    // 按创建顺序 = 计划顺序（与读模型的查询同一排序）
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, status: true, errorCode: true, errorMessage: true },
  });
  const message = tenderJobStopMessageZh({ steps, jobStatus: job.status, jobErrorCode: job.errorCode, jobErrorMessage: job.errorMessage });
  const errorCode = job.errorCode || (job.status === "needs_human" ? "needs_human" : "workforce_failed");

  // 只改仍在「分析中」的那条（既有 CAS）；改了才会发既有失败通知
  const { updated } = await failWorkforceTenderAnalysisRun({ orgId: job.orgId, jobId: job.id, errorCode, errorMessage: message });
  if (!updated) return { surfaced: false, reason: "already_terminal" };

  const run = await db.tenderAnalysisRun.findFirst({
    where: { orgId: job.orgId, analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION, idempotencyKey: buildWorkforceTenderIdempotencyKey(job.id) },
    select: { id: true, projectId: true, createdById: true, project: { select: { ownerId: true } } },
  });
  // 审计主体：发起人；为空时用项目负责人（系统收尾，afterData.actor 写明 system）
  const auditUserId = run?.createdById ?? run?.project?.ownerId ?? null;
  if (run && auditUserId) {
    await logAudit({
      userId: auditUserId,
      orgId: job.orgId,
      projectId: run.projectId,
      action: TENDER_JOB_FAILED_SURFACED_AUDIT_ACTION,
      targetType: "workforce_job",
      targetId: job.id,
      afterData: { analysisRunId: run.id, jobStatus: job.status, errorCode, message, actor: "system" },
    });
  }
  return { surfaced: true };
}
