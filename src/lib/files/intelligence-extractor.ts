/**
 * 项目 AI 情报分析 — intelligence_report 主生成管线
 *
 * 生成链路：读取文档 → 构建 prompt → 主模型调用（含超时） → 失败则 fallback → 解析 JSON → 写 DB
 * 所有调用参数、耗时、异常均记录结构化日志，便于 Vercel 问题排查。
 */

import { db } from "@/lib/db";
import { createCompletionDetailed, type DetailedCompletionResult } from "@/lib/ai/client";
import { getIntelligenceReportConfig } from "@/lib/ai/config";
import {
  type IntelligenceResult,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  FALLBACK_SUFFIX,
  buildUserPrompt,
  tryParseJson,
  validateReportStructure,
  VALID_RECOMMENDATIONS,
  VALID_RISK_LEVELS,
} from "./intelligence-formatter";

// ── 类型 ──────────────────────────────────────────────────────

export interface ReportMeta {
  doc_type: "intelligence_report";
  prompt_version: string;
  generated_at: string;
  model_used: string;
  reasoning_effort: string;
  mode: string;
  temperature: number;
  max_tokens: number;
  source_char_count: number;
  source_doc_count: number;
  used_fallback: boolean;
  finish_reason: string | null;
  generation_time_ms: number;
  fallback_reason?: string;
}

// ── 日志前缀 ──────────────────────────────────────────────────

const TAG = "[IntelligenceReport]";

function logInfo(projectId: string, msg: string, data?: Record<string, unknown>) {
  console.debug(`${TAG} ${projectId} ${msg}`, data ? JSON.stringify(data) : "");
}

function logWarn(projectId: string, msg: string, data?: Record<string, unknown>) {
  console.warn(`${TAG} ${projectId} ${msg}`, data ? JSON.stringify(data) : "");
}

function logError(projectId: string, msg: string, err?: unknown) {
  console.error(
    `${TAG} ${projectId} ${msg}`,
    err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? ""),
  );
}

// ── 分类异常识别 ──────────────────────────────────────────────

type FailureCategory = "timeout" | "model_error" | "json_parse" | "incomplete_output" | "unknown";

function classifyError(err: unknown): FailureCategory {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (err.name === "AbortError" || msg.includes("abort") || msg.includes("timeout"))
      return "timeout";
    if (msg.includes("rate_limit") || msg.includes("429") || msg.includes("500") || msg.includes("502") || msg.includes("503"))
      return "model_error";
  }
  return "unknown";
}

// ── 单次调用尝试 ─────────────────────────────────────────────

interface CallAttemptResult {
  success: boolean;
  result: IntelligenceResult | null;
  raw: string;
  detail: DetailedCompletionResult | null;
  error?: unknown;
  failureCategory?: FailureCategory;
}

async function attemptGeneration(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  timeoutMs: number,
): Promise<CallAttemptResult> {
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
      return {
        success: false,
        result: partial,
        raw: detail.content,
        detail,
        failureCategory: "incomplete_output",
      };
    }

    const parsed = tryParseJson(detail.content);
    if (!parsed) {
      return {
        success: false,
        result: null,
        raw: detail.content,
        detail,
        failureCategory: "json_parse",
      };
    }

    return { success: true, result: parsed, raw: detail.content, detail };
  } catch (err) {
    return {
      success: false,
      result: null,
      raw: "",
      detail: null,
      error: err,
      failureCategory: classifyError(err),
    };
  }
}

// ── 主入口 ────────────────────────────────────────────────────

/**
 * 为项目生成/更新 AI 情报分析。
 *
 * 策略：
 * 1. 用主模型（高推理 + 大 token）尝试，设 50s 超时
 * 2. 如果超时 / 失败 / 返回不完整 → 回退到 fallback 模型（普通推理 + 较低 token）
 * 3. 如果 fallback 也失败 → 尝试用主模型的截断结果（如有）
 * 4. 所有路径都会将 report_meta 写入 fullReportJson._meta
 */
