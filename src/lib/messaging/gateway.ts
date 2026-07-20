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
import { findBindingByExternal, resolveBindingOrgId, touchBinding } from "./binding";
import { PLATFORM_WECOM_ORG_ID } from "./platform-wecom";
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
 * 获取可用于发送的 adapter（Serverless 多实例安全）
 *
 * 优先使用已注册的内存 adapter；若不存在，则根据 orgId 按需实例化
 * 并仅加载凭证（不启动长轮询），避免 Vercel 多实例下推送静默失败。
 */
export async function ensureSendAdapter(
  channel: ChannelType,
  orgId: string | null,
): Promise<MessagingAdapter | null> {
  const cached = adapters.get(channel);
  if (cached) return cached;

  if (channel === "wecom") {
    const { WeComAdapter } = await import("./adapters/wecom");
    // 优先平台凭证；未配置平台时回退到业务 org 级网关（兼容旧接入）
    const credentialOrgId = await resolveWecomSendCredentialOrgId(orgId);
    if (!credentialOrgId) return null;
    const adapter = new WeComAdapter(credentialOrgId);
    await adapter.start();
    return adapter.getStatus() === "connected" ? adapter : null;
  }

  if (!orgId) return null;

  if (channel === "personal_wechat") {
    const { PersonalWeChatAdapter } = await import("./adapters/personal-wechat");
    const adapter = new PersonalWeChatAdapter(orgId);
    const ok = await adapter.loadCredentials();
    return ok ? adapter : null;
  }

  return null;
}

/** 发送侧解析企微凭证所在 org：平台网关优先 */
async function resolveWecomSendCredentialOrgId(
  businessOrgId: string | null,
): Promise<string | null> {
  const platform = await db.weChatGateway.findUnique({
    where: {
      orgId_channel: { orgId: PLATFORM_WECOM_ORG_ID, channel: "wecom" },
    },
    select: { corpId: true, secret: true },
  });
  if (platform?.corpId && platform?.secret) {
    return PLATFORM_WECOM_ORG_ID;
  }
  return businessOrgId;
}

/**
 * 按网关业务模式给适配器绑定入站处理器。
 *
 * - assistant（默认）：内部员工 AI 助理，走 handleInboundMessage（绑定 → userId → Agent）。
 * - trade_intake：外贸客户需求受理 bot，走 trade 受理链路（建单到客户 org，可自动桥接到处理方 org），
 *   回复直接通过该适配器发回客户，不依赖 WeChatBinding。
 */
export async function attachAdapterInbound(
  adapter: MessagingAdapter,
  gateway: { orgId: string; mode?: string | null; fulfillmentOrgId?: string | null },
): Promise<void> {
  if (gateway.mode === "trade_intake") {
    const { createTradeIntakeMessageHandler } = await import("@/lib/trade/service-intake");
    const handler = createTradeIntakeMessageHandler(
      gateway.orgId,
      async (to, content) => {
        await adapter.sendText(to, content);
      },
      { autoFulfillmentOrgId: gateway.fulfillmentOrgId ?? null },
    );
    adapter.onMessage(async (msg: InboundMessage) => {
      await handler({
        channel: msg.channel,
        externalUserId: msg.externalUserId,
        externalUserName: msg.externalUserName ?? null,
        content: msg.content,
        messageType: msg.messageType,
        externalMsgId: msg.externalMsgId,
        media: msg.media,
      });
    });
    return;
  }
  adapter.onMessage(handleInboundMessage);
}

/**
 * 处理入站消息 — 内部员工 AI 助理通道（assistant 模式）的统一入口
 *
 * Phase-1 流程：
 * 身份校验 → 去重 → Session → Run →（确定性命令 / ACK）→ 业务分流 → 最终回复
 */
