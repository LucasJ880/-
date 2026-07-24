/**
 * Phase 3B-A：统一服务端助手 Dispatch
 *
 * - 可信租户仅来自服务端 activeOrgId
 * - 场景：简报 / 客户跟进 / Gmail 草稿（真实编排）
 * - AgentRun.sessionId = AgentSession.id；metadata 含 threadId / assistantMessageId / scenario
 * - 澄清优先：不创建 AgentRun，仅持久化追问
 * - Rate limit 由 messages 路由在调用本函数之前强制执行
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import {
  buildRunStatusEvent,
  mapAgentRunToAssistantStatus,
  type AssistantTaskStatus,
} from "@/lib/assistant/run-status-types";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import {
  appendAgentRunEvent,
  completeAgentRun,
  createAgentRun,
  failAgentRun,
  updateAgentRunStatus,
} from "@/lib/agent-runtime/run";
import { runDailyBriefScenario } from "@/lib/assistant/scenarios/daily-brief";
import {
  analyzeCustomerFollowup,
  commitCustomerFollowup,
} from "@/lib/assistant/scenarios/customer-followup";
import {
  analyzeGmailDraft,
  commitGmailDraft,
} from "@/lib/assistant/scenarios/gmail-draft";
import type { AssistantScenarioResult } from "@/lib/assistant/scenarios/types";
import { friendlyScenarioError } from "@/lib/assistant/scenarios/types";

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

/** Commit 6A：Retry / 预绑定场景启动上下文 */
export type AssistantRetryContext = {
  retriedFromRunId: string;
  retryAttempt: number;
  idempotencyKey: string;
};

export type AssistantScenarioBinding = {
  userMessageId: string;
  assistantMessageId: string;
  runId: string;
  dto: AssistantRunStatusDto;
};

export type StartAssistantScenarioResult =
  | {
      kind: "handled";
      response: NextResponse;
      runId: string | null;
      userMessageId: string;
      assistantMessageId: string;
      intent: IntentRouteResult;
    }
  | {
      kind: "general";
      intent: IntentRouteResult;
    }
  | {
      kind: "error";
      code: string;
      error: string;
      status: number;
    };

const UNSUPPORTED_MESSAGE =
  "这个操作超出当前助手能力边界（例如自动下单、批量删除客户、清空数据）。青砚可以帮你起草、整理和建议，写操作需你确认后才会执行。";

const PROCESSING_PLACEHOLDER = "正在处理你的请求…";

/** 导出供单测检查文案契约（兼容 Commit 3A 测试） */
export function getScenarioPlaceholderText(intent: IntentRouteResult): string {
  if (intent.intent === "unsupported_action") return UNSUPPORTED_MESSAGE;
  if (intent.intent === "daily_business_brief") {
    return "今日业务简报将基于当前企业可信数据生成（只读，不自动创建写动作）。";
  }
  if (intent.intent === "customer_followup_task") {
    return "已识别为「客户跟进」。青砚会根据你的明确要求，准备日历提醒或商机跟进更新；若你明确要求两项，将生成两张独立确认卡。";
  }
  if (intent.intent === "gmail_email_draft") {
    return intent.requestedDirectExecution
      ? "你要求发送邮件。当前阶段为了安全，只会创建 Gmail 草稿，不会自动发送。"
      : "已识别为「Gmail 邮件草稿」。确认后只会创建草稿、不会自动发送。";
  }
  return UNSUPPORTED_MESSAGE;
}

type SseEmit = (payload: unknown) => void;

function createSseResponse(input: {
  orgId: string;
  runStream: (emit: SseEmit, close: () => void) => Promise<void>;
}): NextResponse {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: SseEmit = (payload) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };
      const close = () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };
      void input.runStream(emit, close).catch((e) => {
        console.error("[assistant.dispatch] stream failed:", e);
        try {
          emit({
            type: "text",
            content: "处理失败，请稍后再试。",
          });
          emit({ type: "done", mode: "assistant.dispatch", error: true });
          close();
        } catch {
          /* closed */
        }
      });
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