export async function generateProjectIntelligence(projectId: string): Promise<void> {
  const config = getIntelligenceReportConfig();

  logInfo(projectId, "开始生成", {
    model: config.model,
    fallback: config.fallbackModel,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    effort: config.reasoningEffort,
    promptVersion: config.promptVersion,
  });

  // ── 读取文档 ──────────────────────────────────────────────

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      documents: {
        where: { parseStatus: "done" },
        select: { title: true, contentText: true, aiSummaryJson: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      },
    },
  });

  if (!project) {
    logWarn(projectId, "项目不存在，跳过");
    return;
  }

  const docsWithContent = project.documents.filter(
    (d) => d.contentText || d.aiSummaryJson,
  );
  if (docsWithContent.length === 0) {
    logWarn(projectId, "无可用文档内容，跳过");
    return;
  }

  const { prompt: userPrompt, charCount, docCount } = buildUserPrompt(
    project.name,
    project.description,
    docsWithContent,
  );

  logInfo(projectId, "Prompt 构建完成", {
    sourceChars: charCount,
    docCount,
    promptLength: userPrompt.length,
  });

  // ── 主模型尝试 ────────────────────────────────────────────

  let usedFallback = false;
  let fallbackReason: string | undefined;
  let finalResult: IntelligenceResult | null = null;
  let finalDetail: DetailedCompletionResult | null = null;
  let actualModel = config.model;
  let actualTemperature = config.temperature;
  let actualMaxTokens = config.maxTokens;
  let actualMode = "deep";

  const primary = await attemptGeneration(
    SYSTEM_PROMPT,
    userPrompt,
    config.model,
    config.temperature,
    config.maxTokens,
    config.primaryTimeoutMs,
  );

  if (primary.success && primary.result) {
    finalResult = primary.result;
    finalDetail = primary.detail;
    logInfo(projectId, "主模型成功", {
      model: config.model,
      elapsedMs: primary.detail?.elapsedMs,
      finishReason: primary.detail?.finishReason,
    });
  } else {
    // ── 主模型失败，记录原因后尝试 fallback ───────────────
    fallbackReason = primary.failureCategory || "unknown";
    logWarn(projectId, `主模型失败 (${fallbackReason})，启动 fallback`, {
      model: config.model,
      elapsedMs: primary.detail?.elapsedMs,
      finishReason: primary.detail?.finishReason,
      error: primary.error instanceof Error ? primary.error.message : undefined,
      rawLength: primary.raw?.length,
    });

    usedFallback = true;
    actualModel = config.fallbackModel;
    actualTemperature = config.fallbackTemperature;
    actualMaxTokens = config.fallbackMaxTokens;
    actualMode = "normal";

    const fallbackSystemPrompt = SYSTEM_PROMPT + FALLBACK_SUFFIX;

    const fallback = await attemptGeneration(
      fallbackSystemPrompt,
      userPrompt,
      config.fallbackModel,
      config.fallbackTemperature,
      config.fallbackMaxTokens,
      config.fallbackTimeoutMs,
    );

    if (fallback.success && fallback.result) {
      finalResult = fallback.result;
      finalDetail = fallback.detail;
      logInfo(projectId, "Fallback 成功", {
        model: config.fallbackModel,
        elapsedMs: fallback.detail?.elapsedMs,
      });
    } else {
      logWarn(projectId, `Fallback 也失败 (${fallback.failureCategory})`, {
        model: config.fallbackModel,
        elapsedMs: fallback.detail?.elapsedMs,
        error: fallback.error instanceof Error ? fallback.error.message : undefined,
      });

      if (primary.result) {
        finalResult = primary.result;
        finalDetail = primary.detail;
        fallbackReason = `${fallbackReason}→fallback_also_failed→using_primary_partial`;
        logWarn(projectId, "使用主模型截断结果作为兜底");
      } else if (fallback.result) {
        finalResult = fallback.result;
        finalDetail = fallback.detail;
        fallbackReason = `${fallbackReason}→using_fallback_partial`;
      } else {
        logError(projectId, "所有尝试均失败，无法生成报告");
        return;
      }
    }
  }

  // ── 验证报告结构 ──────────────────────────────────────────

  if (finalResult.reportMarkdown) {
    const { valid, chapterCount } = validateReportStructure(finalResult.reportMarkdown);
    if (!valid) {
      logWarn(projectId, `报告结构不完整，仅检测到 ${chapterCount}/12 章节`, {
        chapterCount,
        usedFallback,
      });
    } else {
      logInfo(projectId, `报告结构验证通过 (${chapterCount}/12 章节)`);
    }
  }

  // ── 规范化字段 ────────────────────────────────────────────

  const recommendation = VALID_RECOMMENDATIONS.includes(finalResult.recommendation)
    ? finalResult.recommendation
    : "review_carefully";
  const riskLevel = VALID_RISK_LEVELS.includes(finalResult.riskLevel)
    ? finalResult.riskLevel
    : "medium";

  // ── 构建 report_meta 并注入 fullReportJson ────────────────

  const meta: ReportMeta = {
    doc_type: "intelligence_report",
    prompt_version: PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    model_used: actualModel,
    reasoning_effort: usedFallback ? config.fallbackReasoningEffort : config.reasoningEffort,
    mode: actualMode,
    temperature: actualTemperature,
    max_tokens: actualMaxTokens,
    source_char_count: charCount,
    source_doc_count: docCount,
    used_fallback: usedFallback,
    finish_reason: finalDetail?.finishReason ?? null,
    generation_time_ms: finalDetail?.elapsedMs ?? 0,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  };

  let enrichedJson = "{}";
  try {
    const base = finalResult.fullReportJson ? JSON.parse(finalResult.fullReportJson) : {};
    enrichedJson = JSON.stringify({ ...base, _meta: meta });
  } catch {
    enrichedJson = JSON.stringify({ _meta: meta });
  }

  // ── 写入 DB ───────────────────────────────────────────────

  const data = {
    recommendation,
    riskLevel,
    fitScore: finalResult.fitScore,
    summary: finalResult.summary,
    reportMarkdown: finalResult.reportMarkdown || null,
    fullReportJson: enrichedJson,
    reportStatus: "ai_generated",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    reviewScore: null,
  };

  try {
    const existing = await db.projectIntelligence.findUnique({
      where: { projectId },
      select: { id: true },
    });

    if (existing) {
      await db.projectIntelligence.update({ where: { projectId }, data });
    } else {
      await db.projectIntelligence.create({ data: { projectId, ...data } });
    }

    logInfo(projectId, "报告已保存", {
      recommendation,
      riskLevel,
      fitScore: finalResult.fitScore,
      usedFallback,
      totalMs: finalDetail?.elapsedMs,
      promptVersion: PROMPT_VERSION,
    });
  } catch (e) {
    logError(projectId, "DB 写入失败", e);
  }
}
