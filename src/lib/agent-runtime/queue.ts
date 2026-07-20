/**
 * AgentRun 后台队列 — DB 租约 + 重试（对标 MarketResearchRun）
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  appendAgentRunEvent,
  failAgentRun,
  isAgentRunCancelled,
} from "./run";
import type { AgentPlan } from "./plan";

export const BACKGROUND_RUN_TYPE = "background_conversation";
const LEASE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [15_000, 60_000, 180_000];

export type BackgroundRunPayload = {
  background: true;
  userId: string;
  userRole: string;
  userName: string | null;
  channel: string;
  channelUserId: string;
  content: string;
  messageType: string;
  plan: AgentPlan;
  /** 主管 AI 多步任务标记（由 process 在 forceForeground 时进入 Supervisor） */
  supervisor?: boolean;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function isBackgroundPayload(meta: unknown): meta is BackgroundRunPayload {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return m.background === true && typeof m.userId === "string";
}

/** 将已规划的任务放入后台队列，gateway 可立刻返回 */
export async function enqueueBackgroundAgentRun(input: {
  orgId: string;
  runId: string;
  payload: BackgroundRunPayload;
}): Promise<void> {
  const run = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId },
  });
  if (!run) throw new Error("Run 不存在或跨组织");
  if (run.status === "cancelled" || run.status === "completed") return;

  await db.agentRun.update({
    where: { id: run.id },
    data: {
      runType: BACKGROUND_RUN_TYPE,
      status: "queued",
      nextAttemptAt: new Date(),
      leaseExpiresAt: null,
      metadata: jsonValue(input.payload),
      intent: input.payload.plan.intent,
    },
  });

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "background.queued",
    title: "已转入后台处理",
    payload: {
      intent: input.payload.plan.intent,
      complexity: input.payload.plan.complexity,
    },
    visibleToUser: true,
  });
}

