/**
 * project_progress_summary — 核心生成管线与持久化
 */

import { db } from "@/lib/db";
import { createCompletionDetailed, type DetailedCompletionResult } from "@/lib/ai/client";
import { getTaskPreset } from "@/lib/ai/config";
import { formatDateTimeToronto } from "@/lib/time";
import {
  type ProgressSummaryOutput,
  type ProjectData,
  SYSTEM_PROMPT,
  buildUserPrompt,
  tryParseJson,
} from "./summary-prompt";

// ── 类型 ──────────────────────────────────────────────────────

export interface ProgressSummaryMeta {
  doc_type: "project_progress_summary";
  prompt_version: string;
  generated_at: string;
  model_used: string;
  mode: string;
  temperature: number;
  max_tokens: number;
  source_count: number;
  used_fallback: boolean;
  finish_reason: string | null;
  generation_time_ms: number;
  summary_scope: "project";
  fallback_reason?: string;
}

export interface ProgressSummaryResult {
  output: ProgressSummaryOutput;
  meta: ProgressSummaryMeta;
}

// ── 常量 ──────────────────────────────────────────────────────

const PROMPT_VERSION = "project_progress_summary_v1";
const TAG = "[ProgressSummary]";
const PRIMARY_TIMEOUT_MS = 45_000;
const FALLBACK_TIMEOUT_MS = 45_000;

// ── 取数 ──────────────────────────────────────────────────────

