/**
 * 青砚 AI 对话管理层
 *
 * 职责：
 * 1. 对话窗口裁剪 — 保留最近 N 轮（默认 40 轮 = 80 条消息）
 * 2. 超长对话自动摘要 — 早期消息压缩成摘要后注入
 * 3. 智能模式检测 — 根据用户意图自动选择 chat / deep 模式
 */

import { createCompletion } from "./client";
import { getSummarySystemPrompt } from "./prompts";
import type { TaskMode } from "./config";

// ── 类型 ──────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PreparedConversation {
  messages: ChatMessage[];
  mode: TaskMode;
  summarizedContext: string;
}

// ── 配置常量 ──────────────────────────────────────────────────

const MAX_RECENT_ROUNDS = 40;
const MAX_RECENT_MESSAGES = MAX_RECENT_ROUNDS * 2;

const SUMMARY_THRESHOLD_MESSAGES = 50;

// ── 对话窗口裁剪 ─────────────────────────────────────────────

function trimToWindow(messages: ChatMessage[]): {
  kept: ChatMessage[];
  trimmed: ChatMessage[];
} {
  if (messages.length <= MAX_RECENT_MESSAGES) {
    return { kept: messages, trimmed: [] };
  }

  const cutIndex = messages.length - MAX_RECENT_MESSAGES;
  return {
    kept: messages.slice(cutIndex),
    trimmed: messages.slice(0, cutIndex),
  };
}

// ── 对话摘要生成 ──────────────────────────────────────────────

async function summarizeMessages(messages: ChatMessage[]): Promise<string> {
  if (messages.length === 0) return "";

  const transcript = messages
    .map((m) => `[${m.role === "user" ? "用户" : "助手"}] ${m.content.slice(0, 300)}`)
    .join("\n");

  const prompt = `请用 3-5 句话概括以下对话的关键内容和结论，保留重要的项目名、日期、决策和数字：

${transcript.slice(0, 6000)}`;

  try {
    const summary = await createCompletion({
      systemPrompt: getSummarySystemPrompt(),
      userPrompt: prompt,
      mode: "fast",
      maxTokens: 512,
    });
    return summary;
  } catch {
    return messages
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content.slice(0, 100))
      .join("；");
  }
}

// ── 智能模式检测 ──────────────────────────────────────────────

const DEEP_KEYWORDS = [
  "分析", "对比", "评估", "策略", "风险",
  "优劣", "建议", "规划", "方案", "拆解",
  "总结", "复盘", "可行性", "竞争", "投标策略",
  "详细", "深入", "全面", "综合", "比较",
  "帮我判断", "帮我分析", "帮我评估",
  "值不值得", "是否应该", "怎么选",
  "报价策略", "资源分配", "优先级排序",
];

function detectMode(lastUserMessage: string): TaskMode {
  if (!lastUserMessage) return "chat";
  const msg = lastUserMessage.toLowerCase();
  const matchCount = DEEP_KEYWORDS.filter((kw) => msg.includes(kw)).length;
  return matchCount >= 2 ? "deep" : "chat";
}

// ── 主入口：准备对话 ─────────────────────────────────────────

export async function prepareConversation(
  rawMessages: ChatMessage[]
): Promise<PreparedConversation> {
  const lastUserMsg = [...rawMessages].reverse().find((m) => m.role === "user");
  const mode = detectMode(lastUserMsg?.content ?? "");

  const { kept, trimmed } = trimToWindow(rawMessages);

  let summarizedContext = "";

  if (trimmed.length > 0 && rawMessages.length >= SUMMARY_THRESHOLD_MESSAGES) {
    summarizedContext = await summarizeMessages(trimmed);
  } else if (trimmed.length > 0) {
    summarizedContext = trimmed
      .filter((m) => m.role === "user")
      .slice(-5)
      .map((m) => m.content.slice(0, 150))
      .join("；");
  }

  return {
    messages: kept,
    mode,
    summarizedContext,
  };
}

// ── 构建摘要前缀（注入 system prompt） ───────────────────────

export function buildSummaryPrefix(summarized: string): string {
  if (!summarized) return "";
  return `\n## 早期对话摘要\n以下是本次对话早期内容的摘要（最近 40 轮对话的完整内容在消息列表中）：\n${summarized}\n`;
}