async function persistUserAndInitialAssistant(input: {
  threadId: string;
  threadTitle: string;
  userContent: string;
  assistantContent?: string;
}): Promise<{ userMessageId: string; assistantMessageId: string }> {
  const userMsg = await db.aiMessage.create({
    data: {
      threadId: input.threadId,
      role: "user",
      content: input.userContent,
    },
    select: { id: true },
  });
  const assistantMsg = await db.aiMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: input.assistantContent ?? PROCESSING_PLACEHOLDER,
    },
    select: { id: true },
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
  return {
    userMessageId: userMsg.id,
    assistantMessageId: assistantMsg.id,
  };
}

async function updateAssistantMessage(input: {
  assistantMessageId: string;
  content: string;
  workSuggestion?: Record<string, unknown> | null;
}) {
  await db.aiMessage.update({
    where: { id: input.assistantMessageId },
    data: {
      content: input.content,
      ...(input.workSuggestion !== undefined
        ? {
            workSuggestion:
              input.workSuggestion === null
                ? Prisma.DbNull
                : (input.workSuggestion as Prisma.InputJsonValue),
          }
        : {}),
    },
  });
}

function baseRunDto(input: {
  run: {
    id: string;
    orgId: string;
    status: string;
    intent: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    metadata: unknown;
    userMessageId?: string | null;
    startedAt: Date | null;
    updatedAt: Date;
    completedAt: Date | null;
  };
  threadId: string;
  userId: string;
  pendingActionIds?: string[];
  resultSummary?: string | null;
  statusOverride?: AssistantTaskStatus;
}): AssistantRunStatusDto {
  return toAssistantRunStatusDto({
    run: {
      ...input.run,
      metadata: (input.run.metadata ?? null) as Prisma.JsonValue,
    },
    threadId: input.threadId,
    initiatedByUserId: input.userId,
    pendingActionIds: input.pendingActionIds ?? [],
    resultSummary: input.resultSummary,
    statusOverride: input.statusOverride,
  });
}

async function createThreadBoundRun(input: {
  orgId: string;
  userId: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  intent: AssistantIntent;
  /** 已确定的 Run：不再创建，禁止从 runs[0] 猜测 */
  bound?: AssistantScenarioBinding | null;
  retryContext?: AssistantRetryContext | null;
}): Promise<{
  runId: string;
  dto: AssistantRunStatusDto;
} | null> {
  if (input.bound) {
    return { runId: input.bound.runId, dto: input.bound.dto };
  }
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
      skipUserMessageIdempotency: !!input.retryContext,
      metadata: {
        threadId: input.threadId,
        initiatedByUserId: input.userId,
        assistantMessageId: input.assistantMessageId,
        channel: "web_assistant",
        scenario: input.intent,
        ...(input.retryContext
          ? {
              retriedFromRunId: input.retryContext.retriedFromRunId,
              retryAttempt: input.retryContext.retryAttempt,
              retryIdempotencyKey: input.retryContext.idempotencyKey,
            }
          : {}),
      },
    });

    return {
      runId: run.id,
      dto: baseRunDto({
        run,
        threadId: input.threadId,
        userId: input.userId,
        statusOverride: "received",
      }),
    };
  } catch (e) {
    console.error("[assistant.dispatch] createThreadBoundRun failed:", e);
    return null;
  }
}

/**
 * 服务端在场景执行前创建消息 + AgentRun，返回确定关联 ID。
 * Retry 路径必须走此函数，禁止事后从 list runs[0] 倒推。
 */
export async function createAssistantScenarioBinding(input: {
  orgId: string;
  userId: string;
  threadId: string;
  threadTitle: string;
  message: string;
  intent: AssistantIntent;
  retryContext?: AssistantRetryContext | null;
}): Promise<AssistantScenarioBinding | null> {
  const { userMessageId, assistantMessageId } =
    await persistUserAndInitialAssistant({
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      userContent: input.message,
    });
  const created = await createThreadBoundRun({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    userMessageId,
    assistantMessageId,
    intent: input.intent,
    retryContext: input.retryContext,
  });
  if (!created) return null;
  return {
    userMessageId,
    assistantMessageId,
    runId: created.runId,
    dto: created.dto,
  };
}

async function emitLifecycle(
  emit: SseEmit,
  dto: AssistantRunStatusDto,
  statuses: AssistantTaskStatus[],
) {
  for (const s of statuses) {
    emit(buildRunStatusEvent(dto, s));
  }
}

