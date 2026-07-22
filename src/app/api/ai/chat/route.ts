import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { recordAiCall, extractUsage } from "@/lib/ai/monitor";
import { getRequestContext } from "@/lib/common/request-context";
import {
  requireStreamTenant,
  beginStreamAiUsage,
  buildStreamSessionKey,
  settleAiUsageReservation,
  actualCostFromStreamUsage,
} from "@/lib/capabilities/governance";

export const maxDuration = 60;
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
  getProjectAiMemory,
  buildMemoryBlock,
} from "@/lib/ai";

export const POST = withAuth(async (request, _ctx, user) => {
  // Phase 3A-5：先解析 body，再租户预检；body.orgId 仅交叉校验，不可作信任源
  const body = (await request.json().catch(() => ({}))) as {
    messages?: Parameters<typeof prepareConversation>[0];
    orgId?: unknown;
  };
  const claimedBodyOrgId =
    typeof body.orgId === "string" ? body.orgId.trim() : null;
  const workspaceId =
    request.nextUrl.searchParams.get("workspaceId")?.trim() || null;

  const tenant = await requireStreamTenant(request, {
    claimedBodyOrgId,
    workspaceId,
  });
  if (tenant instanceof NextResponse) return tenant;

  const rl = await checkRateLimitAsync(
    {
      name: "ai-chat",
      windowMs: 60_000,
      maxRequests: 30,
    },
    `${tenant.orgId}:${user.id}`,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "未配置 AI API 密钥，请在 .env 中设置 OPENAI_API_KEY" },
      { status: 500 },
    );
  }

  const rawMessages = body.messages ?? [];

  const reqCtx = getRequestContext();
  const sessionKey = buildStreamSessionKey({
    orgId: tenant.orgId,
    userId: user.id,
    requestId: reqCtx?.requestId,
  });

  const begun = await beginStreamAiUsage({
    orgId: tenant.orgId,
    userId: user.id,
    sessionKey,
  });
  if (!begun.ok) {
    return NextResponse.json(
      { error: begun.message, code: begun.code },
      { status: 403 },
    );
  }

  const [workContext, prepared] = await Promise.all([
    getWorkContext(user.id, user.role),
    prepareConversation(rawMessages),
  ]);

  let deepBlock = "";
  let memoryBlock = "";
  const lastUserMsg = [...prepared.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserMsg) {
    const matched = matchProjectByName(
      lastUserMsg.content ?? "",
      workContext.projects,
    );
    if (matched) {
      const [deep, memory] = await Promise.all([
        getProjectDeepContext(matched.id),
        getProjectAiMemory(matched.id),
      ]);
      if (deep) deepBlock = buildProjectDeepBlock(deep);
      memoryBlock = buildMemoryBlock(memory);
    }
  }

  const systemPrompt =
    getChatSystemPrompt(user.role) +
    buildContextBlock(workContext) +
    deepBlock +
    memoryBlock +
    buildSummaryPrefix(prepared.summarizedContext);

  let stream;
  try {
    stream = await createChatStream({
      systemPrompt,
      messages: prepared.messages,
      mode: prepared.mode,
      signal: request.signal,
      orgId: tenant.orgId,
      userId: user.id,
      skipInnerPrecheck: true,
    });
  } catch (err) {
    await settleAiUsageReservation({
      reservationId: begun.reservationId,
      orgId: tenant.orgId,
      userId: user.id,
      idempotencyKey: `stream-settle:${sessionKey}:failed-start`,
      actualCost: 0,
      success: false,
      hadBillableUsage: false,
      errorCode: err instanceof Error ? err.message.slice(0, 120) : "stream_start_failed",
    });
    const message = err instanceof Error ? err.message : "AI 服务调用失败";
    const code = message.includes("QUOTA_HARD_LIMIT")
      ? "QUOTA_HARD_LIMIT"
      : message.includes("TENANT_CONTEXT")
        ? "TENANT_CONTEXT_REQUIRED"
        : "STREAM_START_FAILED";
    return NextResponse.json({ error: message, code }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const t0 = Date.now();
  const modelTag = prepared.mode ? `chat-${prepared.mode}` : "chat";

  const readable = new ReadableStream({
    async start(controller) {
      let lastChunk: unknown = null;
      let settled = false;
      const finishSettle = async (opts: {
        success: boolean;
        promptTokens?: number;
        completionTokens?: number;
        error?: string;
      }) => {
        if (settled) return;
        settled = true;
        const actualCost =
          opts.success && (opts.promptTokens || opts.completionTokens)
            ? actualCostFromStreamUsage({
                model: modelTag,
                promptTokens: opts.promptTokens,
                completionTokens: opts.completionTokens,
              })
            : 0;
        await settleAiUsageReservation({
          reservationId: begun.reservationId,
          orgId: tenant.orgId,
          userId: user.id,
          idempotencyKey: `stream-settle:${sessionKey}`,
          actualCost,
          model: modelTag,
          inputTokens: opts.promptTokens ?? null,
          outputTokens: opts.completionTokens ?? null,
          success: opts.success,
          hadBillableUsage: actualCost > 0,
          errorCode: opts.error?.slice(0, 120) ?? null,
        });
      };

      try {
        for await (const chunk of stream) {
          lastChunk = chunk;
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`),
            );
          }
        }
        const usage = extractUsage(lastChunk);
        recordAiCall({
          model: modelTag,
          success: true,
          elapsedMs: Date.now() - t0,
          source: "ai-chat-stream",
          userId: user.id,
          ...usage,
        });
        await finishSettle({
          success: true,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "AI 服务调用失败";
        recordAiCall({
          model: "chat-stream",
          success: false,
          elapsedMs: Date.now() - t0,
          source: "ai-chat-stream",
          userId: user.id,
          error: message,
        });
        // SSE 断开 / 失败：仍结算（有 usage 则入账，否则释放）
        const usage = extractUsage(lastChunk);
        const partialCost =
          usage.promptTokens || usage.completionTokens
            ? actualCostFromStreamUsage({
                model: modelTag,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
              })
            : 0;
        await finishSettle({
          success: false,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          error: message,
        });
        void partialCost;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
        );
        controller.close();
      }
    },
    async cancel() {
      // 客户端断开：尽量释放/结算
      await settleAiUsageReservation({
        reservationId: begun.reservationId,
        orgId: tenant.orgId,
        userId: user.id,
        idempotencyKey: `stream-settle:${sessionKey}`,
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
      "X-Org-Id": tenant.orgId,
    },
  });
});
