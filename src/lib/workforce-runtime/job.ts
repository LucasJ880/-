/**
 * Workforce Job 创建入口（Phase 2A §3–4）
 *
 * Job = root AgentRun（runType="workforce_job"）；jobId = rootRunId = runId。
 * 必须走 createAgentRun（复用配额治理 / trace / AgentSession / 幂等），
 * 禁止直接 db.agentRun.create()。
 *
 * Owner 注入（§4）：root Job 上
 *   actor = { type:"USER", id:userId, userId }（发起人）
 *   owner = { type:"USER", id:userId }（问责人，跨整棵 run 树不变）
 * Phase 2A 不创建 AI Job Owner。
 */

import { db } from "@/lib/db";
import {
  createAgentRun,
  mergeAgentRunMetadata,
  appendAgentRunEvent,
} from "@/lib/agent-runtime/run";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import {
  normalizeRuntimeContext,
  runtimeContextToTelemetry,
  type AIRuntimeContext,
} from "@/lib/ai/runtime-context";
import { WORKFORCE_JOB_RUN_TYPE } from "./constants";
import { isWorkforceRuntimeEnabled } from "./flags";

export type CreateWorkforceJobInput = {
  orgId: string;
  /** Human Owner = 发起人（Phase 2A Owner 恒为 USER） */
  userId: string;
  /** 平台角色（feature flag role allowlist 判定用） */
  role?: string | null;
  goal: string;
  channel?: string;
  threadId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  traceId?: string | null;
  userMessageId?: string | null;
  source?: string;
};

export type CreateWorkforceJobResult =
  | {
      ok: true;
      jobId: string;
      runId: string;
      traceId: string | null;
      reused: boolean;
    }
  | { ok: false; error: string };

export async function createWorkforceJob(
  input: CreateWorkforceJobInput,
): Promise<CreateWorkforceJobResult> {
  // §25：feature flag / allowlist 强制，未命中即拒绝（不自动路由）
  if (
    !isWorkforceRuntimeEnabled({
      userId: input.userId,
      role: input.role,
      orgId: input.orgId,
    })
  ) {
    return { ok: false, error: "WORKFORCE_RUNTIME_DISABLED" };
  }

  const goal = input.goal.trim();
  if (goal.length < 4) {
    return { ok: false, error: "GOAL_TOO_SHORT" };
  }

  const channel = input.channel ?? "workforce";
  const session = await getOrCreateAgentSession({
    orgId: input.orgId,
    userId: input.userId,
    channel,
    channelUserId: input.userId,
    channelConversationId: input.threadId ?? null,
  });

  // 受信执行上下文：只能由服务端构造（session 已校验 org/user）
  const runtime: AIRuntimeContext = normalizeRuntimeContext({
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? undefined,
    actor: { type: "USER", id: input.userId, userId: input.userId },
    owner: { type: "USER", id: input.userId },
    projectId: input.projectId ?? undefined,
    threadId: input.threadId ?? undefined,
    sessionId: session.id,
    channel,
    traceId: input.traceId ?? undefined,
    source: input.source ?? "workforce_job",
  })!;

  const created = await createAgentRun({
    orgId: input.orgId,
    sessionId: session.id,
    userMessageId: input.userMessageId ?? undefined,
    runType: WORKFORCE_JOB_RUN_TYPE,
    intent: "workforce_job",
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId ?? null,
    traceId: input.traceId ?? null,
    runtime,
    metadata: {
      runtimeVersion: "v2",
      goal,
      // 执行主体恢复锚点（resolveRuntimeV2Principal 复用；resume 时重新校验）
      initiatedByUserId: input.userId,
      threadId: input.threadId ?? null,
      channel,
      source: runtime.source,
    },
  });
  const run = created.run;

  if (created.reused) {
    return {
      ok: true,
      jobId: run.id,
      runId: run.id,
      traceId: run.traceId,
      reused: true,
    };
  }

  // durable queue 就绪：v2 runtime + queued + 立即可认领
  await db.agentRun.update({
    where: { id: run.id },
    data: {
      runtimeVersion: "v2",
      status: "queued",
      nextAttemptAt: new Date(),
      leaseExpiresAt: null,
    },
  });

  // 回写 jobId = rootRunId = run.id（merge，不覆盖既有 correlation）
  await mergeAgentRunMetadata(input.orgId, run.id, { jobId: run.id });

  const correlation = runtimeContextToTelemetry({
    ...runtime,
    runId: run.id,
    rootRunId: run.id,
    jobId: run.id,
    traceId: run.traceId ?? runtime.traceId,
  });

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: run.id,
    eventType: "job.created",
    title: "Workforce Job 已创建",
    payload: { goal: goal.slice(0, 200), correlation },
    visibleToUser: true,
  });
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: run.id,
    eventType: "job.queued",
    title: "已进入 Workforce 队列",
    payload: { correlation },
    visibleToUser: true,
  });

  return {
    ok: true,
    jobId: run.id,
    runId: run.id,
    traceId: run.traceId,
    reused: false,
  };
}
