/**
 * Phase 3B-A：助手任务七态 DTO（含 DB 恢复查询）
 * 纯类型见 run-status-types.ts（客户端可安全导入）
 */

import type { AgentRun, AgentRunEvent, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  mapAgentRunToAssistantStatus,
  type AssistantRunStatusDto,
  type AssistantTaskStatus,
} from "@/lib/assistant/run-status-types";

export * from "@/lib/assistant/run-status-types";

function mapEventToStep(
  event: Pick<AgentRunEvent, "eventType" | "title">,
): AssistantRunStatusDto["currentStep"] {
  const title = event.title || event.eventType;
  const t = event.eventType;
  if (t === "approval.required") {
    return { type: "approval_required", title };
  }
  if (t.startsWith("tool.") || t.startsWith("skill.") || t.startsWith("grader.")) {
    return { type: "tool_execution", title };
  }
  if (t.startsWith("planning.") || t === "context.loading" || t === "context.loaded") {
    return { type: "data_lookup", title };
  }
  if (t.startsWith("response.") || t === "run.completed") {
    return { type: "result", title };
  }
  if (t === "run.started" || t === "ack.sent") {
    return { type: "intent", title };
  }
  return { type: "intent", title };
}

function readInitiatedByUserId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).initiatedByUserId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 将 DB Run 映射为 DTO。
 * initiatedByPrincipalId 必须来自已验证的发起用户。
 */
export function toAssistantRunStatusDto(input: {
  run: Pick<
    AgentRun,
    | "id"
    | "orgId"
    | "status"
    | "intent"
    | "errorCode"
    | "errorMessage"
    | "metadata"
    | "startedAt"
    | "updatedAt"
    | "completedAt"
  >;
  threadId: string;
  initiatedByUserId: string;
  events?: Array<Pick<AgentRunEvent, "eventType" | "title" | "visibleToUser" | "createdAt">>;
  pendingActionStatus?: string | null;
  resultSummary?: string | null;
  statusOverride?: AssistantTaskStatus;
}): AssistantRunStatusDto {
  const status =
    input.statusOverride ??
    mapAgentRunToAssistantStatus({
      runStatus: input.run.status,
      pendingActionStatus: input.pendingActionStatus,
    });

  const visible = (input.events ?? [])
    .filter((e) => e.visibleToUser !== false)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  const last = visible[visible.length - 1];
  const currentStep = last ? mapEventToStep(last) : null;

  const meta = (input.run.metadata ?? {}) as Record<string, unknown>;
  const metaSummary =
    typeof meta.resultSummary === "string" ? meta.resultSummary : null;

  return {
    runId: input.run.id,
    conversationId: input.threadId,
    organizationId: input.run.orgId,
    initiatedByPrincipalId: input.initiatedByUserId,
    status,
    intent: input.run.intent,
    currentStep,
    errorCode: input.run.errorCode,
    resultSummary:
      input.resultSummary ??
      metaSummary ??
      input.run.errorMessage ??
      null,
    startedAt: input.run.startedAt?.toISOString() ?? null,
    updatedAt: input.run.updatedAt.toISOString(),
    completedAt: input.run.completedAt?.toISOString() ?? null,
  };
}

/**
 * 按 org + metadata.threadId + 发起用户 恢复 Run。
 */
export async function listAssistantRunsForThread(input: {
  orgId: string;
  threadId: string;
  userId: string;
  take?: number;
}): Promise<AssistantRunStatusDto[]> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      orgId: string;
      status: string;
      intent: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      metadata: unknown;
      startedAt: Date | null;
      updatedAt: Date;
      completedAt: Date | null;
      sessionUserId: string | null;
    }>
  >`
    SELECT r.id, r."orgId", r.status, r.intent, r."errorCode", r."errorMessage",
           r.metadata, r."startedAt", r."updatedAt", r."completedAt",
           s."userId" AS "sessionUserId"
    FROM "AgentRun" r
    INNER JOIN "AgentSession" s ON s.id = r."sessionId"
    WHERE r."orgId" = ${input.orgId}
      AND r.metadata IS NOT NULL
      AND r.metadata->>'threadId' = ${input.threadId}
      AND s."userId" = ${input.userId}
      AND (
        r.metadata->>'initiatedByUserId' IS NULL
        OR r.metadata->>'initiatedByUserId' = ${input.userId}
      )
    ORDER BY r."startedAt" DESC NULLS LAST
    LIMIT ${input.take ?? 10}
  `;

  const dtos: AssistantRunStatusDto[] = [];
  for (const run of rows) {
    const metaUser = readInitiatedByUserId(run.metadata);
    const initiatedByUserId = metaUser || run.sessionUserId;
    if (!initiatedByUserId || initiatedByUserId !== input.userId) {
      continue;
    }

    const events = await db.agentRunEvent.findMany({
      where: { orgId: input.orgId, runId: run.id, visibleToUser: true },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        eventType: true,
        title: true,
        visibleToUser: true,
        createdAt: true,
      },
    });
    const pending = await db.pendingAction.findFirst({
      where: {
        orgId: input.orgId,
        agentRunId: run.id,
        threadId: input.threadId,
        status: { in: ["pending", "approved"] },
      },
      select: { status: true },
      orderBy: { createdAt: "desc" },
    });
    dtos.push(
      toAssistantRunStatusDto({
        run: {
          ...run,
          metadata: (run.metadata ?? null) as Prisma.JsonValue,
        },
        threadId: input.threadId,
        initiatedByUserId,
        events,
        pendingActionStatus: pending?.status ?? null,
      }),
    );
  }
  return dtos;
}
