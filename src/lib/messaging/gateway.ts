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

  if (!orgId) return null;

  if (channel === "personal_wechat") {
    const { PersonalWeChatAdapter } = await import("./adapters/personal-wechat");
    const adapter = new PersonalWeChatAdapter(orgId);
    const ok = await adapter.loadCredentials();
    return ok ? adapter : null;
  }

  if (channel === "wecom") {
    const { WeComAdapter } = await import("./adapters/wecom");
    const adapter = new WeComAdapter(orgId);
    await adapter.start();
    return adapter.getStatus() === "connected" ? adapter : null;
  }

  return null;
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
 */
export async function handleInboundMessage(msg: InboundMessage): Promise<void> {
  // 1. 查找绑定
  const binding = await findBindingByExternal(msg.channel, msg.externalUserId);
  if (!binding || binding.status !== "active") {
    // 未绑定 = 外部客户 → 进客服收件箱（不回复、不进 AI 链路；群消息跳过）
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

  // 2. 消息过滤
  if (!passesFilter(msg.content, binding.filterMode as FilterMode, binding.filterKeyword)) {
    return;
  }

  // 3. 更新活跃时间
  await touchBinding(msg.channel, msg.externalUserId);

  // 4. 持久化入站消息（语音消息标记来源；写入 binding.orgId 保证租户隔离）
  const isVoice = msg.messageType === "voice";
  const isImage = msg.messageType === "image";
  await db.weChatMessage.create({
    data: {
      bindingId: binding.id,
      userId: binding.userId,
      orgId: binding.orgId,
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

  const visualizerKey = {
    orgId: binding.orgId,
    userId: binding.userId,
    channel: msg.channel,
    externalUserId: msg.externalUserId,
  };

  // 4.5 图片消息 → 微信可视化（检测窗户，等待 SKU），不进入文字 AI 链路
  let aiResponse: string;
  let aiResponseImageUrl: string | undefined;
  if (isImage && msg.media) {
    const { handleWechatVisualizerImage } = await import(
      "@/lib/visualizer/wechat-visualizer"
    );
    try {
      aiResponse = await handleWechatVisualizerImage(visualizerKey, msg.media);
    } catch (e) {
      console.error("[Gateway] visualizer image failed:", e);
      aiResponse = "图片处理失败，请稍后重试。";
    }
    await deliverAndPersist();
    return;
  }

  // 5. 优先尝试「数字回复确认」：用户回复 1/2/3 或「取消」时，直接走 PendingAction 审批链路，
  //    命中则不再进入常规 AI 链路（避免把确认编号当普通问题回答）。
  const { handleWeChatPendingReply } = await import(
    "@/lib/ai-grader/actions/wechat-confirm"
  );
  const confirm = await handleWeChatPendingReply(msg.content, {
    userId: binding.userId,
    orgId: binding.orgId,
  });
  if (confirm.handled) {
    aiResponse = confirm.reply ?? "已处理。";
  } else {
    // 5.5 微信可视化挂起会话：等待 SKU 时优先解析（取消 / SKU / 产品名），
    //     命中即生成效果图；普通聊天文字不命中，继续走下方链路。
    const { handleWechatVisualizerReply } = await import(
      "@/lib/visualizer/wechat-visualizer"
    );
    const visualizerReply = await handleWechatVisualizerReply(
      visualizerKey,
      msg.content,
      async (progressText) => {
        const adapter = await ensureSendAdapter(msg.channel, binding.orgId);
        if (adapter) await adapter.sendText(msg.externalUserId, progressText);
      },
    );
    if (visualizerReply.handled) {
      aiResponse = visualizerReply.reply ?? "已处理。";
      aiResponseImageUrl = visualizerReply.imageUrl;
      await deliverAndPersist();
      return;
    }

    // 6. 统一 Grader 意图分类器（确定性规则；命中即不进入普通 chat）
    //    优先级：项目 > 报价 > 客户 > 今日体检 > 普通 AI
    const { classifyWechatGraderIntent } = await import(
      "@/lib/ai-grader/wechat-intent-classifier"
    );
    // 读取该用户的短期 Grader 上下文（30 分钟内、同 org/user/channel），
    // 让「这个客户/项目/报价/他/刚刚那个」能解析到最近一次目标对象。
    const { readGraderContext } = await import("@/lib/ai-grader/wechat-context");
    const graderContext = await readGraderContext({
      orgId: binding.orgId,
      userId: binding.userId,
      channel: msg.channel,
    });
    const intent = classifyWechatGraderIntent(msg.content, { context: graderContext });

    if (intent.needsClarification && intent.clarificationMessage) {
      // 「这个项目/报价/客户」缺上下文 → 直接澄清，不乱猜
      aiResponse = intent.clarificationMessage;
    } else {
      const base = {
        userId: binding.userId,
        orgId: binding.orgId,
        channel: msg.channel,
        externalUserId: msg.externalUserId,
      };
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
                    customerId: intent.targetType === "CUSTOMER" ? intent.targetId : undefined,
                    customerName: intent.targetName,
                  }
                : { mode: "GLOBAL" },
          });
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
                    quoteId: intent.targetType === "QUOTE" ? intent.targetId : undefined,
                    customerName: intent.targetName,
                  }
                : { mode: "GLOBAL" },
          });
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
                    projectId: intent.targetType === "PROJECT" ? intent.targetId : undefined,
                    projectName: intent.targetName,
                  }
                : { mode: "GLOBAL" },
          });
          break;
        }
        default: {
          // CONFIRM/CANCEL（数字与取消已在第 5 步处理）/ CHAT → 普通 AI
          try {
            aiResponse = await processWithAgentCore(binding.userId, msg, binding.orgId);
          } catch (e) {
            aiResponse = `抱歉，处理出错: ${e instanceof Error ? e.message : "未知错误"}`;
          }
        }
      }
    }
  }

  await deliverAndPersist();
  return;

  // ── 步骤 6–8：发送回复（文字 + 可选图片）→ 持久化 → 记忆索引 ──
  async function deliverAndPersist(): Promise<void> {
    const adapter = await ensureSendAdapter(msg.channel, binding!.orgId);
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

    extractAndIndex(binding!.userId, binding!.id, msg.content, aiResponse).catch(
      () => {},
    );
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

async function processWithAgentCore(
  userId: string,
  msg: InboundMessage,
  bindingOrgId: string | null,
): Promise<string> {
  const { runAgent } = await import("@/lib/agent-core");
  const {
    getWakeUpMemories,
    recallMemories,
    buildUserMemoryBlock,
  } = await import("@/lib/ai/user-memory");

  // 加载最近对话上下文
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

  // 加载用户信息 + 角色
  // orgId 解析优先级：binding.orgId → 用户活跃组织（唯一）。禁止 default 兜底，
  // 解析不到组织直接拒绝处理，避免跨租户数据串入 default 桶。
  const [membership, user] = await Promise.all([
    bindingOrgId
      ? Promise.resolve({ orgId: bindingOrgId })
      : db.organizationMember.findFirst({
          where: { userId, status: "active" },
          select: { orgId: true },
        }),
    db.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true },
    }),
  ]);
  const orgId = membership?.orgId ?? null;
  if (!orgId) {
    throw new Error("无法解析所属组织，请先在『设置 / 微信』完成账号与组织绑定后重试。");
  }
  const userRole = user?.role ?? "user";

  const [wakeUp, l2] = await Promise.all([
    getWakeUpMemories(userId),
    recallMemories(userId, msg.content, { limit: 3 }),
  ]);
  const memoryBlock = buildUserMemoryBlock(wakeUp.l0, wakeUp.l1, l2);

    // 根据角色构建可用域
    const domains: Array<"trade" | "sales" | "project" | "secretary" | "knowledge" | "cockpit" | "system"> = ["secretary", "system"];
  if (userRole === "admin" || userRole === "super_admin") {
    domains.push("trade", "sales", "cockpit");
  } else if (userRole === "sales") {
    domains.push("sales");
  } else if (userRole === "trade") {
    domains.push("trade");
  }

  const isVoice = msg.messageType === "voice";

  const systemPrompt = `你是「青砚」AI 工作助理，正在通过微信与用户 ${user?.name || ""} 对话。
用户角色：${userRole}
${isVoice ? "⚠️ 这条消息是语音转写的，可能存在识别误差，请结合上下文理解用户意图。\n" : ""}
规则：
- 用简洁中文回复，适合手机阅读（短句、分行）
- 如果需要数据，直接调用工具查询，不要凭空编造
- 给出具体可执行的建议
- 当用户说"发"、"确认"、"好的"时，执行对应操作
- 复杂内容用数字列表，方便用户回复数字选择
- 操作完成后，用简短确认告知用户结果

邮件流程（重要！）：
1. 用户说"给XXX发邮件/跟进/发报价" → 先调用 sales.compose_email 生成预览
2. 将预览内容展示给用户：收件人、主题、正文摘要
3. 询问用户"确认发送？或告诉我怎么修改"
4. 用户说"发/确认/好的" → 调用 sales.send_quote_email 发送
5. 用户说"改一下/更热情/加折扣" → 调用 sales.refine_email 修改后再次展示
6. 反复修改直到用户满意，就像用 ChatGPT 一样自然

知识库与 AI 辅助（重要！）：
- 用户问"客户嫌贵怎么回"、"之前类似案例怎么成交" → 调用 sales.search_knowledge 搜索知识库
- 用户问"XXX 这个客户怎么跟"、"给我分析一下 XXX" → 调用 sales.get_coaching 获取 AI 建议
- 用户问"XXX 的 deal 怎么样"、"健康度多少" → 调用 sales.get_deal_health
- 当你给出建议时，主动搜索知识库找相似赢单模式，用数据支撑你的建议
- 给出具体建议后 → 调用 sales.record_coaching 记录建议（系统会在成单后自动学习效果）
- 用户说"好的用这个"、"试试看" → 调用 sales.coaching_feedback(adopted=true)
- 用户说"不合适"、"换一个" → 调用 sales.coaching_feedback(adopted=false)

其他操作：
- "查一下 XXX 的报价" → 调用 sales.get_customer_quotes
- "帮 XXX 预约安装" → 调用 sales.create_appointment（现场量房已下线，统一走『电子报价单』，不要预约 measure 类型）
- "把 XXX 推进到已签单" → 调用 sales.advance_stage
- "今天有多少活跃机会" → 调用 sales.get_overview
${memoryBlock}`;

  const messages = [
    ...history.slice(-8),
    { role: "user" as const, content: msg.content },
  ];

  const result = await runAgent({
    systemPrompt,
    messages,
    domains,
    mode: "chat",
    temperature: 0.3,
    userId,
    orgId,
    maxToolRounds: 5,
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
