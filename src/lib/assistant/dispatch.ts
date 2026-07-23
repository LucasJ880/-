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
}): Promise<{
  runId: string;
  dto: AssistantRunStatusDto;
} | null> {
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
        initiatedByUserId: input.userId,
        assistantMessageId: input.assistantMessageId,
        channel: "web_assistant",
        scenario: input.intent,
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
    const failMeta = {
      ...((failedBase.metadata as Record<string, unknown>) ?? {}),
      scenarioErrorCode: input.result.errorCode,
      resultSummary: input.result.errorCode,
      assistantMessageId: input.assistantMessageId,
      threadId: input.threadId,
      initiatedByUserId: input.userId,
      channel: "web_assistant",
      scenario: input.intent,
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
}) {
  const created = await createThreadBoundRun({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    intent: "daily_business_brief",
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
}) {
  const analyzed = await analyzeCustomerFollowup({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    message: input.message,
    threadId: input.threadId,
  });

  if (analyzed.kind === "clarification_required") {
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
}) {
  const analyzed = await analyzeGmailDraft({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    message: input.message,
    requestedDirectExecution: input.requestedDirectExecution,
  });

  if (analyzed.kind === "clarification_required") {
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

  if (!isScenarioIntent(intent.intent) && intent.intent !== "unsupported_action") {
    return { kind: "general", intent };
  }

  const { userMessageId, assistantMessageId } =
    await persistUserAndInitialAssistant({
      threadId: input.threadId,
      threadTitle: input.threadTitle ?? thread.title,
      userContent: input.message,
    });

  const orgId = input.activeOrgId;
  const role = input.role;

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
    run: null,
    response,
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
