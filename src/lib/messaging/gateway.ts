/**
 * 统一消息网关
 *
 * 核心路由：
 * 1. 微信消息进入 → 查找绑定用户 → 过滤检查 → Agent Core 处理 → 回复
 * 2. 主动推送 → 查找用户绑定 → 通过对应 Adapter 发送
 *
 * 所有消息都持久化到 WeChatMessage 表 + 异步索引到记忆系统。
 */

import { db } from "@/lib/db";
import { findBindingByExternal, touchBinding } from "./binding";
import type {
  ChannelType,
  InboundMessage,
  MessagingAdapter,
  FilterMode,
} from "./types";

const adapters = new Map<ChannelType, MessagingAdapter>();

export function registerAdapter(adapter: MessagingAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): MessagingAdapter | undefined {
  return adapters.get(channel);
}

export function listAdapters(): MessagingAdapter[] {
  return Array.from(adapters.values());
}

/**
 * 处理入站消息 — 所有 Adapter 的 onMessage 都调用此函数
 */
export async function handleInboundMessage(msg: InboundMessage): Promise<void> {
  // 1. 查找绑定
  const binding = await findBindingByExternal(msg.channel, msg.externalUserId);
  if (!binding || binding.status !== "active") {
    return; // 未绑定用户，忽略
  }

  // 2. 消息过滤
  if (!passesFilter(msg.content, binding.filterMode as FilterMode, binding.filterKeyword)) {
    return;
  }

  // 3. 更新活跃时间
  await touchBinding(msg.channel, msg.externalUserId);

  // 4. 持久化入站消息
  await db.weChatMessage.create({
    data: {
      bindingId: binding.id,
      userId: binding.userId,
      orgId: undefined,
      direction: "inbound",
      channel: msg.channel,
      externalUserId: msg.externalUserId,
      content: msg.content,
      messageType: msg.messageType,
      externalMsgId: msg.externalMsgId,
    },
  });

  // 5. 调用 Agent Core 处理
  let aiResponse: string;
  try {
    aiResponse = await processWithAgentCore(binding.userId, msg);
  } catch (e) {
    aiResponse = `抱歉，处理出错: ${e instanceof Error ? e.message : "未知错误"}`;
  }

  // 6. 发送回复
  const adapter = getAdapter(msg.channel);
  if (adapter) {
    try {
      await adapter.sendText(msg.externalUserId, aiResponse);
    } catch {
      // 发送失败，记录但不阻塞
    }
  }

  // 7. 持久化出站消息
  await db.weChatMessage.create({
    data: {
      bindingId: binding.id,
      userId: binding.userId,
      direction: "outbound",
      channel: msg.channel,
      externalUserId: msg.externalUserId,
      content: aiResponse,
      messageType: "text",
      agentProcessed: true,
      agentResponse: aiResponse,
    },
  });

  // 8. 异步提取记忆 + 索引（不阻塞）
  extractAndIndex(binding.userId, binding.id, msg.content, aiResponse).catch(() => {});
}

/**
 * 主动推送消息给用户
 */
export async function pushMessage(
  userId: string,
  content: string,
  options?: { channels?: ChannelType[] },
): Promise<{ sent: number; failed: number }> {
  const bindings = await db.weChatBinding.findMany({
    where: {
      userId,
      status: "active",
      ...(options?.channels ? { channel: { in: options.channels } } : {}),
    },
  });

  let sent = 0;
  let failed = 0;

  for (const binding of bindings) {
    if (isInSilentPeriod(binding.silentStart, binding.silentEnd)) {
      continue;
    }

    const adapter = getAdapter(binding.channel as ChannelType);
    if (!adapter) continue;

    try {
      await adapter.sendText(binding.externalId, content);
      await db.weChatMessage.create({
        data: {
          bindingId: binding.id,
          userId,
          direction: "outbound",
          channel: binding.channel,
          externalUserId: binding.externalId,
          content,
          messageType: "text",
        },
      });
      sent++;
    } catch {
      failed++;
    }
  }

  return { sent, failed };
}

// ── 内部函数 ──────────────────────────────────────────────────

async function processWithAgentCore(
  userId: string,
  msg: InboundMessage,
): Promise<string> {
  const { runAgent } = await import("@/lib/agent-core");
  const {
    getWakeUpMemories,
    recallMemories,
    buildUserMemoryBlock,
  } = await import("@/lib/ai/user-memory");

  // 加载最近 5 条微信对话作为上下文
  const recentMessages = await db.weChatMessage.findMany({
    where: { userId, channel: msg.channel },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { direction: true, content: true },
  });

  const history = recentMessages
    .reverse()
    .map((m) => ({
      role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

  // 加载用户记忆
  const membership = await db.organizationMember.findFirst({
    where: { userId },
    select: { orgId: true },
  });
  const orgId = membership?.orgId ?? "default";

  const [wakeUp, l2] = await Promise.all([
    getWakeUpMemories(userId),
    recallMemories(userId, msg.content, { limit: 3 }),
  ]);
  const memoryBlock = buildUserMemoryBlock(wakeUp.l0, wakeUp.l1, l2);

  const systemPrompt = `你是「青砚」AI 工作助理，正在通过微信与用户对话。

规则：
- 用简洁中文回复，适合手机阅读（短句、分行）
- 如果需要数据，直接调用工具查询
- 给出具体可执行的建议
- 当用户说"发"、"确认"、"好的"时，执行对应操作
- 复杂内容用数字列表，方便用户回复数字选择
${memoryBlock}`;

  const messages = [
    ...history.slice(-8),
    { role: "user" as const, content: msg.content },
  ];

  const result = await runAgent({
    systemPrompt,
    messages,
    domains: ["trade", "secretary", "system"],
    mode: "chat",
    temperature: 0.3,
    userId,
    orgId,
    maxToolRounds: 3,
  });

  return result.content;
}

function passesFilter(content: string, mode: FilterMode, keyword: string | null): boolean {
  switch (mode) {
    case "all":
      return true;
    case "keyword":
      return keyword ? content.includes(keyword) : true;
    case "whitelist":
      return true; // 白名单由绑定层控制，到这里已经通过
    default:
      return true;
  }
}

function isInSilentPeriod(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // 跨午夜，如 22:00 - 08:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

async function extractAndIndex(
  userId: string,
  _bindingId: string,
  userMsg: string,
  aiReply: string,
): Promise<void> {
  const { extractMemoriesFromConversation, saveMemories } = await import(
    "@/lib/ai/user-memory"
  );

  const extracted = extractMemoriesFromConversation(userMsg, aiReply);
  if (extracted.length > 0) {
    await saveMemories(
      userId,
      extracted.map((e) => ({
        memoryType: e.memoryType,
        content: e.content,
        layer: e.importance >= 4 ? 1 : 2,
        tags: e.tags,
        importance: e.importance,
      })),
    );
  }
}