export async function handleInboundMessage(msg: InboundMessage): Promise<void> {
  // 1. 查找绑定
  const binding = await findBindingByExternal(msg.channel, msg.externalUserId);
  if (!binding || binding.status !== "active") {
    if (msg.orgId && !msg.externalUserId.includes("@chatroom")) {
      const { recordCustomerMessage } = await import(
        "@/lib/service-inbox/service"
      );
      await recordCustomerMessage({
        orgId: msg.orgId,
        channel: msg.channel,
        externalUserId: msg.externalUserId,
        displayName: msg.externalUserName,
        content: msg.messageType === "image" ? "📷 [图片]" : msg.content,
        messageType: msg.messageType,
        externalMsgId: msg.externalMsgId,
        timestamp: msg.timestamp,
      }).catch((e) =>
        console.error("[Gateway] record customer message failed:", e),
      );
    }
    return;
  }

  const orgId = await resolveBindingOrgId(binding);
  if (!orgId) {
    const adapter = await ensureSendAdapter(msg.channel, null);
    if (adapter) {
      await adapter
        .sendText(
          msg.externalUserId,
          "无法解析所属组织，请先在『设置 / 微信』完成账号与组织绑定。",
        )
        .catch(() => {});
    }
    return;
  }

  // 2. 消息过滤
  if (!passesFilter(msg.content, binding.filterMode as FilterMode, binding.filterKeyword)) {
    return;
  }

  // 3. webhook 幂等：同一 externalMsgId 不重复处理
  if (msg.externalMsgId) {
    const dup = await db.weChatMessage.findFirst({
      where: {
        orgId,
        channel: msg.channel,
        externalMsgId: msg.externalMsgId,
        direction: "inbound",
      },
      select: { id: true },
    });
    if (dup) {
      console.info("[Gateway] duplicate inbound skipped", {
        orgId,
        externalMsgId: msg.externalMsgId,
      });
      return;
    }
  }

  await touchBinding(msg.channel, msg.externalUserId);

  const isVoice = msg.messageType === "voice";
  const isImage = msg.messageType === "image";
  const inboundRow = await db.weChatMessage.create({
    data: {
      bindingId: binding.id,
      userId: binding.userId,
      orgId,
      direction: "inbound",
      channel: msg.channel,
      externalUserId: msg.externalUserId,
      content: isVoice
        ? `🎤 [语音] ${msg.content}`
        : isImage
          ? "📷 [图片]"
          : msg.content,
      messageType: msg.messageType,
      externalMsgId: msg.externalMsgId,
    },
  });

  const {
    getOrCreateAgentSession,
    createAgentRun,
    completeAgentRun,
    failAgentRun,
    appendAgentRunEvent,
    updateAgentRunStatus,
    tryHandleDeterministicCommand,
    buildAckText,
    markAckSent,
    executeConversationRun,
    updateAgentSessionContext,
  } = await import("@/lib/agent-runtime");

  let session;
  try {
    session = await getOrCreateAgentSession({
      orgId,
      userId: binding.userId,
      channel: msg.channel,
      channelUserId: msg.externalUserId,
    });
  } catch (e) {
    console.error("[Gateway] session create failed", {
      orgId,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const { run, reused } = await createAgentRun({
    orgId,
    sessionId: session.id,
    userMessageId: inboundRow.id,
    runType: "conversation",
  });

  // 重复 webhook：Run 已存在则不再 ACK / 不再执行
  if (reused) {
    console.info("[Gateway] duplicate run skipped", { orgId, runId: run.id });
    return;
  }

  const visualizerKey = {
    orgId,
    userId: binding.userId,
    channel: msg.channel,
    externalUserId: msg.externalUserId,
  };

  let aiResponse: string;
  let aiResponseImageUrl: string | undefined;
  let ackSent = false;

  async function sendTextSafe(text: string): Promise<void> {
    const adapter = await ensureSendAdapter(msg.channel, orgId);
    if (!adapter) return;
    try {
      await adapter.sendText(msg.externalUserId, text);
    } catch (e) {
      console.error("[Gateway] send failed", {
        orgId,
        runId: run.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function sendAckIfNeeded(): Promise<void> {
    if (ackSent) return;
    const ackText = buildAckText({
      content: msg.content,
      messageType: msg.messageType,
    });
    try {
      await sendTextSafe(ackText);
      await markAckSent({ orgId, runId: run.id, ackText });
      ackSent = true;
    } catch (e) {
      console.error("[Gateway] ack failed (continue)", {
        orgId,
        runId: run.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 图片 → 可视化（ACK 后处理）
  if (isImage && msg.media) {
    await sendAckIfNeeded();
    const { handleWechatVisualizerImage } = await import(
      "@/lib/visualizer/wechat-visualizer"
    );
    try {
      aiResponse = await handleWechatVisualizerImage(visualizerKey, msg.media);
      await completeAgentRun(orgId, run.id);
    } catch (e) {
      console.error("[Gateway] visualizer image failed:", e);
      aiResponse = "图片处理失败，请稍后重试。";
      await failAgentRun(orgId, run.id, {
        code: "tool_failed",
        message: e instanceof Error ? e.message : "visualizer failed",
      });
    }
    await deliverAndPersist();
    return;
  }

  // 确定性命令：状态 / 取消（不 ACK「正在处理」、不调模型）
  const deterministic = await tryHandleDeterministicCommand({
    orgId,
    sessionId: session.id,
    text: msg.content,
    currentRunId: run.id,
  });
  if (deterministic.handled) {
    aiResponse = deterministic.reply;
    await updateAgentRunStatus(orgId, run.id, "running", {
      intent: "deterministic",
    });
    await completeAgentRun(orgId, run.id);
    await deliverAndPersist();
    return;
  }

  // PendingAction 数字确认 / 取消（明确匹配，不误触发普通「发送」）
  const { handleWeChatPendingReply } = await import(
    "@/lib/ai-grader/actions/wechat-confirm"
  );
  const confirm = await handleWeChatPendingReply(msg.content, {
    userId: binding.userId,
    orgId,
  });
  if (confirm.handled) {
    aiResponse = confirm.reply ?? "已处理。";
    if (/等待|确认|审批/.test(aiResponse)) {
      await updateAgentRunStatus(orgId, run.id, "awaiting_approval");
      await appendAgentRunEvent({
        orgId,
        runId: run.id,
        eventType: "approval.required",
        title: "等待确认",
        visibleToUser: true,
      });
    }
    await completeAgentRun(orgId, run.id);
    await deliverAndPersist();
    return;
  }

  // 微信可视化挂起会话
  const { handleWechatVisualizerReply } = await import(
    "@/lib/visualizer/wechat-visualizer"
  );
  const visualizerReply = await handleWechatVisualizerReply(
    visualizerKey,
    msg.content,
    async (progressText) => {
      await sendTextSafe(progressText);
    },
  );
  if (visualizerReply.handled) {
    aiResponse = visualizerReply.reply ?? "已处理。";
    aiResponseImageUrl = visualizerReply.imageUrl;
    await completeAgentRun(orgId, run.id);
    await deliverAndPersist();
    return;
  }

  // Growth Center 推广日报（确定性，不调 LLM）
  if (/推广日报|营销日报|增长日报/.test(msg.content)) {
    await sendAckIfNeeded();
    aiResponse = await (
      await import("@/lib/marketing/wechat-daily-brief")
    ).buildMarketingDailyBrief(orgId);
    await completeAgentRun(orgId, run.id);
    await deliverAndPersist();
    return;
  }

  // Grader：仅规则意图命中时同步调用（非每条消息）；业务事件见 event-triggers.ts
  const { classifyWechatGraderIntent } = await import(
    "@/lib/ai-grader/wechat-intent-classifier"
  );
  const { readGraderContext } = await import("@/lib/ai-grader/wechat-context");
  const graderContext = await readGraderContext({
    orgId,
    userId: binding.userId,
    channel: msg.channel,
  });
  const intent = classifyWechatGraderIntent(msg.content, {
    context: graderContext,
  });

  const isGraderIntent =
    intent.intent === "DAILY_BRIEF" ||
    intent.intent === "CUSTOMER_FOLLOWUP" ||
    intent.intent === "CHECK_CUSTOMER" ||
    intent.intent === "QUOTE_RISK" ||
    intent.intent === "CHECK_QUOTE" ||
    intent.intent === "PROJECT_HEALTH" ||
    intent.intent === "CHECK_PROJECT";

  if (intent.needsClarification && intent.clarificationMessage) {
    aiResponse = intent.clarificationMessage;
    await completeAgentRun(orgId, run.id);
    await deliverAndPersist();
    return;
  }

  if (isGraderIntent) {
    await sendAckIfNeeded();
    await updateAgentRunStatus(orgId, run.id, "running", {
      intent: intent.intent,
    });
    await appendAgentRunEvent({
      orgId,
      runId: run.id,
      eventType: "grader.started",
      title: `Grader ${intent.intent}`,
      payload: { intent: intent.intent },
      visibleToUser: true,
    });

    const base = {
      userId: binding.userId,
      orgId,
      channel: msg.channel,
      externalUserId: msg.externalUserId,
      agentRunId: run.id,
    };

    try {
      switch (intent.intent) {
        case "DAILY_BRIEF": {
          const m = await import("@/lib/ai-grader/wechat-daily-brief");
          aiResponse = await m.runDailyBriefForWeChat(base);
          break;
        }
        case "CUSTOMER_FOLLOWUP":
        case "CHECK_CUSTOMER": {
          const m = await import("@/lib/ai-grader/wechat-customer-followup");
          aiResponse = await m.runCustomerFollowupForWeChat({
            ...base,
            intent:
              intent.intent === "CHECK_CUSTOMER"
                ? {
                    mode: "CUSTOMER",
                    customerId:
                      intent.targetType === "CUSTOMER"
                        ? intent.targetId
                        : undefined,
                    customerName: intent.targetName,
                  }
                : { mode: "GLOBAL" },
          });
          if (intent.targetType === "CUSTOMER" && intent.targetId) {
            await updateAgentSessionContext({
              orgId,
              sessionId: session.id,
              currentCustomerId: intent.targetId,
            }).catch(() => {});
          }
          break;
        }
        case "QUOTE_RISK":
        case "CHECK_QUOTE": {
          const m = await import("@/lib/ai-grader/wechat-quote-risk");
          aiResponse = await m.runQuoteRiskForWeChat({
            ...base,
            intent:
              intent.intent === "CHECK_QUOTE"
                ? {
                    mode: "QUOTE",
                    quoteId:
                      intent.targetType === "QUOTE"
                        ? intent.targetId
                        : undefined,
                    customerName: intent.targetName,
                  }
                : { mode: "GLOBAL" },
          });
          if (intent.targetType === "QUOTE" && intent.targetId) {
            await updateAgentSessionContext({
              orgId,
              sessionId: session.id,
              currentQuoteId: intent.targetId,
            }).catch(() => {});
          }
          break;
        }
        case "PROJECT_HEALTH":
        case "CHECK_PROJECT": {
          const m = await import("@/lib/ai-grader/wechat-project-health");
          aiResponse = await m.runProjectHealthForWeChat({
            ...base,
            intent:
              intent.intent === "CHECK_PROJECT"
                ? {
                    mode: "PROJECT",
                    projectId:
                      intent.targetType === "PROJECT"
                        ? intent.targetId
                        : undefined,
                    projectName: intent.targetName,
                  }
                : { mode: "GLOBAL" },
          });
          if (intent.targetType === "PROJECT" && intent.targetId) {
            await updateAgentSessionContext({
              orgId,
              sessionId: session.id,
              currentProjectId: intent.targetId,
            }).catch(() => {});
          }
          break;
        }
        default:
          aiResponse = "暂无法处理该请求。";
      }

      await appendAgentRunEvent({
        orgId,
        runId: run.id,
        eventType: "grader.completed",
        title: `Grader ${intent.intent} 完成`,
        visibleToUser: false,
      });
      await completeAgentRun(orgId, run.id);
    } catch (e) {
      console.error("[Gateway] grader failed", {
        orgId,
        runId: run.id,
        intent: intent.intent,
        error: e instanceof Error ? e.message : String(e),
      });
      aiResponse =
        "这个任务没有完成，我已经保留了任务记录。请稍后重试。";
      await failAgentRun(orgId, run.id, {
        code: "tool_failed",
        message: e instanceof Error ? e.message : "grader failed",
      });
    }

    await deliverAndPersist();
    return;
  }

  // 普通 CHAT：ACK → 最小上下文 → 主模型（单次对话引擎）
  await sendAckIfNeeded();
  const userRow = await db.user.findUnique({
    where: { id: binding.userId },
    select: { role: true, name: true },
  });
  try {
    const conv = await executeConversationRun({
      orgId,
      userId: binding.userId,
      userRole: userRow?.role ?? "user",
      userName: userRow?.name ?? null,
      channel: msg.channel,
      channelUserId: msg.externalUserId,
      content: msg.content,
      messageType: msg.messageType,
      session,
      runId: run.id,
    });
    aiResponse = conv.text;
    // 后台任务：立刻踢一脚消费，不专等 cron（失败由 cron 兜底）
    if (conv.backgroundQueued) {
      void import("@/lib/agent-runtime/queue")
        .then((m) => m.processQueuedAgentRuns(1))
        .catch((err) =>
          console.error("[Gateway] kick agent queue failed", err),
        );
    }
  } catch (e) {
    console.error("[Gateway] conversation failed", {
      orgId,
      runId: run.id,
      sessionId: session.id,
      stage: "executeConversationRun",
      error: e instanceof Error ? e.message : String(e),
      retryable: true,
    });
    aiResponse =
      "这个任务没有完成，我已经保留了任务记录。请稍后重试。";
  }

  await deliverAndPersist();
  return;

  async function deliverAndPersist(): Promise<void> {
    // 待确认 / 编号确认类终答附工作台深链；闲聊不加
    try {
      const {
        shouldAttachWorkbenchLink,
        appendWorkbenchLink,
      } = await import("@/lib/agent-runtime/workbench-link");
      const runRow = await db.agentRun.findFirst({
        where: { id: run.id, orgId },
        select: { status: true },
      });
      if (
        shouldAttachWorkbenchLink(aiResponse, {
          runStatus: runRow?.status ?? null,
        })
      ) {
        aiResponse = appendWorkbenchLink(aiResponse, run.id);
      }
    } catch (e) {
      console.error("[Gateway] workbench link append failed", {
        orgId,
        runId: run.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const adapter = await ensureSendAdapter(msg.channel, orgId);
    if (adapter) {
      try {
        await adapter.sendText(msg.externalUserId, aiResponse);
        if (aiResponseImageUrl && typeof adapter.sendImage === "function") {
          await adapter.sendImage(msg.externalUserId, aiResponseImageUrl);
        }
      } catch {
        // 发送失败，记录但不阻塞
      }
    }

    await db.weChatMessage.create({
      data: {
        bindingId: binding!.id,
        userId: binding!.userId,
        orgId,
        direction: "outbound",
        channel: msg.channel,
        externalUserId: msg.externalUserId,
        content: aiResponseImageUrl
          ? `${aiResponse}\n🖼 ${aiResponseImageUrl}`
          : aiResponse,
        messageType: aiResponseImageUrl ? "image" : "text",
        agentProcessed: true,
        agentResponse: aiResponse,
      },
    });

    extractAndIndex(
      binding!.userId,
      orgId,
      msg.content,
      aiResponse,
    ).catch(() => {});
  }
}

/**
 * 给外部联系人（如外贸客户）发送消息。
 *
 * 用于外贸受理回复 / 交付物回传：按客户 org + 通道按需重建 adapter 发送。
 * 注意 iLink 个人微信为被动回复：仅在客户近期发过消息（context_token 仍有效，
 * 通常是仍在内存中的 polling adapter）时可达；否则会发送失败并返回 ok=false。
 */
export async function sendToExternalUser(opts: {
  channel: ChannelType;
  orgId: string;
  to: string;
  text?: string;
  imageUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const adapter = await ensureSendAdapter(opts.channel, opts.orgId);
  if (!adapter) return { ok: false, error: "通道未登录或不可用" };
  try {
    const canSendImage = opts.imageUrl && typeof adapter.sendImage === "function";
    // 习惯：先发文字说明，再发图片（iLink 推荐做法，兼容性更好）
    let text = opts.text;
    if (opts.imageUrl && !canSendImage) {
      // 通道不支持图片，把图片链接并入文本
      text = text ? `${text}\n图片：${opts.imageUrl}` : `图片：${opts.imageUrl}`;
    }
    if (text) {
      await adapter.sendText(opts.to, text);
    }
    if (canSendImage) {
      await adapter.sendImage!(opts.to, opts.imageUrl!);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @deprecated Phase-1 起由 executeConversationRun 承接；保留导出以免外部引用断裂。
 */
export async function processWithAgentCore(
  userId: string,
  msg: InboundMessage,
  bindingOrgId: string | null,
): Promise<string> {
  const { getOrCreateAgentSession, createAgentRun, executeConversationRun } =
    await import("@/lib/agent-runtime");
  const orgId =
    bindingOrgId ||
    (
      await db.organizationMember.findFirst({
        where: { userId, status: "active" },
        select: { orgId: true },
      })
    )?.orgId;
  if (!orgId) {
    throw new Error(
      "无法解析所属组织，请先在『设置 / 微信』完成账号与组织绑定后重试。",
    );
  }
  const session = await getOrCreateAgentSession({
    orgId,
    userId,
    channel: msg.channel,
    channelUserId: msg.externalUserId,
  });
  const { run } = await createAgentRun({
    orgId,
    sessionId: session.id,
    runType: "conversation",
  });
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, name: true },
  });
  const conv = await executeConversationRun({
    orgId,
    userId,
    userRole: user?.role ?? "user",
    userName: user?.name ?? null,
    channel: msg.channel,
    channelUserId: msg.externalUserId,
    content: msg.content,
    messageType: msg.messageType,
    session,
    runId: run.id,
  });
  return conv.text;
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

    const adapter = await ensureSendAdapter(
      binding.channel as ChannelType,
      binding.orgId,
    );
    if (!adapter) {
      failed++;
      continue;
    }

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
  orgId: string,
  userMsg: string,
  aiReply: string,
): Promise<void> {
  if (!orgId) return;
  const { extractMemoriesFromConversation, saveMemories } = await import(
    "@/lib/ai/user-memory"
  );

  const extracted = extractMemoriesFromConversation(userMsg, aiReply);
  if (extracted.length > 0) {
    await saveMemories(
      userId,
      orgId,
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