async function finalizeScenarioRun(input: {
  orgId: string;
  runId: string;
  threadId: string;
  userId: string;
  assistantMessageId: string;
  result: AssistantScenarioResult;
  emit: SseEmit;
  intent: AssistantIntent;
  startedDto: AssistantRunStatusDto;
}) {
  const meta = {
    mode: "assistant.dispatch",
    intent: input.intent,
    runId: input.runId,
    userMessageId: input.startedDto.userMessageId,
    assistantMessageId: input.assistantMessageId,
  };

  if (input.result.kind === "completed") {
    await updateAssistantMessage({
      assistantMessageId: input.assistantMessageId,
      content: input.result.assistantContent,
      workSuggestion: input.result.workSuggestion ?? null,
    });
    const completed = await completeAgentRun(input.orgId, input.runId);
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "response.completed",
      title: "response.completed",
      visibleToUser: true,
      payload: { resultSummary: input.result.resultSummary },
    });
    const nextMeta = {
      ...((completed.metadata as Record<string, unknown>) ?? {}),
      resultSummary: input.result.resultSummary,
      assistantMessageId: input.assistantMessageId,
      threadId: input.threadId,
      initiatedByUserId: input.userId,
      channel: "web_assistant",
      scenario: input.intent,
    };
    await db.agentRun.update({
      where: { id: input.runId },
      data: { metadata: nextMeta as Prisma.InputJsonValue },
    });
    const dto = baseRunDto({
      run: { ...completed, metadata: nextMeta },
      threadId: input.threadId,
      userId: input.userId,
      resultSummary: input.result.resultSummary,
      statusOverride: "completed",
    });
    input.emit({ type: "text", content: input.result.assistantContent });
    input.emit(buildRunStatusEvent(dto, "completed"));
    input.emit({ type: "done", ...meta, latencyMs: 0 });
    return;
  }

  if (input.result.kind === "approval_required") {
    await updateAssistantMessage({
      assistantMessageId: input.assistantMessageId,
      content: input.result.assistantContent,
    });
    // createDraft 已 mark awaiting_approval
    const run = await db.agentRun.findFirst({
      where: { id: input.runId, orgId: input.orgId },
    });
    if (run && run.status !== "awaiting_approval") {
      await updateAgentRunStatus(input.orgId, input.runId, "awaiting_approval");
    }
    await db.agentRun.update({
      where: { id: input.runId },
      data: {
        metadata: {
          ...((run?.metadata as Record<string, unknown>) ?? {}),
          resultSummary: input.result.resultSummary,
          assistantMessageId: input.assistantMessageId,
          threadId: input.threadId,
          initiatedByUserId: input.userId,
          channel: "web_assistant",
          scenario: input.intent,
        } as Prisma.InputJsonValue,
      },
    });
    const refreshed = await db.agentRun.findFirstOrThrow({
      where: { id: input.runId },
    });
    const dto = baseRunDto({
      run: refreshed,
      threadId: input.threadId,
      userId: input.userId,
      pendingActionIds: input.result.pendingActions.map((p) => p.id),
      resultSummary: input.result.resultSummary,
      statusOverride: "waiting_for_confirmation",
    });
    input.emit({ type: "text", content: input.result.assistantContent });
    for (const pa of input.result.pendingActions) {
      input.emit({
        type: "approval_required",
        actionId: pa.id,
        draftType: pa.type,
        title: pa.title,
        preview: pa.preview,
      });
    }
    input.emit(buildRunStatusEvent(dto, "waiting_for_confirmation"));
    input.emit({ type: "done", ...meta, latencyMs: 0 });
    return;
  }

  if (input.result.kind === "failed") {
    await updateAssistantMessage({
      assistantMessageId: input.assistantMessageId,
      content: input.result.assistantContent,
    });
    await failAgentRun(input.orgId, input.runId, {
      code: "tool_failed",
      message: input.result.errorCode,
    });
    const failedBase = await db.agentRun.findFirstOrThrow({
      where: { id: input.runId },
    });
    const paCount = await db.pendingAction.count({
      where: { agentRunId: input.runId, orgId: input.orgId },
    });
    const failMeta = {
      ...((failedBase.metadata as Record<string, unknown>) ?? {}),
      scenarioErrorCode: input.result.errorCode,
      resultSummary: input.result.errorCode,
      assistantMessageId: input.assistantMessageId,
      threadId: input.threadId,
      initiatedByUserId: input.userId,
      channel: "web_assistant",
      scenario: input.intent,
      // 仅无任何 PA 时允许安全重试（Prepare/分析失败）
      safeToRetry: paCount === 0,
    };
    await db.agentRun.update({
      where: { id: input.runId },
      data: { metadata: failMeta as Prisma.InputJsonValue },
    });
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "run.failed",
      title: "run.failed",
      visibleToUser: true,
      payload: {
        errorCode: input.result.errorCode,
        scenarioErrorCode: input.result.errorCode,
      },
    });
    const failed = await db.agentRun.findFirstOrThrow({
      where: { id: input.runId },
    });
    const dto = baseRunDto({
      run: failed,
      threadId: input.threadId,
      userId: input.userId,
      resultSummary: input.result.errorCode,
      statusOverride: "failed",
    });
    input.emit({ type: "text", content: input.result.assistantContent });
    input.emit(buildRunStatusEvent(dto, "failed"));
    input.emit({ type: "done", ...meta, latencyMs: 0 });
  }
}

