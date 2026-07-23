import { after, NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  isAIConfigured,
  createChatStream,
  getChatSystemPrompt,
  buildContextBlock,
  buildProjectDeepBlock,
  getWorkContext,
  getProjectDeepContext,
  matchProjectByName,
  prepareConversation,
  buildSummaryPrefix,
  extractWorkSuggestion,
  getProjectAiMemory,
  buildMemoryBlock,
  getSalesContext,
  buildSalesContextBlock,
  getWakeUpMemories,
  recallMemories,
  buildUserMemoryBlock,
  extractMemoriesFromConversation,
  saveMemories,
  type ChatMessage,
} from "@/lib/ai";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { recordAiCall, extractUsage } from "@/lib/ai/monitor";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { isOperatorEnabled } from "@/lib/feature-flags";
import {
  runAgentStream,
  needsTools,
  mentionsCalendar,
  requestsCalendarWrite,
  classifyLongRunningMarketingResearch,
} from "@/lib/agent-core";
import { buildOperatorSystemPrompt } from "@/lib/agent-core/prompts/operator-system";
import { getCapabilities } from "@/lib/rbac/capabilities";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { buildCompanyBlock } from "@/lib/ai/company-context";
import {
  executeMarketResearchRun,
  queueMarketResearchRequest,
} from "@/lib/market-intelligence/research-runtime";
import { resolveAgentTenant } from "@/lib/tenancy/resolve-agent-tenant";
import { loadQuoteAutoSendRule } from "@/lib/org-rules/service";
import { getRequestContext } from "@/lib/common/request-context";
import {
  requireStreamTenant,
  beginStreamAiUsage,
  buildStreamSessionKey,
  settleAiUsageReservation,
  actualCostFromStreamUsage,
} from "@/lib/capabilities/governance";
import {
  findOwnedThreadInOrg,
  resolveAssistantOrgId,
  threadNotFoundResponse,
} from "@/lib/assistant/thread-org";

// 普通对话仍使用 Agent 自身的短超时；只有前置分流的深度研究使用后台预算。
export const maxDuration = 300;

const AI_THREAD_RATE_LIMIT = {
  name: "ai-thread-messages",
  windowMs: 60_000,
  maxRequests: 30,
} as const;

export const GET = withAuth(async (request, ctx, user) => {
  const { threadId } = await ctx.params;
  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const thread = await findOwnedThreadInOrg(threadId, user.id, orgRes.orgId, {
    id: true,
  });
  if (!thread) return threadNotFoundResponse();

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");
  const take = 60;

  const messages = await db.aiMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      role: true,
      content: true,
      workSuggestion: true,
      createdAt: true,
    },
  });

  // PR4 回看：仅附带同 org + 同 thread 的 PendingAction
  const messageIds = messages.map((m) => m.id);
  const pendingActions =
    messageIds.length > 0
      ? await db.pendingAction.findMany({
          where: {
            createdById: user.id,
            threadId,
            orgId: orgRes.orgId,
            messageId: { in: messageIds },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            title: true,
            preview: true,
            status: true,
            messageId: true,
            expiresAt: true,
            failureReason: true,
            resultRef: true,
          },
        })
      : [];

  const actionsByMessage = new Map<string, typeof pendingActions>();
  for (const a of pendingActions) {
    if (!a.messageId) continue;
    const bucket = actionsByMessage.get(a.messageId) ?? [];
    bucket.push(a);
    actionsByMessage.set(a.messageId, bucket);
  }

  const messagesWithActions = messages.map((m) => ({
    ...m,
    pendingActions: actionsByMessage.get(m.id) ?? [],
  }));

  return NextResponse.json({
    messages: messagesWithActions,
    hasMore: messages.length === take,
    nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
  });
});

