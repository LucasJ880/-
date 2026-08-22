/**
 * Mention Gateway — Mock Channel Adapter（M1）
 *
 * 用途：API fixture / 本地测试 / 集成测试。
 * 禁止：真实 Slack / 企微 / 微信 / Email / outbound webhook —— 本适配器不持有任何网络客户端，
 *       sendMessage 只把消息写进内存 outbox。
 */

import { z } from "zod";
import type {
  ChannelAdapter,
  MentionEvent,
  MentionReceiveResult,
  MentionReplyTarget,
  MentionSendResult,
} from "../types";
import { evaluateAudience } from "../policy";

export const MockMentionEventInputSchema = z.object({
  eventId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  externalUserId: z.string().min(1).max(128),
  channelId: z.string().min(1).max(128),
  /** 受众形态；缺省由 threadId 推导。非 dm/thread 的值在 audience 阶段被拒 */
  channelType: z.string().min(1).max(32).optional(),
  threadId: z.string().min(1).max(128).optional(),
  text: z.string().min(1).max(4000),
  /** 缺省由正文是否以 @青砚 / @Qingyan 开头推导 */
  mentionedAgent: z.boolean().optional(),
  timestamp: z.string().min(1).max(64).optional(),
});

export type MockMentionEventInput = z.infer<typeof MockMentionEventInputSchema>;

// 注意：JS `\b` 对 CJK 无效（青砚 与空格之间没有 word boundary），故显式列出后缀分隔符
const MENTION_PREFIX = /^\s*@(?:qingyan(?![a-z0-9_])|青砚)[\s:：,，!！。.]*/i;

export function detectAndStripMention(text: string): {
  mentioned: boolean;
  text: string;
} {
  const m = text.match(MENTION_PREFIX);
  if (!m) return { mentioned: false, text: text.trim() };
  return { mentioned: true, text: text.slice(m[0].length).trim() };
}

/** 纯函数：原始 payload → MentionEvent（或结构化拒绝） */
export function normalizeMockMentionEvent(
  raw: unknown,
  now: () => Date = () => new Date(),
): MentionReceiveResult {
  const parsed = MockMentionEventInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_EVENT", message: "事件格式不合法" };
  }
  const input = parsed.data;

  const channelType = input.channelType ?? (input.threadId ? "thread" : "dm");
  const audience = evaluateAudience(channelType);
  if (!audience.ok) {
    return { ok: false, code: audience.code, message: audience.message };
  }
  if (channelType === "thread" && !input.threadId) {
    return { ok: false, code: "INVALID_EVENT", message: "线程消息缺少 threadId" };
  }

  let timestamp = input.timestamp;
  if (timestamp) {
    const t = Date.parse(timestamp);
    if (Number.isNaN(t)) {
      return { ok: false, code: "INVALID_EVENT", message: "timestamp 不是合法时间" };
    }
    timestamp = new Date(t).toISOString();
  } else {
    timestamp = now().toISOString();
  }

  const detected = detectAndStripMention(input.text);
  const mentionedAgent = input.mentionedAgent ?? detected.mentioned;
  const text = detected.mentioned ? detected.text : input.text.trim();
  if (!text) {
    return { ok: false, code: "INVALID_EVENT", message: "正文为空" };
  }

  const event: MentionEvent = {
    provider: "mock",
    eventId: input.eventId,
    channel: { id: input.channelId, type: channelType as MentionEvent["channel"]["type"] },
    threadId: input.threadId,
    messageId: input.messageId,
    externalUserId: input.externalUserId,
    text,
    mentionedAgent,
    timestamp,
  };
  return { ok: true, event };
}

export interface MockOutboundMessage {
  target: MentionReplyTarget;
  text: string;
  at: string;
}

export class MockChannelAdapter implements ChannelAdapter {
  readonly provider = "mock" as const;
  readonly outbox: MockOutboundMessage[] = [];
  /** 测试用：让下一次 sendMessage 失败 */
  failNextSend: string | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  receiveEvent(raw: unknown): MentionReceiveResult {
    return normalizeMockMentionEvent(raw, this.now);
  }

  async sendMessage(
    target: MentionReplyTarget,
    text: string,
  ): Promise<MentionSendResult> {
    if (target.audience !== "initiating_user_only") {
      return { ok: false, error: "mock adapter 只支持 initiating_user_only 受众" };
    }
    if (this.failNextSend) {
      const err = this.failNextSend;
      this.failNextSend = null;
      return { ok: false, error: err };
    }
    this.outbox.push({ target, text, at: this.now().toISOString() });
    return { ok: true, externalMsgId: `mock-out-${this.outbox.length}` };
  }

  clear(): void {
    this.outbox.length = 0;
    this.failNextSend = null;
  }
}

/** 进程级默认实例（Mock API 使用；Serverless 下为每实例独立内存） */
let defaultAdapter: MockChannelAdapter | null = null;

export function getDefaultMockChannelAdapter(): MockChannelAdapter {
  if (!defaultAdapter) defaultAdapter = new MockChannelAdapter();
  return defaultAdapter;
}