async function claimAgentRun(runId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await db.agentRun.updateMany({
    where: {
      id: runId,
      runType: BACKGROUND_RUN_TYPE,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        {
          status: "queued",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: "running", leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      nextAttemptAt: null,
      startedAt: now,
      errorCode: null,
      errorMessage: null,
    },
  });
  return claimed.count > 0;
}

async function pushResultToChannel(input: {
  orgId: string;
  channel: string;
  channelUserId: string;
  userId: string;
  text: string;
}): Promise<void> {
  try {
    const { sendToExternalUser, pushMessage } = await import(
      "@/lib/messaging/gateway"
    );
    const channel = input.channel as "personal_wechat" | "wecom";
    if (channel === "personal_wechat" || channel === "wecom") {
      const r = await sendToExternalUser({
        channel,
        orgId: input.orgId,
        to: input.channelUserId,
        text: input.text,
      });
      if (r.ok) return;
    }
    await pushMessage(input.userId, input.text, {
      channels: ["personal_wechat", "wecom"],
    });
  } catch (e) {
    console.error("[AgentQueue] push result failed", {
      orgId: input.orgId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 执行单个后台 Run（认领 → 执行 → 推送） */
export async function executeBackgroundAgentRun(runId: string) {
  const ok = await claimAgentRun(runId);
  if (!ok) {
    return db.agentRun.findUnique({ where: { id: runId } });
  }

  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: runId },
    include: { session: true },
  });

  if (await isAgentRunCancelled(run.orgId, run.id)) {
    return run;
  }

  const payload = isBackgroundPayload(run.metadata) ? run.metadata : null;
  if (!payload) {
    await failAgentRun(run.orgId, run.id, {
      code: "db_error",
      message: "后台任务缺少 payload",
    });
    return db.agentRun.findUnique({ where: { id: runId } });
  }

  await appendAgentRunEvent({
    orgId: run.orgId,
    runId: run.id,
    eventType: "background.started",
    title: "后台开始执行",
    visibleToUser: true,
  });

  const startedAt = Date.now();
  try {
    if (await isAgentRunCancelled(run.orgId, run.id)) {
      return db.agentRun.findUnique({ where: { id: runId } });
    }

    const { executeConversationRun } = await import("./process");
    const result = await executeConversationRun({
      orgId: run.orgId,
      userId: payload.userId,
      userRole: payload.userRole,
      userName: payload.userName,
      channel: payload.channel,
      content: payload.content,
      messageType: payload.messageType,
      session: run.session,
      runId: run.id,
      forceForeground: true,
      precomputedPlan: payload.plan,
    });

    if (await isAgentRunCancelled(run.orgId, run.id)) {
      return db.agentRun.findUnique({ where: { id: runId } });
    }

    await appendAgentRunEvent({
      orgId: run.orgId,
      runId: run.id,
      eventType: "background.completed",
      title: "后台任务完成",
      payload: { latencyMs: Date.now() - startedAt },
      visibleToUser: true,
    });

    const rawText = typeof result === "string" ? result : result.text;
    const { appendWorkbenchLink } = await import("./workbench-link");
    const text = appendWorkbenchLink(rawText, run.id).slice(0, 3500);
    await pushResultToChannel({
      orgId: run.orgId,
      channel: payload.channel,
      channelUserId: payload.channelUserId,
      userId: payload.userId,
      text,
    });

    const binding = await db.weChatBinding.findFirst({
      where: {
        orgId: run.orgId,
        userId: payload.userId,
        channel: payload.channel,
        externalId: payload.channelUserId,
        status: "active",
      },
      select: { id: true },
    });
    if (binding) {
      await db.weChatMessage
        .create({
          data: {
            bindingId: binding.id,
            userId: payload.userId,
            orgId: run.orgId,
            direction: "outbound",
            channel: payload.channel,
            externalUserId: payload.channelUserId,
            content: text.slice(0, 8000),
            messageType: "text",
            agentProcessed: true,
            agentResponse: text.slice(0, 8000),
          },
        })
        .catch(() => {});
    }

    return db.agentRun.findUnique({ where: { id: runId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = run.attempts;
    const retryable = true;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const shouldRetry = retryable && !exhausted;

    if (shouldRetry) {
      const backoffIndex = Math.max(
        0,
        Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1),
      );
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: "queued",
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS[backoffIndex]),
          errorCode: "model_failed",
          errorMessage: message.slice(0, 2000),
        },
      });
    } else {
      await failAgentRun(run.orgId, run.id, {
        code: "model_failed",
        message,
      });
      {
        const { appendWorkbenchLink } = await import("./workbench-link");
        await pushResultToChannel({
          orgId: run.orgId,
          channel: payload.channel,
          channelUserId: payload.channelUserId,
          userId: payload.userId,
          text: appendWorkbenchLink(
            "这个任务没有完成，我已经保留了任务记录。请稍后重试或发送「状态」查看。",
            run.id,
          ),
        });
      }
    }
    return db.agentRun.findUnique({ where: { id: runId } });
  }
}

/** cron / worker 批量消费 */
export async function processQueuedAgentRuns(limit = 2) {
  const now = new Date();

  // 租约过期且尝试耗尽 → failed
  await db.agentRun.updateMany({
    where: {
      runType: BACKGROUND_RUN_TYPE,
      status: "running",
      attempts: { gte: MAX_ATTEMPTS },
      leaseExpiresAt: { lte: now },
    },
    data: {
      status: "failed",
      errorCode: "external_timeout",
      errorMessage: "后台任务超时且已达最大尝试次数",
      leaseExpiresAt: null,
      completedAt: now,
    },
  });

  const runs = await db.agentRun.findMany({
    where: {
      runType: BACKGROUND_RUN_TYPE,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        {
          status: "queued",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: "running", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 5)),
    select: { id: true },
  });

  const results = [];
  for (const run of runs) {
    results.push(await executeBackgroundAgentRun(run.id));
  }
  return {
    processed: results.length,
    runIds: runs.map((r) => r.id),
  };
}
