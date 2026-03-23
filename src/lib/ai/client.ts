/**
 * 青砚 AI 统一调用客户端
 *
 * 所有 OpenAI 调用都通过这里发出。
 * 支持流式 (chat)、非流式 (structured tasks) 两种模式。
 */

import OpenAI from "openai";
import { getAIConfig, getTaskPreset, type TaskMode } from "./config";

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
}

export async function createChatStream(opts: ChatStreamOptions) {
  const preset = getTaskPreset(opts.mode ?? "chat");
  const client = getClient();

  return client.chat.completions.create({
    model: preset.model,
    messages: [
      { role: "developer", content: opts.systemPrompt },
      ...opts.messages,
    ],
    stream: true,
    temperature: preset.temperature,
    max_tokens: preset.maxTokens,
  });
}

// ── 非流式结构化调用 ──────────────────────────────────────────

export interface CompletionOptions {
  systemPrompt: string;
  userPrompt: string;
  mode?: TaskMode;
  temperature?: number;
  maxTokens?: number;
}

export async function createCompletion(opts: CompletionOptions): Promise<string> {
  const preset = getTaskPreset(opts.mode ?? "normal");
  const client = getClient();

  const res = await client.chat.completions.create({
    model: preset.model,
    messages: [
      { role: "developer", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
    temperature: opts.temperature ?? preset.temperature,
    max_tokens: opts.maxTokens ?? preset.maxTokens,
  });

  return res.choices[0]?.message?.content ?? "";
}
