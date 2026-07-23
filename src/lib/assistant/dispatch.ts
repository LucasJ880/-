/**
 * Phase 3B-A：统一服务端助手 Dispatch
 *
 * - 可信租户仅来自服务端 activeOrgId
 * - 前端不得选择 Supervisor / Grader / Operator 作为业务路由
 * - AgentRun.sessionId = AgentSession.id；metadata.threadId = AiThread.id
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findOwnedThreadInOrg } from "@/lib/assistant/thread-org";
import {
  isScenarioIntent,
  routeAssistantIntent,
  type AssistantIntent,
  type IntentRouteResult,
} from "@/lib/assistant/intent-router";
import {
  toAssistantRunStatusDto,
  type AssistantRunStatusDto,
} from "@/lib/assistant/run-status";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import {
  appendAgentRunEvent,
  completeAgentRun,
  createAgentRun,
  updateAgentRunStatus,
} from "@/lib/agent-runtime/run";

export type DispatchHandleResult = {
  kind: "handled";
  response: NextResponse;
  run: AssistantRunStatusDto | null;
  intent: IntentRouteResult;
};

export type DispatchGeneralResult = {
  kind: "general";
  intent: IntentRouteResult;
};

export type DispatchPrepareResult = DispatchHandleResult | DispatchGeneralResult;

const SCENARIO_PLACEHOLDER: Record<
  Exclude<AssistantIntent, "general_answer" | "unsupported_action">,
  string
> = {
  daily_business_brief:
    "已识别为「今日业务简报」。该场景编排正在接入（将复用现有 Grader，只读当前企业数据）。请稍后再试，或先用普通对话提问。",
  customer_followup_task:
    "已识别为「客户跟进」。该场景编排正在接入：将按规则生成日历提醒和/或商机跟进草稿，确认后才会写入。请稍后再试。",
  gmail_email_draft:
    "已识别为「Gmail 邮件草稿」。该场景编排正在接入：只会创建草稿、不会自动发送。请稍后再试。",
};

const UNSUPPORTED_MESSAGE =
  "这个操作超出当前助手能力边界（例如直接发送邮件、自动下单、批量删除客户）。青砚可以帮你起草、整理和建议，写操作需你确认；直接发送类动作请在对应系统中完成。";

function createDispatchSse(input: {
  content: string;
  run: AssistantRunStatusDto | null;
  intent: AssistantIntent;
  orgId: string;
}): NextResponse {
  const encoder = new TextEncoder();
  const meta = {
    mode: "assistant.dispatch",
    intent: input.intent,
    runId: input.run?.runId ?? null,
    status: input.run?.status ?? "completed",
  };
  const readable = new ReadableStream({
    start(controller) {
      if (input.run) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "run_status",
              status: "received",
              run: input.run,
            })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "mode", ...meta })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "text", content: input.content })}\n\n`,
        ),
      );
      if (input.run) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "run_status",
              status: input.run.status,
              run: input.run,
            })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "done", ...meta, latencyMs: 0 })}\n\n`,
        ),
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
      "X-Org-Id": input.orgId,
    },
  });
}

async function persistUserAndAssistant(input: {
  threadId: string;
  threadTitle: string;
  userContent: string;
  assistantContent: string;
}): Promise<{ userMessageId: string }> {
  const userMsg = await db.aiMessage.create({
    data: {
      threadId: input.threadId,
      role: "user",
      content: input.userContent,
    },
    select: { id: true },
  });
  await db.aiMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: input.assistantContent,
    },
  });
  await db.aiThread.update({
    where: { id: input.threadId },
    data: {
      lastMessageAt: new Date(),
      ...(input.threadTitle === "新对话"
        ? { title: input.userContent.slice(0, 60) }
        : {}),
    },
  });
  return { userMessageId: userMsg.id };
}

async function createThreadBoundRun(input: {
  orgId: string;
  userId: string;
  threadId: string;
  userMessageId: string;
  intent: AssistantIntent;
}): Promise<AssistantRunStatusDto | null> {
  try {
    const session = await getOrCreateAgentSession({
      orgId: input.orgId,
      userId: input.userId,
      channel: "web_assistant",
      channelUserId: input.userId,
      channelConversationId: input.threadId,
    });

    const { run } = await createAgentRun({
      orgId: input.orgId,
      sessionId: session.id,
      userMessageId: input.userMessageId,
      runType: "assistant_dispatch",
      intent: input.intent,
      metadata: {
        threadId: input.threadId,
        channel: "web_assistant",
        dispatchPhase: "placeholder",
      },
    });

    await updateAgentRunStatus(input.orgId, run.id, "planning", {
      intent: input.intent,
    });
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: run.id,
      eventType: "planning.started",
      title: "正在分析意图",
      visibleToUser: true,
      payload: { intent: input.intent },
    });

    const completed = await completeAgentRun(input.orgId, run.id);
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: run.id,
      eventType: "response.completed",
      title: "场景编排尚未接入",
      visibleToUser: true,
    });

    return toAssistantRunStatusDto({
      run: completed,
      threadId: input.threadId,
      userId: input.userId,
      resultSummary: "scenario_placeholder",
    });
  } catch (e) {
    console.error("[assistant.dispatch] createThreadBoundRun failed:", e);
    return null;
  }
}

/**
 * 统一入口准备：校验线程租户 → 意图路由。
 * general_answer 交回 messages 路由既有 SSE；其余由本函数处理并落库。
 */