export const POST = withAuth(async (request, ctx, user) => {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "未配置 AI API 密钥" },
      { status: 500 }
    );
  }

  const { threadId } = await ctx.params;

  const body = await request.json();
  const claimedBodyOrgId =
    typeof body.orgId === "string" ? body.orgId.trim() : null;
  const orgRes = await resolveAssistantOrgId(request, user, claimedBodyOrgId);
  if (!orgRes.ok) return orgRes.response;

  const thread = await findOwnedThreadInOrg(threadId, user.id, orgRes.orgId, {
    id: true,
    userId: true,
    orgId: true,
    projectId: true,
    title: true,
    project: { select: { orgId: true } },
  });
  if (!thread) return threadNotFoundResponse();

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "消息过长" }, { status: 400 });
  }

  // Phase 3A-5：流开始前强制可信租户；须与线程 orgId 一致
  const streamTenant = await requireStreamTenant(request, {
    claimedBodyOrgId,
  });
  if (streamTenant instanceof NextResponse) return streamTenant;
  if (
    streamTenant.orgId !== orgRes.orgId ||
    (thread.orgId && thread.orgId !== streamTenant.orgId)
  ) {
    return NextResponse.json(
      {
        error: "请求组织与对话所属组织不一致",
        code: "ORG_CONTEXT_MISMATCH",
      },
      { status: 403 },
    );
  }

  const rl = await checkRateLimitAsync(
    AI_THREAD_RATE_LIMIT,
    `${streamTenant.orgId}:${user.id}`,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const reqCtx = getRequestContext();
  const streamSessionKey = buildStreamSessionKey({
    orgId: streamTenant.orgId,
    userId: user.id,
    requestId: reqCtx?.requestId,
    threadId,
  });

  const fileText = typeof body.fileText === "string" ? body.fileText : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";

  const { parseAssistantMode } = await import("@/lib/ai/assistant-modes");
  const assistantMode = parseAssistantMode(body.assistantMode);

  // Operator 工具必须有明确组织上下文。项目对话优先使用项目所属组织，
  // 普通对话使用客户端当前组织；在写入用户消息前校验，避免失败请求留下重复历史。
  const requestedMarketingSkill = content
    .toLowerCase()
    .includes("qingyan-marketing-analysis");
  const longMarketingResearch = classifyLongRunningMarketingResearch(content);
  const requestedCalendarAction = requestsCalendarWrite(content);
  // 项目内显式选了助手模式 → 强制 Operator（否则 fast/expert 无效）
  const useOperator =
    Boolean(assistantMode) ||
    requestedMarketingSkill ||
    Boolean(longMarketingResearch) ||
    requestedCalendarAction ||
    isOperatorEnabled({ userId: user.id, role: user.role });
  const requestedOrgId =
    (typeof body.orgId === "string" ? body.orgId.trim() : "") ||
    thread.project?.orgId ||
    null;
  let operatorOrgId: string | null = null;
  if (useOperator) {
    const orgRes = await resolveRequestOrgIdForUser(user, requestedOrgId);
    if (!orgRes.ok) return orgRes.response;
    operatorOrgId = orgRes.orgId;
  }

  if (longMarketingResearch) {
    const run = await queueMarketResearchRequest({
      orgId: operatorOrgId!,
      userId: user.id,
      objective: content,
      outputType: longMarketingResearch.outputType,
      marketEvidence: fileText
        ? `用户上传文件：${fileName || "未命名文件"}\n${fileText.slice(0, 80_000)}`
        : undefined,
    });
    after(async () => {
      await executeMarketResearchRun(run.id);
    });

    const assistantContent = [
      "已将这项工作转为后台深度研究，不需要继续停留在当前页面。",
      "",
      `- 任务编号：${run.id}`,
      "- 当前状态：等待研究",
      "- 最长单次执行：300 秒；如遇模型超时会自动重试",
      "- 完成后：站内通知，并在已绑定微信或企业微信时同步提醒",
      "",
      "报告会保存在“运营市场部 → 市场情报”中。",
    ].join("\n");

    await db.$transaction([
      db.aiMessage.create({
        data: { threadId, role: "user", content },
      }),
      db.aiMessage.create({
        data: { threadId, role: "assistant", content: assistantContent },
      }),
      db.aiThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          ...(thread.title === "新对话" ? { title: content.slice(0, 60) } : {}),
        },
      }),
    ]);

    return createImmediateAssistantStream(assistantContent, {
      mode: "market_research.background",
      runId: run.id,
      status: run.status,
    });
  }

  await db.aiMessage.create({
    data: { threadId, role: "user", content },
  });

  const history = await db.aiMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const chatMessages: ChatMessage[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const isFirstMessage = history.length === 1;

  // ─── PR2：Operator 分支（灰度控制，只开只读工具）───
  // 显式技能和个人日历草稿不受 Operator 灰度影响；两者都有独立执行边界，
  // 日历写入还必须经过当前用户确认。
  if (useOperator) {
    // 可信 org 以 streamTenant 为准；与 operator 解析结果不一致则拒绝
    if (operatorOrgId && operatorOrgId !== streamTenant.orgId) {
      return NextResponse.json(
        {
          error: "请求组织与当前工作组织不一致",
          code: "ORG_CONTEXT_MISMATCH",
        },
        { status: 403 },
      );
    }
    return handleOperatorBranch({
      threadId,
      threadTitle: thread.title,
      isFirstMessage,
      user,
      orgId: streamTenant.orgId,
      streamSessionKey,
      userContent: content,
      chatMessages,
      abortSignal: request.signal,
      projectId: thread.projectId ?? null,
      assistantMode,
    });
  }
  // ─── 以下为 legacy 分支 ───

  // 公司画像：orgId best-effort 解析（失败不阻塞对话，只是少一块品牌背景）
  let legacyOrgId: string | null = null;
  try {
    const orgRes = await resolveRequestOrgIdForUser(user, requestedOrgId);
    if (orgRes.ok) legacyOrgId = orgRes.orgId;
  } catch {
    // ignore
  }

  const [workContext, prepared, wakeUp, companyBlock] = await Promise.all([
    getWorkContext(user.id, user.role),
    prepareConversation(chatMessages),
    legacyOrgId
      ? getWakeUpMemories(user.id, legacyOrgId)
      : Promise.resolve({ l0: [], l1: [] }),
    buildCompanyBlock(user.id, legacyOrgId),
  ]);

  let deepBlock = "";
  let memoryBlock = "";
  const resolvedProjectId =
    thread.projectId ??
    matchProjectByName(content, workContext.projects)?.id ??
    null;

  if (resolvedProjectId) {
    const [deep, memory, projectCtx] = await Promise.all([
      getProjectDeepContext(resolvedProjectId),
      getProjectAiMemory(resolvedProjectId),
      import("@/lib/projects/project-ai-context").then((m) =>
        m.buildProjectAiContextBlock(resolvedProjectId),
      ),
    ]);
    if (deep) deepBlock = buildProjectDeepBlock(deep);
    if (projectCtx) {
      deepBlock = `${deepBlock}\n\n## 项目工作台上下文（自动注入，勿要求用户重复提供）\n${projectCtx}`;
    }
    memoryBlock = buildMemoryBlock(memory);
  }

  const l2Memories = legacyOrgId
    ? await recallMemories(user.id, legacyOrgId, content, {
        customerId: undefined,
        projectId: resolvedProjectId ?? undefined,
        limit: 5,
      })
    : [];
  const userMemoryBlock = buildUserMemoryBlock(wakeUp.l0, wakeUp.l1, l2Memories);

  const fileBlock = fileText
    ? `\n\n<uploaded_document filename="${fileName}">\n${fileText.slice(0, 120000)}\n</uploaded_document>\n\n请基于上述文档内容回答用户问题。使用 Markdown 格式输出（表格、标题、列表、粗体等）。`
    : "";

  const TENDER_KEYWORDS = [
    "标书", "招标", "投标", "tender", "bid", "rfp", "rfq",
    "采购", "procurement", "solicitation", "addendum",
    "中标", "报价策略", "评分", "specification",
  ];
  const SALES_KEYWORDS = [
    "客户", "报价", "跟进", "销售", "成交", "询盘", "pipeline",
    "follow up", "follow-up", "quote", "客户管理", "机会",
    "安装", "测量", "订单", "窗帘", "百叶", "blinds", "shutter",
    "邮件草稿", "draft email", "回复客户",
    "微信", "wechat", "小红书", "xiaohongshu", "facebook", "话术",
  ];
  const combinedText = (content + " " + fileName).toLowerCase();
  const isTenderContext = fileText && TENDER_KEYWORDS.some((kw) => combinedText.includes(kw));
  const isSalesContext = SALES_KEYWORDS.some((kw) => combinedText.includes(kw));

  let expertBlock = "";
  let salesBlock = "";
  let effectiveMode = prepared.mode;

  if (isTenderContext) {
    const tenderPrompt = getExpertSystemPrompt("bid_analyst");
    if (tenderPrompt) {
      expertBlock = `\n\n## 专家角色激活：投标策略分析专家\n${tenderPrompt}\n`;
      effectiveMode = "deep";
    }
  } else if (isSalesContext) {
    const salesPrompt = getExpertSystemPrompt("sales_advisor");
    if (salesPrompt) {
      expertBlock = `\n\n## 专家角色激活：销售顾问\n${salesPrompt}\n`;
    }
    try {
      const salesCtx = await getSalesContext(user.id);
      salesBlock = buildSalesContextBlock(salesCtx);
    } catch {
      // sales context is best-effort
    }
  }

  if (fileText && !isTenderContext) {
    effectiveMode = "deep";
  }

  const systemPrompt =
    getChatSystemPrompt(user.role) +
    companyBlock +
    expertBlock +
    buildContextBlock(workContext) +
    deepBlock +
    memoryBlock +
    userMemoryBlock +
    salesBlock +
    fileBlock +
    buildSummaryPrefix(prepared.summarizedContext);

  const legacyBudget = await beginStreamAiUsage({
    orgId: streamTenant.orgId,
    userId: user.id,
    sessionKey: `${streamSessionKey}:legacy`,
  });
  if (!legacyBudget.ok) {
    return NextResponse.json(
      { error: legacyBudget.message, code: legacyBudget.code },
      { status: 403 },
    );
  }

  const stream = await createChatStream({
    systemPrompt,
    messages: prepared.messages,
    mode: effectiveMode,
    signal: request.signal,
    orgId: streamTenant.orgId,
    userId: user.id,
    skipInnerPrecheck: true,
  });

  const encoder = new TextEncoder();
  let fullText = "";
  const streamStartedAt = Date.now();
  const legacyModelTag = `thread-${effectiveMode ?? "chat"}`;

  const readable = new ReadableStream({
    async start(controller) {
      let lastChunk: unknown = null;
      let settled = false;
      const settleLegacy = async (usage: {
        promptTokens?: number;
        completionTokens?: number;
      }, success: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        const actualCost =
          success && (usage.promptTokens || usage.completionTokens)
            ? actualCostFromStreamUsage({
                model: legacyModelTag,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
              })
            : 0;
        await settleAiUsageReservation({
          reservationId: legacyBudget.reservationId,
          orgId: streamTenant.orgId,
          userId: user.id,
          idempotencyKey: `stream-settle:${streamSessionKey}:legacy`,
          actualCost,
          model: legacyModelTag,
          inputTokens: usage.promptTokens ?? null,
          outputTokens: usage.completionTokens ?? null,
          success,
          hadBillableUsage: actualCost > 0,
          errorCode: error?.slice(0, 120) ?? null,
        });
      };
      try {
        for await (const chunk of stream) {
          lastChunk = chunk;
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ content: delta })}\n\n`
              )
            );
          }
        }

        const usage = extractUsage(lastChunk);
        recordAiCall({
          model: legacyModelTag,
          success: true,
          elapsedMs: Date.now() - streamStartedAt,
          source: "ai-thread-stream",
          userId: user.id,
          ...usage,
        });
        await settleLegacy(usage, true);

        const { cleanText, suggestion, parseError } = extractWorkSuggestion(fullText);
        const finalContent = parseError
          ? `${cleanText}\n\n> [AI 建议解析异常] ${parseError.reason}`
          : cleanText;

        await db.$transaction([
          db.aiMessage.create({
            data: {
              threadId,
              role: "assistant",
              content: finalContent,
              workSuggestion: suggestion ? (suggestion as object) : undefined,
            },
          }),
          db.aiThread.update({
            where: { id: threadId },
            data: {
              lastMessageAt: new Date(),
              ...(isFirstMessage && thread.title === "新对话"
                ? { title: content.slice(0, 60) }
                : {}),
            },
          }),
        ]);

        extractAndSaveMemories(
          user.id,
          legacyOrgId,
          content,
          cleanText,
          threadId,
        ).catch(() => {});

        if (resolvedProjectId) {
          import("@/lib/projects/insight-extract")
            .then((m) =>
              m.extractInsightsFromAssistantReply({
                projectId: resolvedProjectId,
                orgId: legacyOrgId,
                assistantText: cleanText,
              }),
            )
            .catch(() => {});
        }

        indexThreadMessages(user.id, threadId).catch(() => {});

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "AI 服务调用失败";
        const usage = extractUsage(lastChunk);
        await settleLegacy(usage, false, message);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: message })}\n\n`
          )
        );
        controller.close();
      }
    },
    async cancel() {
      await settleAiUsageReservation({
        reservationId: legacyBudget.reservationId,
        orgId: streamTenant.orgId,
        userId: user.id,
        idempotencyKey: `stream-settle:${streamSessionKey}:legacy`,
        actualCost: 0,
        success: false,
        hadBillableUsage: false,
        errorCode: "client_abort",
      });
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Org-Id": streamTenant.orgId,
    },
  });
});

