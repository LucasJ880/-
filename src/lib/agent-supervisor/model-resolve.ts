/**
 * Supervisor 模型解析 — 复用 AI 统一配置，不硬编码 Client
 *
 * Env：
 *   AGENT_SUPERVISOR_PLANNER_MODEL
 *   AGENT_SUPERVISOR_OBSERVER_MODEL
 *   AGENT_SUPERVISOR_SUMMARY_MODEL
 *   AGENT_SUPERVISOR_REPAIR_MODEL
 *
 * 未设置时回退到 Agent Core 已验证可用的默认（primary = OPENAI_MODEL / gpt-5.6-sol）。
 * 指定模型 403/404/model_not_found 时，只允许再试一次默认 Fallback。
 */

import {
  createCompletionDetailed,
  type CompletionOptions,
  type DetailedCompletionResult,
} from "@/lib/ai/client";
import { getAIConfig, getTaskPreset } from "@/lib/ai/config";
import { logger } from "@/lib/common/logger";

export type SupervisorModelPurpose =
  | "planner"
  | "observer"
  | "summary"
  | "repair";

export interface SupervisorModelResolution {
  purpose: SupervisorModelPurpose;
  requestedModel: string;
  fallbackModel: string;
  source: "env" | "default";
}

export interface SupervisorModelCallResult extends DetailedCompletionResult {
  requestedModel: string;
  actualModel: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

function envModel(purpose: SupervisorModelPurpose): string | undefined {
  const key =
    purpose === "planner"
      ? "AGENT_SUPERVISOR_PLANNER_MODEL"
      : purpose === "observer"
        ? "AGENT_SUPERVISOR_OBSERVER_MODEL"
        : purpose === "summary"
          ? "AGENT_SUPERVISOR_SUMMARY_MODEL"
          : "AGENT_SUPERVISOR_REPAIR_MODEL";
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** 默认使用已验证可用的 primary（sol），避免 nano/luna 403 */
export function resolveSupervisorModel(input: {
  purpose: SupervisorModelPurpose;
  orgId?: string;
  userId?: string;
}): SupervisorModelResolution {
  const cfg = getAIConfig();
  const primary = cfg.primaryModel || getTaskPreset("normal").model;
  // Fallback 优先仍用 primary（账号常无 terra/luna 权限）；仅当 requested 不是 primary 时回退 primary
  const requested = envModel(input.purpose) || primary;
  const fallbackModel = requested === primary ? primary : primary;

  return {
    purpose: input.purpose,
    requestedModel: requested,
    fallbackModel,
    source: envModel(input.purpose) ? "env" : "default",
  };
}

function isModelAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("403") ||
    lower.includes("404") ||
    lower.includes("model_not_found") ||
    lower.includes("does not have access to model") ||
    lower.includes("invalid model")
  );
}

function isTransientModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    isModelAccessError(err) ||
    lower.includes("aborted") ||
    lower.includes("timeout") ||
    lower.includes("超时") ||
    lower.includes("429") ||
    lower.includes("rate limit")
  );
}

/**
 * 主管模型调用：优先 requested；仅在模型访问错误时试一次 fallback。
 * 不允许无限重试；失败时抛出，由调用方决定是否规则降级。
 */
export async function callSupervisorCompletion(
  purpose: SupervisorModelPurpose,
  opts: Omit<CompletionOptions, "model" | "mode"> & {
    orgId?: string;
    userId?: string;
    mode?: CompletionOptions["mode"];
  },
): Promise<SupervisorModelCallResult> {
  const resolved = resolveSupervisorModel({
    purpose,
    orgId: opts.orgId,
    userId: opts.userId,
  });

  try {
    const first = await createCompletionDetailed({
      ...opts,
      model: resolved.requestedModel,
      mode: opts.mode ?? (purpose === "summary" ? "structured" : "normal"),
    });
    if (resolved.source === "env") {
      logger.info("supervisor.model.used", {
        purpose,
        requestedModel: resolved.requestedModel,
        actualModel: first.model,
        fallbackUsed: false,
      });
    }
    return {
      ...first,
      requestedModel: resolved.requestedModel,
      actualModel: first.model,
      fallbackUsed: false,
    };
  } catch (err) {
    if (!isTransientModelError(err)) throw err;
    // 访问错误换模型；超时/中止用同一模型或 fallback 再试一次
    const retryModel = isModelAccessError(err)
      ? resolved.fallbackModel
      : resolved.fallbackModel !== resolved.requestedModel
        ? resolved.fallbackModel
        : resolved.requestedModel;
    if (!retryModel) throw err;

    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("supervisor.model.fallback", {
      purpose,
      requestedModel: resolved.requestedModel,
      fallbackModel: retryModel,
      fallbackReason: reason,
    });

    const second = await createCompletionDetailed({
      ...opts,
      model: retryModel,
      mode: opts.mode ?? "normal",
      timeoutMs: Math.max(opts.timeoutMs || 30_000, 45_000),
    });
    return {
      ...second,
      requestedModel: resolved.requestedModel,
      actualModel: second.model,
      fallbackUsed: true,
      fallbackReason: reason,
    };
  }
}