async function streamClarification(input: {
  orgId: string;
  intent: AssistantIntent;
  assistantMessageId: string;
  userMessageId: string;
  content: string;
  emit: SseEmit;
}) {
  await updateAssistantMessage({
    assistantMessageId: input.assistantMessageId,
    content: input.content,
  });
  input.emit({
    type: "mode",
    mode: "assistant.dispatch",
    intent: input.intent,
    runId: null,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    clarification: true,
  });
  input.emit({ type: "text", content: input.content });
  input.emit({
    type: "done",
    mode: "assistant.dispatch",
    intent: input.intent,
    runId: null,
    latencyMs: 0,
  });
}

async function streamUnsupported(input: {
  orgId: string;
  userId: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  emit: SseEmit;
  bound?: AssistantScenarioBinding | null;
  retryContext?: AssistantRetryContext | null;
}) {
  await updateAssistantMessage({
    assistantMessageId: input.assistantMessageId,
    content: UNSUPPORTED_MESSAGE,
  });
  const created = await createThreadBoundRun({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    intent: "unsupported_action",
    bound: input.bound,
    retryContext: input.retryContext,
  });
  const meta = {
    mode: "assistant.dispatch",
    intent: "unsupported_action" as const,
    runId: created?.runId ?? null,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
  };
  input.emit({ type: "mode", ...meta });
  if (created) {
    await emitLifecycle(input.emit, created.dto, [
      "received",
      "planning",
      "running",
    ]);
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: created.runId,
      eventType: "planning.started",
      title: "intent.detected",
      visibleToUser: true,
      payload: { intent: "unsupported_action" },
    });
    const completed = await completeAgentRun(input.orgId, created.runId);
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: created.runId,
      eventType: "response.completed",
      title: "response.completed",
      visibleToUser: true,
    });
    const dto = baseRunDto({
      run: completed,
      threadId: input.threadId,
      userId: input.userId,
      resultSummary: "unsupported_action",
      statusOverride: "completed",
    });
    input.emit({ type: "text", content: UNSUPPORTED_MESSAGE });
    input.emit(buildRunStatusEvent(dto, "completed"));
  } else {
    input.emit({ type: "text", content: UNSUPPORTED_MESSAGE });
  }
  input.emit({ type: "done", ...meta, latencyMs: 0 });
}