function createImmediateAssistantStream(
  content: string,
  meta: Record<string, unknown>,
): NextResponse {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "mode", ...meta })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "text", content })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "done", ...meta, latencyMs: 0 })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function indexThreadMessages(userId: string, threadId: string) {
  const { indexAiThreadMessages } = await import("@/lib/context/search-engine");
  await indexAiThreadMessages(userId, threadId);
}

/** PR4：识别工具结果里是否带 pending_approval 草稿 */
function detectPendingApproval(data: unknown): {
  actionId: string;
  type: string;
  title: string;
  preview: string;
} | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.status !== "pending_approval") return null;
  const actionId = typeof d.actionId === "string" ? d.actionId : null;
  const type = typeof d.type === "string" ? d.type : null;
  const title = typeof d.title === "string" ? d.title : null;
  const preview = typeof d.preview === "string" ? d.preview : null;
  if (!actionId || !type || !title || !preview) return null;
  return { actionId, type, title, preview };
}

// ─────────────────────────────────────────────────────────────
// PR3 — Operator 分支（真正的流式 + 工具可感知 + 免工具直答）
// ─────────────────────────────────────────────────────────────

interface OperatorBranchInput {
  threadId: string;
  threadTitle: string | null;
  isFirstMessage: boolean;
  user: { id: string; role: string; name: string };
  orgId: string;
  /** Phase 3A-5 流式会话键（含 orgId） */
  streamSessionKey: string;
  userContent: string;
  chatMessages: ChatMessage[];
  abortSignal: AbortSignal;
  projectId: string | null;
  assistantMode?: import("@/lib/ai/assistant-modes").AssistantMode | null;
}

