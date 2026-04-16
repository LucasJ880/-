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
      temperature: preset.temperature,
      max_completion_tokens: preset.maxTokens,
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
        temperature: opts.temperature ?? preset.temperature,
        max_completion_tokens: opts.maxTokens ?? preset.maxTokens,
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