async function streamDailyBrief(input: {
  orgId: string;
  userId: string;
  role: string;
  threadId: string;
  message: string;
  userMessageId: string;
  assistantMessageId: string;
  emit: SseEmit;
  bound?: AssistantScenarioBinding | null;
  retryContext?: AssistantRetryContext | null;
}) {
  const created = await createThreadBoundRun({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    intent: "daily_business_brief",
    bound: input.bound,
    retryContext: input.retryContext,
  });
  if (!created) {
    const err = friendlyScenarioError("GRADER_FAILED");
    await updateAssistantMessage({
      assistantMessageId: input.assistantMessageId,
      content: err,
    });
    input.emit({ type: "text", content: err });
    input.emit({
      type: "done",
      mode: "assistant.dispatch",
      intent: "daily_business_brief",
      runId: null,
    });
    return;
  }

  input.emit({
    type: "mode",
    mode: "assistant.dispatch",
    intent: "daily_business_brief",
    runId: created.runId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
  });
  await emitLifecycle(input.emit, created.dto, ["received", "planning"]);
  await updateAgentRunStatus(input.orgId, created.runId, "planning");
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "planning.started",
    title: "intent.detected",
    visibleToUser: true,
    payload: { intent: "daily_business_brief" },
  });
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "context.loading",
    title: "context.loading",
    visibleToUser: true,
  });
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "planning.completed",
    title: "permission.checked",
    visibleToUser: true,
  });

  await updateAgentRunStatus(input.orgId, created.runId, "running");
  input.emit(buildRunStatusEvent(created.dto, "running"));
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "grader.started",
    title: "grader.running",
    visibleToUser: true,
  });

  const result = await runDailyBriefScenario(
    {
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      agentRunId: created.runId,
      message: input.message,
    },
    { id: input.userId, role: input.role as never },
  );

  if (result.kind === "completed") {
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: created.runId,
      eventType: "grader.completed",
      title: "grader.completed",
      visibleToUser: true,
    });
  }

  await finalizeScenarioRun({
    orgId: input.orgId,
    runId: created.runId,
    threadId: input.threadId,
    userId: input.userId,
    assistantMessageId: input.assistantMessageId,
    result,
    emit: input.emit,
    intent: "daily_business_brief",
    startedDto: created.dto,
  });
}

async function streamFollowup(input: {
  orgId: string;
  userId: string;
  role: string;
  threadId: string;
  message: string;
  userMessageId: string;
  assistantMessageId: string;
  emit: SseEmit;
  bound?: AssistantScenarioBinding | null;
  retryContext?: AssistantRetryContext | null;
}) {
  const analyzed = await analyzeCustomerFollowup({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    message: input.message,
    threadId: input.threadId,
  });

  if (analyzed.kind === "clarification_required") {
    if (input.bound) {
      // Retry 已预建 Run：澄清时 fail closed，避免悬挂 Run
      await failAgentRun(input.orgId, input.bound.runId, {
        code: "tool_failed",
        message: "clarification_required_on_retry",
      });
    }
    await streamClarification({
      orgId: input.orgId,
      intent: "customer_followup_task",
      assistantMessageId: input.assistantMessageId,
      userMessageId: input.userMessageId,
      content: analyzed.assistantContent,
      emit: input.emit,
    });
    return;
  }

  const created = await createThreadBoundRun({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    intent: "customer_followup_task",
    bound: input.bound,
    retryContext: input.retryContext,
  });
  if (!created) {
    const err = friendlyScenarioError("DRAFT_CREATION_FAILED");
    await updateAssistantMessage({
      assistantMessageId: input.assistantMessageId,
      content: err,
    });
    input.emit({ type: "text", content: err });
    input.emit({
      type: "done",
      mode: "assistant.dispatch",
      intent: "customer_followup_task",
      runId: null,
    });
    return;
  }

  input.emit({
    type: "mode",
    mode: "assistant.dispatch",
    intent: "customer_followup_task",
    runId: created.runId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
  });
  await emitLifecycle(input.emit, created.dto, ["received", "planning"]);
  await updateAgentRunStatus(input.orgId, created.runId, "planning");
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "planning.started",
    title: "intent.detected",
    visibleToUser: true,
  });
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "tool.completed",
    title: "entity.resolved",
    visibleToUser: true,
    payload: { customerName: analyzed.customerName },
  });

  await updateAgentRunStatus(input.orgId, created.runId, "running");
  input.emit(buildRunStatusEvent(created.dto, "running"));

  const result = await commitCustomerFollowup(
    {
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      agentRunId: created.runId,
      message: input.message,
    },
    analyzed,
  );

  if (result.kind === "approval_required") {
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: created.runId,
      eventType: "approval.required",
      title: "approval.required",
      visibleToUser: true,
      payload: { count: result.pendingActions.length },
    });
  }

  await finalizeScenarioRun({
    orgId: input.orgId,
    runId: created.runId,
    threadId: input.threadId,
    userId: input.userId,
    assistantMessageId: input.assistantMessageId,
    result,
    emit: input.emit,
    intent: "customer_followup_task",
    startedDto: created.dto,
  });
}

