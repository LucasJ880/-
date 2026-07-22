/**
 * 青砚 AI 统一调用客户端
 *
 * 所有 OpenAI 调用都通过这里发出。
 * 支持流式 (chat)、非流式 (structured tasks) 两种模式。
 */

import OpenAI from "openai";
import { getAIConfig, getTaskPreset, type TaskMode } from "./config";
import { recordAiCall, extractUsage } from "./monitor";

// ── 单例客户端 ────────────────────────────────────────────────

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client) return _client;
  const cfg = getAIConfig();
  _client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  return _client;
}

// ── 模型家族参数适配 ──────────────────────────────────────────
//
// GPT-5.6 起为纯推理模型：不接受自定义 temperature（仅默认值 1），
// 但支持 reasoning_effort。旧模型（gpt-4o / gpt-5.4 等）相反。
// 在这里统一适配，调用方无需感知模型差异。

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5\.6|o[0-9])/.test(model);
}

export function buildTuningParams(
  model: string,
  temperature: number,
  reasoningEffort: "low" | "medium" | "high",
  options: { hasFunctionTools?: boolean } = {},
): {
  temperature?: number;
  reasoning_effort?: "none" | "low" | "medium" | "high";
} {
  return isReasoningModel(model)
    ? {
        // Chat Completions 不支持部分推理模型同时启用 function tools
        // 和 reasoning_effort；工具轮次关闭推理，普通轮次保留原预设。
        reasoning_effort: options.hasFunctionTools ? "none" : reasoningEffort,
      }
    : { temperature };
}

// ── 流式对话 ──────────────────────────────────────────────────

export interface ChatStreamOptions {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  mode?: TaskMode;
  /**
   * 外部 AbortSignal（通常传入 NextRequest.signal）
   * 客户端断开连接时会自动中止上游 OpenAI 请求，避免继续计费。
   */
  signal?: AbortSignal;
}

export async function createChatStream(opts: ChatStreamOptions) {
  const preset = getTaskPreset(opts.mode ?? "chat");
  const client = getClient();

  return client.chat.completions.create(
    {
      model: preset.model,
      messages: [
        { role: "developer", content: opts.systemPrompt },
        ...opts.messages,
      ],
      stream: true,
      // 请求最终 usage 块；不支持的提供商会忽略，不影响流本身
      stream_options: { include_usage: true },
      max_completion_tokens: preset.maxTokens,
      ...buildTuningParams(preset.model, preset.temperature, preset.reasoningEffort),
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );
}

// ── 非流式结构化调用 ──────────────────────────────────────────

export interface CompletionOptions {
  systemPrompt: string;
  userPrompt: string;
  mode?: TaskMode;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  reasoningEffort?: "low" | "medium" | "high";
  /** Phase 3A-4：可信租户上下文时做月费用预检 */
  orgId?: string;
  userId?: string;
  workspaceId?: string;
}

export async function createCompletion(opts: CompletionOptions): Promise<string> {
  const result = await createCompletionDetailed(opts);
  return result.content;
}

// ── 详细返回版（含 finishReason / 实际 model / 耗时）───────

export interface DetailedCompletionResult {
  content: string;
  finishReason: string | null;
  model: string;
  elapsedMs: number;
}

export async function createCompletionDetailed(
  opts: CompletionOptions,
): Promise<DetailedCompletionResult> {
  if (opts.orgId && opts.userId) {
    const { precheckMonthlyAiCost } = await import(
      "@/lib/capabilities/governance/precheck"
    );
    const budget = await precheckMonthlyAiCost({
      orgId: opts.orgId,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
    });
    if (!budget.allowed) {
      throw new Error("配额限制：月 AI 费用已达 hard limit");
    }
  }

  const preset = getTaskPreset(opts.mode ?? "normal");
  const client = getClient();
  const actualModel = opts.model ?? preset.model;

  const controller = opts.timeoutMs ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : undefined;

  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create(
      {
        model: actualModel,
        messages: [
          { role: "developer", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
        max_completion_tokens: opts.maxTokens ?? preset.maxTokens,
        ...buildTuningParams(
          actualModel,
          opts.temperature ?? preset.temperature,
          opts.reasoningEffort ?? preset.reasoningEffort,
        ),
      },
      controller ? { signal: controller.signal } : undefined,
    );

    const elapsedMs = Date.now() - t0;
    const usage = extractUsage(res);
    recordAiCall({
      model: actualModel,
      success: true,
      elapsedMs,
      source: "completion",
      ...usage,
    });

    return {
      content: res.choices[0]?.message?.content ?? "",
      finishReason: res.choices[0]?.finish_reason ?? null,
      model: actualModel,
      elapsedMs,
    };
  } catch (err) {
    recordAiCall({
      model: actualModel,
      success: false,
      elapsedMs: Date.now() - t0,
      source: "completion",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