async function gatherProjectData(projectId: string): Promise<ProjectData | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      intelligence: {
        select: { recommendation: true, riskLevel: true, fitScore: true, summary: true, reportStatus: true },
      },
      documents: {
        select: { title: true, fileType: true, parseStatus: true, aiSummaryStatus: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      members: {
        where: { status: "active" },
        select: { role: true, user: { select: { name: true, email: true } } },
      },
    },
  });

  if (!project) return null;

  const [taskRows, overdueCount, recentMessages, inquiries, auditLogs] = await Promise.all([
    db.task.findMany({
      where: { projectId },
      select: { title: true, status: true, priority: true, dueDate: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    db.task.count({
      where: { projectId, status: { notIn: ["done", "cancelled"] }, dueDate: { lt: new Date() } },
    }),
    db.projectMessage.findMany({
      where: { projectId, deletedAt: null },
      select: { body: true, type: true, createdAt: true, sender: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    db.projectInquiry.findMany({
      where: { projectId },
      select: {
        roundNumber: true,
        status: true,
        items: { select: { status: true } },
      },
      orderBy: { roundNumber: "asc" },
    }),
    db.auditLog.findMany({
      where: { projectId },
      select: { action: true, targetType: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const totalTasks = taskRows.length;
  const doneTasks = taskRows.filter((t) => t.status === "done").length;
  const inProgressTasks = taskRows.filter((t) => t.status === "in_progress").length;

  return {
    project: {
      name: project.name,
      description: project.description,
      client: project.clientOrganization,
      stage: project.tenderStatus,
      priority: project.priority,
      closeDate: project.closeDate ? project.closeDate.toISOString().slice(0, 10) : null,
      location: project.location,
      estimatedValue: project.estimatedValue,
      currency: project.currency,
      sourceSystem: project.sourceSystem,
      status: project.status,
      createdAt: formatDateTimeToronto(project.createdAt),
    },
    intelligence: project.intelligence
      ? {
          recommendation: project.intelligence.recommendation,
          riskLevel: project.intelligence.riskLevel,
          fitScore: project.intelligence.fitScore,
          summary: project.intelligence.summary,
          reportStatus: project.intelligence.reportStatus,
        }
      : null,
    taskStats: { total: totalTasks, done: doneTasks, overdue: overdueCount, inProgress: inProgressTasks },
    tasks: taskRows.slice(0, 15).map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    })),
    recentDiscussion: recentMessages.reverse().map((m) => ({
      sender: m.sender?.name || "系统",
      body: m.body.slice(0, 200),
      time: formatDateTimeToronto(m.createdAt),
      type: m.type,
    })),
    inquiries: inquiries.map((iq) => ({
      round: iq.roundNumber,
      status: iq.status,
      items: iq.items.length,
      quoted: iq.items.filter((i) => i.status === "quoted").length,
    })),
    documents: project.documents.map((d) => ({
      title: d.title,
      type: d.fileType,
      hasSummary: d.aiSummaryStatus === "done",
    })),
    members: project.members.map((m) => ({
      name: m.user.name || m.user.email || "未知",
      role: m.role,
    })),
    auditHighlights: auditLogs.map((a) => ({
      action: a.action,
      target: a.targetType,
      time: formatDateTimeToronto(a.createdAt),
    })),
  };
}

// ── 单次调用 ──────────────────────────────────────────────────

async function attemptCall(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  timeoutMs: number,
): Promise<{ ok: boolean; output: ProgressSummaryOutput | null; detail: DetailedCompletionResult | null; error?: string }> {
  try {
    const detail = await createCompletionDetailed({
      systemPrompt,
      userPrompt,
      model,
      temperature,
      maxTokens,
      timeoutMs,
    });

    if (detail.finishReason === "length") {
      const partial = tryParseJson(detail.content);
      return { ok: false, output: partial, detail, error: "incomplete_output" };
    }

    const parsed = tryParseJson(detail.content);
    if (!parsed) {
      return { ok: false, output: null, detail, error: "json_parse" };
    }

    return { ok: true, output: parsed, detail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && (err.name === "AbortError" || msg.includes("abort"));
    return { ok: false, output: null, detail: null, error: isTimeout ? "timeout" : msg };
  }
}

// ── 主入口 ────────────────────────────────────────────────────

export type TriggerType = "manual" | "cron" | "agent";

export async function generateProgressSummary(
  projectId: string,
  triggerType: TriggerType = "manual",
): Promise<ProgressSummaryResult | null> {
  const normalPreset = getTaskPreset("normal");
  const fastPreset = getTaskPreset("fast");

  console.debug(`${TAG} ${projectId} 开始生成`);

  const data = await gatherProjectData(projectId);
  if (!data) {
    console.warn(`${TAG} ${projectId} 项目不存在或数据为空`);
    return null;
  }

  const userPrompt = buildUserPrompt(data);
  const sourceCount =
    data.tasks.length +
    data.recentDiscussion.length +
    data.documents.length +
    data.inquiries.length +
    data.auditHighlights.length;

  console.debug(`${TAG} ${projectId} 数据源: tasks=${data.taskStats.total}, msgs=${data.recentDiscussion.length}, docs=${data.documents.length}, audit=${data.auditHighlights.length}`);

  // 主调用
  let usedFallback = false;
  let fallbackReason: string | undefined;
  let finalOutput: ProgressSummaryOutput | null = null;
  let finalDetail: DetailedCompletionResult | null = null;
  let actualModel = normalPreset.model;
  let actualTemp = 0.3;
  let actualMaxTokens = 4096;
  let actualMode = "normal";

  const primary = await attemptCall(
    SYSTEM_PROMPT,
    userPrompt,
    normalPreset.model,
    0.3,
    4096,
    PRIMARY_TIMEOUT_MS,
  );

  if (primary.ok && primary.output) {
    finalOutput = primary.output;
    finalDetail = primary.detail;
    console.debug(`${TAG} ${projectId} 主调用成功 (${primary.detail?.elapsedMs}ms)`);
  } else {
    fallbackReason = primary.error || "unknown";
    console.warn(`${TAG} ${projectId} 主调用失败 (${fallbackReason})，启动 fallback`);

    usedFallback = true;
    actualModel = fastPreset.model;
    actualTemp = 0.5;
    actualMaxTokens = 2048;
    actualMode = "fast";

    const fallback = await attemptCall(
      SYSTEM_PROMPT + "\n\n⚠️ 即使信息有限也必须按完整 JSON 结构输出所有 7 个字段。不允许退化为聊天风格。",
      userPrompt,
      fastPreset.model,
      0.5,
      2048,
      FALLBACK_TIMEOUT_MS,
    );

    if (fallback.ok && fallback.output) {
      finalOutput = fallback.output;
      finalDetail = fallback.detail;
      console.debug(`${TAG} ${projectId} Fallback 成功 (${fallback.detail?.elapsedMs}ms)`);
    } else if (primary.output) {
      finalOutput = primary.output;
      finalDetail = primary.detail;
      fallbackReason += "→fallback_failed→using_primary_partial";
      console.warn(`${TAG} ${projectId} Fallback 也失败，用主调用截断结果`);
    } else {
      console.error(`${TAG} ${projectId} 所有尝试均失败`);
      return null;
    }
  }

  if (!finalOutput) return null;

  const meta: ProgressSummaryMeta = {
    doc_type: "project_progress_summary",
    prompt_version: PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    model_used: usedFallback ? (finalDetail?.model || actualModel) : (finalDetail?.model || normalPreset.model),
    mode: actualMode,
    temperature: usedFallback ? actualTemp : 0.3,
    max_tokens: usedFallback ? actualMaxTokens : 4096,
    source_count: sourceCount,
    used_fallback: usedFallback,
    finish_reason: finalDetail?.finishReason ?? null,
    generation_time_ms: finalDetail?.elapsedMs ?? 0,
    summary_scope: "project",
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  };

  console.debug(`${TAG} ${projectId} 完成`, {
    status: finalOutput.overallStatus,
    usedFallback,
    ms: finalDetail?.elapsedMs,
  });

  // 持久化到 DB
  try {
    await db.projectProgressSummary.create({
      data: {
        projectId,
        overallStatus: finalOutput.overallStatus,
        statusLabel: finalOutput.statusLabel,
        outputJson: JSON.stringify(finalOutput),
        executiveSummary: finalOutput.executiveSummary || null,
        docType: "project_progress_summary",
        promptVersion: PROMPT_VERSION,
        modelUsed: meta.model_used,
        usedFallback,
        generationTimeMs: meta.generation_time_ms,
        metaJson: JSON.stringify(meta),
        reportStatus: "ai_generated",
        triggerType,
      },
    });
    console.debug(`${TAG} ${projectId} 已持久化到 DB`);
  } catch (persistErr) {
    console.error(`${TAG} ${projectId} 持久化失败`, persistErr);
  }

  return { output: finalOutput, meta };
}

// ── 历史查询 ──────────────────────────────────────────────────

export async function getLatestSummary(projectId: string) {
  return db.projectProgressSummary.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSummaryHistory(projectId: string, limit = 10) {
  return db.projectProgressSummary.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      overallStatus: true,
      statusLabel: true,
      executiveSummary: true,
      promptVersion: true,
      modelUsed: true,
      usedFallback: true,
      generationTimeMs: true,
      reportStatus: true,
      reviewScore: true,
      triggerType: true,
      createdAt: true,
    },
  });
}

export async function updateSummaryReview(
  summaryId: string,
  data: {
    reportStatus: string;
    reviewedBy: string;
    reviewNotes?: string;
    reviewScore?: number;
  },
) {
  const statusNeedsReviewer = ["approved", "needs_revision", "in_review"];
  return db.projectProgressSummary.update({
    where: { id: summaryId },
    data: {
      reportStatus: data.reportStatus,
      reviewedBy: data.reviewedBy,
      reviewNotes: data.reviewNotes ?? undefined,
      reviewScore: data.reviewScore ?? undefined,
      reviewedAt: statusNeedsReviewer.includes(data.reportStatus) ? new Date() : undefined,
    },
  });
}