async function streamGmail(input: {
  orgId: string;
  userId: string;
  role: string;
  threadId: string;
  message: string;
  userMessageId: string;
  assistantMessageId: string;
  requestedDirectExecution?: boolean;
  emit: SseEmit;
  bound?: AssistantScenarioBinding | null;
  retryContext?: AssistantRetryContext | null;
}) {
  const analyzed = await analyzeGmailDraft({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    message: input.message,
    requestedDirectExecution: input.requestedDirectExecution,
  });

  if (analyzed.kind === "clarification_required") {
    if (input.bound) {
      await failAgentRun(input.orgId, input.bound.runId, {
        code: "tool_failed",
        message: "clarification_required_on_retry",
      });
    }
    await streamClarification({
      orgId: input.orgId,
      intent: "gmail_email_draft",
      assistantMessageId: input.assistantMessageId,
      userMessageId: input.userMessageId,
      content: analyzed.assistantContent,
      emit: input.emit,
    });
    return;
  }

  const created = await createThreadBoundRun({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    intent: "gmail_email_draft",
    bound: input.bound,
    retryContext: input.retryContext,
  });
  if (!created) {
    const err = friendlyScenarioError("DRAFT_CREATION_FAILED");
    await updateAssistantMessage({
      assistantMessageId: input.assistantMessageId,
      content: err,
    });
    input.emit({ type: "text", content: err });
    input.emit({
      type: "done",
      mode: "assistant.dispatch",
      intent: "gmail_email_draft",
      runId: null,
    });
    return;
  }

  input.emit({
    type: "mode",
    mode: "assistant.dispatch",
    intent: "gmail_email_draft",
    runId: created.runId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
  });
  await emitLifecycle(input.emit, created.dto, ["received", "planning"]);
  await updateAgentRunStatus(input.orgId, created.runId, "planning");
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "planning.started",
    title: "intent.detected",
    visibleToUser: true,
  });
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: created.runId,
    eventType: "tool.completed",
    title: "entity.resolved",
    visibleToUser: true,
  });

  await updateAgentRunStatus(input.orgId, created.runId, "running");
  input.emit(buildRunStatusEvent(created.dto, "running"));

  const result = await commitGmailDraft(
    {
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      agentRunId: created.runId,
      message: input.message,
      requestedDirectExecution: input.requestedDirectExecution,
    },
    analyzed,
  );

  if (result.kind === "approval_required") {
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: created.runId,
      eventType: "approval.required",
      title: "approval.required",
      visibleToUser: true,
    });
  }

  await finalizeScenarioRun({
    orgId: input.orgId,
    runId: created.runId,
    threadId: input.threadId,
    userId: input.userId,
    assistantMessageId: input.assistantMessageId,
    result,
    emit: input.emit,
    intent: "gmail_email_draft",
    startedDto: created.dto,
  });
}

/**
 * Commit 6A：统一场景启动。
 * - 可先绑定确定的 runId / 消息 ID（Retry）
 * - 或内部创建消息后由场景流创建 Run
 * - 返回确定关联 ID，禁止调用方从 runs[0] 猜测
 */