export async function prepareAssistantDispatch(input: {
  userId: string;
  activeOrgId: string;
  threadId: string;
  message: string;
  threadTitle?: string;
}): Promise<DispatchPrepareResult> {
  if (!input.activeOrgId) {
    return {
      kind: "handled",
      intent: {
        intent: "unsupported_action",
        confidence: 1,
        reason: "missing_org",
      },
      run: null,
      response: NextResponse.json(
        {
          error: "缺少可信组织上下文",
          code: "TENANT_CONTEXT_REQUIRED",
        },
        { status: 403 },
      ),
    };
  }

  const thread = await findOwnedThreadInOrg(
    input.threadId,
    input.userId,
    input.activeOrgId,
    { id: true, title: true, orgId: true },
  );
  if (!thread || !thread.orgId || thread.orgId !== input.activeOrgId) {
    return {
      kind: "handled",
      intent: {
        intent: "unsupported_action",
        confidence: 1,
        reason: "thread_not_found",
      },
      run: null,
      response: NextResponse.json(
        { error: "对话不存在", code: "THREAD_NOT_FOUND" },
        { status: 404 },
      ),
    };
  }

  const intent = routeAssistantIntent(input.message);

  if (intent.intent === "general_answer") {
    return { kind: "general", intent };
  }

  const assistantContent =
    intent.intent === "unsupported_action"
      ? UNSUPPORTED_MESSAGE
      : isScenarioIntent(intent.intent)
        ? SCENARIO_PLACEHOLDER[intent.intent]
        : UNSUPPORTED_MESSAGE;

  const { userMessageId } = await persistUserAndAssistant({
    threadId: input.threadId,
    threadTitle: input.threadTitle ?? thread.title,
    userContent: input.message,
    assistantContent,
  });

  let runDto: AssistantRunStatusDto | null = null;
  if (isScenarioIntent(intent.intent) || intent.intent === "unsupported_action") {
    runDto = await createThreadBoundRun({
      orgId: input.activeOrgId,
      userId: input.userId,
      threadId: input.threadId,
      userMessageId,
      intent: intent.intent,
    });
  }

  return {
    kind: "handled",
    intent,
    run: runDto,
    response: createDispatchSse({
      content: assistantContent,
      run: runDto,
      intent: intent.intent,
      orgId: input.activeOrgId,
    }),
  };
}

/**
 * 高层 API：完整 dispatch（含 general 时返回 kind=general，由调用方继续流式）。
 */
export async function dispatchAssistantMessage(input: {
  userId: string;
  activeOrgId: string;
  threadId: string;
  message: string;
  threadTitle?: string;
}): Promise<DispatchPrepareResult> {
  return prepareAssistantDispatch(input);
}
