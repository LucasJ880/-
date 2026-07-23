/**
 * Phase 3B-A Commit 6：安全重试（仅 Prepare 失败、无 PA、无外部副作用）
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findOwnedThreadInOrg } from "@/lib/assistant/thread-org";
import { deriveRetryFlags } from "@/lib/assistant/reconcile-decision";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import { prepareAssistantDispatch } from "@/lib/assistant/dispatch";
import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";
import { listAssistantRunsForThread } from "@/lib/assistant/run-status";

const MAX_RETRY_ATTEMPT = 2;

export type RetryRunResult =
  | {
      ok: true;
      response: globalThis.Response;
      oldRunId: string;
      retryAttempt: number;
    }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
    };

async function loadIdempotency(orgId: string, key: string) {
  return db.approvalDecisionIdempotency.findUnique({
    where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } },
  });
}

async function rememberIdempotency(input: {
  orgId: string;
  key: string;
  userId: string;
  oldRunId: string;
  result: Record<string, unknown>;
}) {
  try {
    await db.approvalDecisionIdempotency.create({
      data: {
        orgId: input.orgId,
        idempotencyKey: input.key,
        approvalKey: `assistant-run-retry:${input.oldRunId}`,
        action: "retry",
        userId: input.userId,
        resultJson: input.result as object,
      },
    });
    return { duplicate: false as const };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await loadIdempotency(input.orgId, input.key);
      return {
        duplicate: true as const,
        result: (existing?.resultJson ?? null) as Record<string, unknown> | null,
      };
    }
    throw err;
  }
}

/**
 * 安全重试：从原 Run.userMessageId 读取内容，重新走 Dispatch（新 Assistant 消息 + 新 Run）。
 * 客户端不得传入 message / safeToRetry / org 作为可信来源。
 */
export async function retryAssistantRun(input: {
  orgId: string;
  userId: string;
  role: string;
  threadId: string;
  runId: string;
}): Promise<RetryRunResult> {
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
  if (
    typeof meta.initiatedByUserId === "string" &&
    meta.initiatedByUserId !== input.userId
  ) {
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

  const idemKey = `assistant-run-retry:${input.runId}:${nextAttempt}`;
  const existing = await loadIdempotency(input.orgId, idemKey);
  if (existing?.resultJson) {
    const cached = existing.resultJson as {
      ok?: boolean;
      newRunId?: string;
    };
    if (cached.newRunId) {
      const runs = await listAssistantRunsForThread({
        orgId: input.orgId,
        threadId: input.threadId,
        userId: input.userId,
        take: 20,
      });
      const dto = runs.find((r) => r.runId === cached.newRunId) ?? null;
      // 重复请求：返回空流 + done，避免再跑场景
      const body = [
        `data: ${JSON.stringify({ type: "mode", mode: "assistant.retry", duplicate: true, runId: cached.newRunId })}\n\n`,
        dto
          ? `data: ${JSON.stringify({ type: "run_status", run: dto, transition: dto.status })}\n\n`
          : "",
        `data: ${JSON.stringify({ type: "done", duplicate: true })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return {
        ok: true,
        oldRunId: input.runId,
        retryAttempt: nextAttempt,
        response: new Response(body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Org-Id": input.orgId,
          },
        }),
      };
    }
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

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "run.retry_requested",
    title: "run.retry_requested",
    visibleToUser: true,
    payload: { retryAttempt: nextAttempt },
  });

  // 标记旧 Run 重试元数据（保持 failed）
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

  // 通过 Dispatch 重新编排：会新建 user+assistant；在 metadata 中标记 retriedFrom
  // 为避免重复用户气泡，先写入一条系统提示式 user？规范要求复用内容——
  // 这里用原内容再走 dispatch，前端刷新后会看到新的一轮消息（可接受 MVP）。
  const prep = await prepareAssistantDispatch({
    userId: input.userId,
    activeOrgId: input.orgId,
    threadId: input.threadId,
    message: userMsg.content,
    threadTitle: thread.title,
    role: input.role,
  });

  if (prep.kind !== "handled") {
    // general_answer：不应出现在场景失败重试；仍返回错误
    return {
      ok: false,
      status: 400,
      code: "RETRY_NOT_ALLOWED",
      error: "该任务不适合自动重试，请重新发送消息。",
    };
  }

  // 将最新 Run 标记 retriedFromRunId（异步：从列表取最新）
  const runs = await listAssistantRunsForThread({
    orgId: input.orgId,
    threadId: input.threadId,
    userId: input.userId,
    take: 5,
  });
  const newest = runs[0] as AssistantRunStatusDto | undefined;
  if (newest && newest.runId !== input.runId) {
    const newRun = await db.agentRun.findFirst({
      where: { id: newest.runId, orgId: input.orgId },
    });
    if (newRun) {
      const nm = (newRun.metadata ?? {}) as Record<string, unknown>;
      await db.agentRun.update({
        where: { id: newRun.id },
        data: {
          metadata: {
            ...nm,
            retriedFromRunId: input.runId,
            retryAttempt: nextAttempt,
          } as Prisma.InputJsonValue,
        },
      });
    }
    await rememberIdempotency({
      orgId: input.orgId,
      key: idemKey,
      userId: input.userId,
      oldRunId: input.runId,
      result: { ok: true, newRunId: newest.runId, retryAttempt: nextAttempt },
    });
  }

  return {
    ok: true,
    oldRunId: input.runId,
    retryAttempt: nextAttempt,
    response: prep.response,
  };
}
