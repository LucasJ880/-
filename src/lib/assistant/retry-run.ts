/**
 * Phase 3B-A Commit 6A：安全重试（原子占位 + 确定 runId）
 *
 * 禁止：先查幂等 → Dispatch → 最后写幂等；禁止 runs[0] 猜测新 Run。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findOwnedThreadInOrg } from "@/lib/assistant/thread-org";
import { deriveRetryFlags } from "@/lib/assistant/reconcile-decision";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import {
  createAssistantScenarioBinding,
  startAssistantScenario,
} from "@/lib/assistant/dispatch";
import { routeAssistantIntent, isScenarioIntent } from "@/lib/assistant/intent-router";
import { getAssistantRunStatusDto } from "@/lib/assistant/run-status";
import {
  buildRetryIdempotencyKey,
  markRetrySlotCompleted,
  markRetrySlotFailed,
  markRetrySlotStarted,
  prismaRetrySlotStore,
  reserveRetrySlot,
  type RetrySlotPayload,
  type RetrySlotStore,
} from "@/lib/assistant/retry-idempotency";

const MAX_RETRY_ATTEMPT = 2;

export type RetryRunResult =
  | {
      ok: true;
      response: globalThis.Response;
      oldRunId: string;
      retryAttempt: number;
      newRunId: string;
    }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      newRunId?: string;
    };

function duplicateOrInProgressResponse(input: {
  orgId: string;
  newRunId: string | null;
  dto: Awaited<ReturnType<typeof getAssistantRunStatusDto>> | null;
  inProgress: boolean;
}): Response {
  const body = [
    `data: ${JSON.stringify({
      type: "mode",
      mode: "assistant.retry",
      duplicate: !input.inProgress,
      inProgress: input.inProgress,
      runId: input.newRunId,
      code: input.inProgress ? "RETRY_IN_PROGRESS" : undefined,
    })}\n\n`,
    input.dto
      ? `data: ${JSON.stringify({ type: "run_status", run: input.dto, transition: input.dto.status })}\n\n`
      : "",
    `data: ${JSON.stringify({
      type: "done",
      duplicate: !input.inProgress,
      inProgress: input.inProgress,
      code: input.inProgress ? "RETRY_IN_PROGRESS" : undefined,
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Org-Id": input.orgId,
    },
  });
}

/**
 * 安全重试：原子占位 → 创建消息+Run（确定 ID）→ 场景执行。
 * 客户端不得传入 message / safeToRetry / org 作为可信来源。
 */