async function handleOperatorBranch(input: OperatorBranchInput): Promise<NextResponse> {
  const {
    threadId,
    threadTitle,
    isFirstMessage,
    user,
    orgId,
    streamSessionKey,
    userContent,
    chatMessages,
    abortSignal,
    projectId,
    assistantMode = null,
  } = input;

  const {
    needsProjectTools,
    buildProjectExpertSystemAddon,
  } = await import("@/lib/ai/assistant-modes");

  const tenant = await resolveAgentTenant(user, orgId);
  if ("error" in tenant) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  if (!tenant.hasMembership) {
    return NextResponse.json(
      { error: "无企业成员身份，不能调用企业 Agent 工具" },
      { status: 403 },
    );
  }
  const autoSend = await loadQuoteAutoSendRule(orgId);
  const maxRisk = autoSend.value.allowDirectSend
    ? autoSend.value.sessionMaxRisk
    : "l2_soft";

  const caps = getCapabilities(user.role);
  let systemPrompt = buildOperatorSystemPrompt({
    role: user.role,
    userName: user.name,
  });

  if (projectId) {
    try {
      const { buildProjectAiContextBlock } = await import(
        "@/lib/projects/project-ai-context"
      );
      const ctx = await buildProjectAiContextBlock(projectId, {
        light: assistantMode === "fast",
      });
      if (ctx) {
        systemPrompt += `\n\n## 项目工作台上下文（自动注入）\n${ctx}`;
      }
    } catch {
      /* ignore */
    }
    if (assistantMode === "project_expert") {
      systemPrompt += buildProjectExpertSystemAddon(projectId);
    }
  }

  // 分流：fast 强制直答；expert 强制工具；agent 按关键词（含项目意图）
  // 日历写入/日程意图必须挂工具，否则模型会误称「本会话没有可用的日历创建工具」
  const calendarWrite = requestsCalendarWrite(userContent);
  const calendarMention = mentionsCalendar(userContent);
  let withTools = needsTools(userContent) || calendarWrite || calendarMention;
  if (assistantMode === "fast" && !calendarWrite && !calendarMention) {
    withTools = false;
  } else if (assistantMode === "project_expert") {
    withTools = true;
  } else if (projectId && needsProjectTools(userContent)) {
    withTools = true;
  }
  if (calendarWrite || calendarMention) withTools = true;

  const domains = new Set<string>(caps.aiDomains);
  if (projectId && assistantMode !== "fast") {
    domains.add("project");
  }
  // 个人日历工具挂在 secretary 域；任意角色都要能创建草稿（仍需本人审批）
  if (calendarWrite || calendarMention) {
    domains.add("secretary");
  }

  const taskMode = assistantMode === "fast" ? "fast" : "chat";
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const readable = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      let fullText = "";
      let firstTokenMs: number | undefined;
      let rounds = 0;
      let toolCalls = 0;
      let model = "";
      let hadError = false;
      // PR4 回看：本次流中生成的待审批 actionId，稍后回填 messageId
      const createdActionIds: string[] = [];

      try {
        // 发个 mode 心跳，前端可选读取
        emit({
          type: "mode",
          mode: withTools ? "operator.tools" : "operator.direct",
          assistantMode: assistantMode ?? "auto",
        });

        if (withTools) {
          // ── 走完整 agent 流程 ──
          // PR4：maxRisk=l2_soft 把 l3_strong（如 send_quote_email 直发）挡在外面，
          // 强制所有不可逆动作先过 PendingAction 审批流。
          for await (const ev of runAgentStream({
            systemPrompt,
            messages: chatMessages,
            mode: taskMode,
            userId: user.id,
            orgId,
            sessionId: threadId,
            role: user.role,
            orgRole: tenant.orgRole,
            hasMembership: tenant.hasMembership,
            modulesJson: tenant.modulesJson,
            workspaceIds: tenant.workspaceIds,
            toolPolicy: tenant.toolPolicy,
            domains: Array.from(domains) as (typeof caps.aiDomains)[number][],
            maxRisk,
            abortSignal,
          })) {
            if (ev.type === "text") {
              fullText += ev.delta;
              emit({ type: "text", content: ev.delta });
            } else if (ev.type === "tool_start") {
              emit({ type: "tool_start", name: ev.name, label: ev.label });
            } else if (ev.type === "tool_result") {
              emit({ type: "tool_result", name: ev.name, ok: ev.ok });
              // PR4：若工具返回 pending_approval，额外推一个 approval_required
              // 前端收到后在消息下方渲染审批卡片
              const approval = detectPendingApproval(ev.data);
              if (approval) {
                createdActionIds.push(approval.actionId);
                emit({
                  type: "approval_required",
                  actionId: approval.actionId,
                  draftType: approval.type,
                  title: approval.title,
                  preview: approval.preview,
                });
              }
            } else if (ev.type === "done") {
              firstTokenMs = ev.firstTokenMs;
              rounds = ev.rounds;
              toolCalls = ev.toolCalls;
              model = ev.model;
            } else if (ev.type === "error") {
              hadError = true;
              emit({ type: "error", error: ev.message });
            }
          }
        } else {
          // ── 免工具直答：最小 operator prompt + 原始对话 ──
          // 只带最近 20 条消息，避免过长
          const recent = chatMessages.slice(
            assistantMode === "fast" ? -12 : -20
          );
          // 直答模式未挂工具：禁止模型编造「没有日历工具」类借口
          const directPrompt =
            systemPrompt +
            "\n\n# 当前模式\n当前为直答模式，未挂载工具。不要声称没有日历/日程创建工具或权限；" +
            "若用户明确要新增日程、会议或提醒，请请他改用更明确的说法（例如「帮我把明天下午三点会议加到日历」）。";
          const directBudget = await beginStreamAiUsage({
            orgId,
            userId: user.id,
            sessionKey: `${streamSessionKey}:operator-direct`,
          });
          if (!directBudget.ok) {
            emit({
              type: "error",
              error: directBudget.message,
              code: directBudget.code,
            });
            hadError = true;
          } else {
            const stream = await createChatStream({
              systemPrompt: directPrompt,
              messages: recent,
              mode: taskMode,
              signal: abortSignal,
              orgId,
              userId: user.id,
              skipInnerPrecheck: true,
            });

            model = taskMode === "fast" ? "direct-fast" : "direct-chat";
            let lastChunk: unknown = null;
            try {
              for await (const chunk of stream) {
                lastChunk = chunk;
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  if (firstTokenMs === undefined)
                    firstTokenMs = Date.now() - startedAt;
                  fullText += delta;
                  emit({ type: "text", content: delta });
                }
              }
              const usage = extractUsage(lastChunk);
              recordAiCall({
                model: "operator-direct",
                success: true,
                elapsedMs: Date.now() - startedAt,
                source: "ai-operator-direct",
                userId: user.id,
                ...usage,
              });
              const actualCost = actualCostFromStreamUsage({
                model: "operator-direct",
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
              });
              await settleAiUsageReservation({
                reservationId: directBudget.reservationId,
                orgId,
                userId: user.id,
                idempotencyKey: `stream-settle:${streamSessionKey}:operator-direct`,
                actualCost,
                model: "operator-direct",
                inputTokens: usage.promptTokens ?? null,
                outputTokens: usage.completionTokens ?? null,
                success: true,
                hadBillableUsage: actualCost > 0,
              });
              rounds = 1;
            } catch (directErr) {
              hadError = true;
              const usage = extractUsage(lastChunk);
              const actualCost =
                usage.promptTokens || usage.completionTokens
                  ? actualCostFromStreamUsage({
                      model: "operator-direct",
                      promptTokens: usage.promptTokens,
                      completionTokens: usage.completionTokens,
                    })
                  : 0;
              await settleAiUsageReservation({
                reservationId: directBudget.reservationId,
                orgId,
                userId: user.id,
                idempotencyKey: `stream-settle:${streamSessionKey}:operator-direct`,
                actualCost,
                model: "operator-direct",
                inputTokens: usage.promptTokens ?? null,
                outputTokens: usage.completionTokens ?? null,
                success: false,
                hadBillableUsage: actualCost > 0,
                errorCode:
                  directErr instanceof Error
                    ? directErr.message.slice(0, 120)
                    : "operator_direct_failed",
              });
              throw directErr;
            }
          }
        }

        const latencyMs = Date.now() - startedAt;
        console.info("[ai.operator]", {
          userId: user.id,
          role: user.role,
          threadId,
          mode: withTools ? "tools" : "direct",
          model,
          rounds,
          toolCalls,
          firstTokenMs,
          latencyMs,
          error: hadError || undefined,
        });

        emit({
          type: "done",
          mode: withTools ? "operator.tools" : "operator.direct",
          firstTokenMs,
          rounds,
          toolCalls,
          latencyMs,
        });

        // 写库 —— 与 legacy 分支保持结构一致
        const finalContent = fullText || (hadError
          ? "（AI 调用失败，请重试）"
          : "（AI 暂时没有生成内容，请稍后重试）");

        const assistantMsg = await db.aiMessage.create({
          data: {
            threadId,
            role: "assistant",
            content: finalContent,
          },
          select: { id: true },
        });

        await db.aiThread.update({
          where: { id: threadId },
          data: {
            lastMessageAt: new Date(),
            ...(isFirstMessage && threadTitle === "新对话"
              ? { title: userContent.slice(0, 60) }
              : {}),
          },
        });

        // PR4 回看：把本次流中生成的草稿回填 messageId，方便历史会话重新打开时找回卡片
        if (createdActionIds.length > 0) {
          await db.pendingAction.updateMany({
            where: {
              id: { in: createdActionIds },
              createdById: user.id,
              messageId: null,
            },
            data: { messageId: assistantMsg.id },
          });
        }

        if (projectId) {
          import("@/lib/projects/insight-extract")
            .then((m) =>
              m.extractInsightsFromAssistantReply({
                projectId,
                orgId,
                assistantText: finalContent,
              }),
            )
            .catch(() => {});
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        console.error("[ai.operator] failed", err);
        const message = err instanceof Error ? err.message : "AI 服务调用失败";
        emit({ type: "error", error: message });
        controller.close();
      }
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function extractAndSaveMemories(
  userId: string,
  orgId: string | null,
  userMessage: string,
  assistantReply: string,
  threadId: string,
) {
  if (!orgId) return;
  const extracted = extractMemoriesFromConversation(userMessage, assistantReply);
  if (extracted.length === 0) return;

  await saveMemories(
    userId,
    orgId,
    extracted.map((m) => ({
      memoryType: m.memoryType,
      content: m.content,
      layer: 1,
      tags: m.tags,
      importance: m.importance,
      sourceThreadId: threadId,
    })),
  );
}