export async function startAssistantScenario(input: {
  userId: string;
  activeOrgId: string;
  threadId: string;
  message: string;
  threadTitle?: string;
  /** 服务端可信角色，不得来自客户端 */
  role: string;
  /** 已创建的消息 + Run；SSE 只传输该已知 Run */
  binding?: AssistantScenarioBinding | null;
  retryContext?: AssistantRetryContext | null;
  /** 已路由意图（Retry 可复用）；缺省则按 message 路由 */
  intent?: IntentRouteResult;
}): Promise<StartAssistantScenarioResult> {
  if (!input.activeOrgId) {
    return {
      kind: "error",
      code: "TENANT_CONTEXT_REQUIRED",
      error: "缺少可信组织上下文",
      status: 403,
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
      kind: "error",
      code: "THREAD_NOT_FOUND",
      error: "对话不存在",
      status: 404,
    };
  }

  const intent = input.intent ?? routeAssistantIntent(input.message);

  if (intent.intent === "general_answer") {
    return { kind: "general", intent };
  }

  if (!isScenarioIntent(intent.intent) && intent.intent !== "unsupported_action") {
    return { kind: "general", intent };
  }

  let binding = input.binding ?? null;
  let userMessageId = binding?.userMessageId;
  let assistantMessageId = binding?.assistantMessageId;

  if (!binding) {
    // 普通路径：先落消息；Run 仍在场景流内创建（澄清路径可不建 Run）
    // Retry 路径必须传入 binding（已含确定 runId）
    const persisted = await persistUserAndInitialAssistant({
      threadId: input.threadId,
      threadTitle: input.threadTitle ?? thread.title,
      userContent: input.message,
    });
    userMessageId = persisted.userMessageId;
    assistantMessageId = persisted.assistantMessageId;
  }

  if (!userMessageId || !assistantMessageId) {
    return {
      kind: "error",
      code: "MESSAGE_CREATE_FAILED",
      error: "消息创建失败",
      status: 500,
    };
  }

  const orgId = input.activeOrgId;
  const role = input.role;
  const knownRunId = binding?.runId ?? null;

  const response = createSseResponse({
    orgId,
    runStream: async (emit, close) => {
      try {
        if (intent.intent === "unsupported_action") {
          await streamUnsupported({
            orgId,
            userId: input.userId,
            threadId: input.threadId,
            userMessageId,
            assistantMessageId,
            emit,
            bound: binding,
            retryContext: input.retryContext,
          });
        } else if (intent.intent === "daily_business_brief") {
          await streamDailyBrief({
            orgId,
            userId: input.userId,
            role,
            threadId: input.threadId,
            message: input.message,
            userMessageId,
            assistantMessageId,
            emit,
            bound: binding,
            retryContext: input.retryContext,
          });
        } else if (intent.intent === "customer_followup_task") {
          await streamFollowup({
            orgId,
            userId: input.userId,
            role,
            threadId: input.threadId,
            message: input.message,
            userMessageId,
            assistantMessageId,
            emit,
            bound: binding,
            retryContext: input.retryContext,
          });
        } else if (intent.intent === "gmail_email_draft") {
          await streamGmail({
            orgId,
            userId: input.userId,
            role,
            threadId: input.threadId,
            message: input.message,
            userMessageId,
            assistantMessageId,
            requestedDirectExecution: intent.requestedDirectExecution,
            emit,
            bound: binding,
            retryContext: input.retryContext,
          });
        }
      } finally {
        close();
      }
    },
  });

  return {
    kind: "handled",
    intent,
    response,
    runId: knownRunId,
    userMessageId,
    assistantMessageId,
  };
}

/**
 * 统一入口准备：校验线程租户 → 意图路由 → 场景编排。
 * 调用方须先完成 Rate Limit；本函数假定限流已通过。
 */