export async function retryAssistantRun(
  input: {
    orgId: string;
    userId: string;
    role: string;
    threadId: string;
    runId: string;
  },
  store: RetrySlotStore = prismaRetrySlotStore,
): Promise<RetryRunResult> {
  const thread = await findOwnedThreadInOrg(
    input.threadId,
    input.userId,
    input.orgId,
    { id: true, title: true, orgId: true },
  );
  if (!thread || thread.orgId !== input.orgId) {
    return {
      ok: false,
      status: 404,
      code: "THREAD_NOT_FOUND",
      error: "对话不存在",
    };
  }

  const run = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId },
    include: { session: { select: { userId: true } } },
  });
  if (!run) {
    return {
      ok: false,
      status: 404,
      code: "RUN_NOT_FOUND",
      error: "任务不存在",
    };
  }

  const meta = (run.metadata ?? {}) as Record<string, unknown>;
  if (meta.threadId !== input.threadId) {
    return {
      ok: false,
      status: 404,
      code: "RUN_NOT_FOUND",
      error: "任务不存在",
    };
  }

  const initiated =
    (typeof meta.initiatedByUserId === "string" && meta.initiatedByUserId) ||
    run.session?.userId ||
    null;
  if (!initiated || initiated !== input.userId) {
    return {
      ok: false,
      status: 404,
      code: "RUN_NOT_FOUND",
      error: "任务不存在",
    };
  }

  if (run.status !== "failed") {
    return {
      ok: false,
      status: 400,
      code: "RETRY_NOT_ALLOWED",
      error: "仅失败任务可重试",
    };
  }

  const actions = await db.pendingAction.findMany({
    where: { agentRunId: run.id, orgId: input.orgId },
    select: { status: true, expiresAt: true },
  });
  const flags = deriveRetryFlags({
    runStatus: run.status,
    metadata: run.metadata,
    actions,
  });
  if (!flags.canRetry || flags.retryKind !== "safe_reprepare") {
    return {
      ok: false,
      status: 400,
      code: "MANUAL_REVIEW_REQUIRED",
      error:
        "该动作可能已经对外部系统产生影响。请先检查 Gmail、日历或业务记录，再重新生成操作。",
    };
  }

  const prevAttempt =
    typeof meta.retryAttempt === "number" ? meta.retryAttempt : 0;
  const nextAttempt = prevAttempt + 1;
  if (nextAttempt > MAX_RETRY_ATTEMPT) {
    return {
      ok: false,
      status: 400,
      code: "RETRY_LIMIT_REACHED",
      error: "已达到最大重试次数，请手动重新发起对话。",
    };
  }

  if (!run.userMessageId) {
    return {
      ok: false,
      status: 400,
      code: "RETRY_NOT_ALLOWED",
      error: "缺少原始用户消息，无法安全重试",
    };
  }

  const userMsg = await db.aiMessage.findFirst({
    where: { id: run.userMessageId, threadId: input.threadId },
    select: { id: true, content: true },
  });
  if (!userMsg?.content) {
    return {
      ok: false,
      status: 400,
      code: "RETRY_NOT_ALLOWED",
      error: "原始用户消息不可用",
    };
  }

  const intent = routeAssistantIntent(userMsg.content);
  if (
    intent.intent === "general_answer" ||
    (!isScenarioIntent(intent.intent) && intent.intent !== "unsupported_action")
  ) {
    return {
      ok: false,
      status: 400,
      code: "RETRY_NOT_ALLOWED",
      error: "该任务不适合自动重试，请重新发送消息。",
    };
  }

  const idemKey = buildRetryIdempotencyKey(input.runId, nextAttempt);

  // ① 任何消息 / Dispatch 之前原子占位
  const reserved = await reserveRetrySlot(store, {
    orgId: input.orgId,
    userId: input.userId,
    oldRunId: input.runId,
    retryAttempt: nextAttempt,
    idempotencyKey: idemKey,
  });

  if (reserved.kind === "completed" && reserved.payload.newRunId) {
    const dto = await getAssistantRunStatusDto({
      orgId: input.orgId,
      runId: reserved.payload.newRunId,
      userId: input.userId,
      threadId: input.threadId,
    });
    return {
      ok: true,
      oldRunId: input.runId,
      retryAttempt: nextAttempt,
      newRunId: reserved.payload.newRunId,
      response: duplicateOrInProgressResponse({
        orgId: input.orgId,
        newRunId: reserved.payload.newRunId,
        dto,
        inProgress: false,
      }),
    };
  }

  if (reserved.kind === "in_progress") {
    const existingId = reserved.payload.newRunId ?? null;
    const dto = existingId
      ? await getAssistantRunStatusDto({
          orgId: input.orgId,
          runId: existingId,
          userId: input.userId,
          threadId: input.threadId,
        })
      : null;
    if (existingId) {
      return {
        ok: true,
        oldRunId: input.runId,
        retryAttempt: nextAttempt,
        newRunId: existingId,
        response: duplicateOrInProgressResponse({
          orgId: input.orgId,
          newRunId: existingId,
          dto,
          inProgress: true,
        }),
      };
    }
    return {
      ok: false,
      status: 409,
      code: "RETRY_IN_PROGRESS",
      error: "重试正在进行中，请稍后再查询状态。",
    };
  }

  // acquired | reclaimed
  let slot: RetrySlotPayload = reserved.payload;

  try {
    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "run.retry_requested",
      title: "run.retry_requested",
      visibleToUser: true,
      payload: { retryAttempt: nextAttempt, idempotencyKey: idemKey },
    });

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        metadata: {
          ...meta,
          retryAttempt: nextAttempt,
          lastRetryAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    await appendAgentRunEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "run.retry_started",
      title: "run.retry_started",
      visibleToUser: true,
      payload: { retryAttempt: nextAttempt },
    });

    // ② 先创建 user / assistant / AgentRun，获得确定 runId
    const binding = await createAssistantScenarioBinding({
      orgId: input.orgId,
      userId: input.userId,
      threadId: input.threadId,
      threadTitle: thread.title,
      message: userMsg.content,
      intent: intent.intent,
      retryContext: {
        retriedFromRunId: input.runId,
        retryAttempt: nextAttempt,
        idempotencyKey: idemKey,
      },
    });

    if (!binding) {
      await markRetrySlotFailed(store, {
        orgId: input.orgId,
        idempotencyKey: idemKey,
        payload: slot,
        errorCode: "RUN_CREATE_FAILED",
        errorMessage: "无法创建重试 Run",
      });
      return {
        ok: false,
        status: 500,
        code: "RUN_CREATE_FAILED",
        error: "重试启动失败，请稍后再试。",
      };
    }

    slot = {
      ...slot,
      status: "STARTED",
      newRunId: binding.runId,
      userMessageId: binding.userMessageId,
      assistantMessageId: binding.assistantMessageId,
    };

    await markRetrySlotStarted(store, {
      orgId: input.orgId,
      idempotencyKey: idemKey,
      fromStatus: "RESERVED",
      payload: slot,
    });

    // ③ 将确定 runId 交给场景执行器（不再 list runs[0]）
    const started = await startAssistantScenario({
      userId: input.userId,
      activeOrgId: input.orgId,
      threadId: input.threadId,
      message: userMsg.content,
      threadTitle: thread.title,
      role: input.role,
      binding,
      retryContext: {
        retriedFromRunId: input.runId,
        retryAttempt: nextAttempt,
        idempotencyKey: idemKey,
      },
      intent,
    });

    if (started.kind !== "handled") {
      await markRetrySlotFailed(store, {
        orgId: input.orgId,
        idempotencyKey: idemKey,
        payload: slot,
        errorCode:
          started.kind === "error" ? started.code : "RETRY_NOT_ALLOWED",
        errorMessage:
          started.kind === "error" ? started.error : "不适合自动重试",
      });
      return {
        ok: false,
        status: started.kind === "error" ? started.status : 400,
        code: started.kind === "error" ? started.code : "RETRY_NOT_ALLOWED",
        error:
          started.kind === "error"
            ? started.error
            : "该任务不适合自动重试，请重新发送消息。",
        newRunId: binding.runId,
      };
    }

    await markRetrySlotCompleted(store, {
      orgId: input.orgId,
      idempotencyKey: idemKey,
      payload: {
        ...slot,
        status: "COMPLETED",
        newRunId: binding.runId,
        userMessageId: binding.userMessageId,
        assistantMessageId: binding.assistantMessageId,
      },
    });

    return {
      ok: true,
      oldRunId: input.runId,
      retryAttempt: nextAttempt,
      newRunId: binding.runId,
      response: started.response,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "retry_failed";
    await markRetrySlotFailed(store, {
      orgId: input.orgId,
      idempotencyKey: idemKey,
      payload: slot,
      errorCode: "RETRY_FAILED",
      errorMessage: msg.slice(0, 500),
    });
    console.error("[assistant.retry] failed:", e);
    return {
      ok: false,
      status: 500,
      code: "RETRY_FAILED",
      error: "重试失败，请稍后再试。",
      newRunId: slot.newRunId,
    };
  }
}