export async function prepareAssistantDispatch(input: {
  userId: string;
  activeOrgId: string;
  threadId: string;
  message: string;
  threadTitle?: string;
  /** 服务端可信角色，不得来自客户端 */
  role: string;
}): Promise<DispatchPrepareResult> {
  // Agent Runtime 2.0：复杂销售跟进目标走 durable graph（灰度白名单）
  try {
    const {
      shouldRouteToRuntimeV2,
      startAgentRuntimeV2Run,
      getRuntimeV2WorkbenchView,
    } = await import("@/lib/agent-runtime-v2/process");
    const { userFacingRunLabel } = await import(
      "@/lib/agent-runtime-v2/events"
    );
    if (
      shouldRouteToRuntimeV2({
        orgId: input.activeOrgId,
        userId: input.userId,
        role: input.role,
        goal: input.message,
      })
    ) {
      const thread = await db.aiThread.findFirst({
        where: { id: input.threadId },
        select: { id: true, orgId: true, title: true },
      });
      if (thread && thread.orgId === input.activeOrgId) {
        const persisted = await persistUserAndInitialAssistant({
          threadId: input.threadId,
          threadTitle: input.threadTitle ?? thread.title,
          userContent: input.message,
          assistantContent: "正在理解目标…",
        });
        const intent: IntentRouteResult = {
          intent: "general_answer",
          confidence: 1,
          reason: "agent_runtime_v2",
        };
        const response = createSseResponse({
          orgId: input.activeOrgId,
          runStream: async (emit, close) => {
            emit({
              type: "mode",
              mode: "agent_runtime_v2",
              userMessageId: persisted.userMessageId,
              assistantMessageId: persisted.assistantMessageId,
            });
            emit({
              type: "text",
              content: "正在理解目标并制定计划…\n",
            });

            const startedV2 = await startAgentRuntimeV2Run({
              orgId: input.activeOrgId,
              userId: input.userId,
              role: input.role,
              goal: input.message,
              channel: "web_assistant",
              threadId: input.threadId,
              userMessageId: persisted.userMessageId,
              assistantMessageId: persisted.assistantMessageId,
            });

            if (!startedV2.ok) {
              const clarification =
                startedV2.clarification ??
                startedV2.error ??
                "无法制定计划，请补充说明。";
              await updateAssistantMessage({
                assistantMessageId: persisted.assistantMessageId,
                content: clarification,
              });
              emit({ type: "text", content: clarification });
              emit({ type: "done", mode: "agent_runtime_v2", error: true });
              close();
              return;
            }

            const view = await getRuntimeV2WorkbenchView(
              input.activeOrgId,
              startedV2.runId,
            );
            const report =
              startedV2.report ??
              startedV2.userLabel ??
              userFacingRunLabel(startedV2.status);
            await updateAssistantMessage({
              assistantMessageId: persisted.assistantMessageId,
              content: report,
              workSuggestion: view
                ? {
                    runtimeVersion: "v2",
                    runId: startedV2.runId,
                    status: startedV2.status,
                    objective: view.objective,
                    steps: view.steps,
                    verifications: view.verifications,
                  }
                : { runtimeVersion: "v2", runId: startedV2.runId },
            });

            const runRow = await db.agentRun.findFirst({
              where: { id: startedV2.runId, orgId: input.activeOrgId },
            });
            if (runRow) {
              const pendingRows = await db.pendingAction.findMany({
                where: {
                  orgId: input.activeOrgId,
                  agentRunId: startedV2.runId,
                },
                select: { id: true },
                take: 40,
              });
              const dto = baseRunDto({
                run: runRow,
                threadId: input.threadId,
                userId: input.userId,
                pendingActionIds: pendingRows.map((p) => p.id),
                resultSummary: report,
                statusOverride: mapAgentRunToAssistantStatus({
                  runStatus: startedV2.status,
                  pendingActionStatus:
                    startedV2.status === "awaiting_approval"
                      ? "pending"
                      : null,
                }),
              });
              emit(buildRunStatusEvent(dto));
            }

            emit({ type: "text", content: report });
            if (view?.steps?.length) {
              for (const step of view.steps) {
                emit({
                  type: "tool_result",
                  name: step.toolName || step.stepKey,
                  label: step.title,
                  ok:
                    step.status === "completed" ||
                    step.status === "awaiting_approval" ||
                    step.status === "skipped",
                });
              }
            }
            emit({
              type: "done",
              mode: "agent_runtime_v2",
              runId: startedV2.runId,
              status: startedV2.status,
            });
            close();
          },
        });
        return {
          kind: "handled",
          intent,
          run: null,
          response,
        };
      }
    }
  } catch (e) {
    console.error("[assistant.dispatch] runtime v2 route failed:", e);
    /* V2 路由失败时回落既有路径 */
  }

  const started = await startAssistantScenario(input);
  if (started.kind === "general") {
    return { kind: "general", intent: started.intent };
  }
  if (started.kind === "error") {
    return {
      kind: "handled",
      intent: {
        intent: "unsupported_action",
        confidence: 1,
        reason: started.code.toLowerCase(),
      },
      run: null,
      response: NextResponse.json(
        { error: started.error, code: started.code },
        { status: started.status },
      ),
    };
  }
  return {
    kind: "handled",
    intent: started.intent,
    run: null,
    response: started.response,
  };
}

export async function dispatchAssistantMessage(input: {
  userId: string;
  activeOrgId: string;
  threadId: string;
  message: string;
  threadTitle?: string;
  role: string;
}): Promise<DispatchPrepareResult> {
  return prepareAssistantDispatch(input);
}
