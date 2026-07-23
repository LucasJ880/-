/**
 * Phase 3B-A：助手任务七态 DTO（应用层映射，不建新表）
 */

import type { AgentRun, AgentRunEvent, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type AssistantTaskStatus =
  | "received"
  | "planning"
  | "running"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type AssistantRunStepType =
  | "intent"
  | "data_lookup"
  | "permission_check"
  | "tool_execution"
  | "approval_required"
  | "result";

export type AssistantRunStatusDto = {
  runId: string;
  conversationId: string;
  organizationId: string;
  initiatedByPrincipalId: string;
  status: AssistantTaskStatus;
  intent: string | null;
  currentStep: {
    type: AssistantRunStepType;
    title: string;
  } | null;
  errorCode: string | null;
  resultSummary: string | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
};

const STATUS_LABEL: Record<AssistantTaskStatus, string> = {
  received: "已收到",
  planning: "正在分析",
  running: "正在执行",
  waiting_for_confirmation: "等待确认",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

export function assistantStatusLabel(status: AssistantTaskStatus): string {
  return STATUS_LABEL[status];
}

/**
 * AgentRun.status (+ 可选 PA) → 七态
 * 兼容 awaiting_approval / waiting_for_approval 两种命名。
 */
export function mapAgentRunToAssistantStatus(input: {
  runStatus: string;
  pendingActionStatus?: string | null;
}): AssistantTaskStatus {
  const pa = input.pendingActionStatus;
  if (pa === "pending" || pa === "approved") {
    return "waiting_for_confirmation";
  }
  if (pa === "rejected") return "cancelled";
  if (pa === "failed" || pa === "expired") return "failed";
  if (pa === "executed") {
    // PA 已执行时仍以 Run 终态为准；若 Run 仍活跃则视为 running 收尾
  }

  switch (input.runStatus) {
    case "queued":
    case "acknowledged":
      return "received";
    case "planning":
      return "planning";
    case "running":
      return "running";
    case "awaiting_approval":
    case "waiting_for_approval":
      return "waiting_for_confirmation";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

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
  userId: string;
  events?: Array<Pick<AgentRunEvent, "eventType" | "title" | "visibleToUser" | "createdAt">>;
  pendingActionStatus?: string | null;
  resultSummary?: string | null;
}): AssistantRunStatusDto {
  const status = mapAgentRunToAssistantStatus({
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
    initiatedByPrincipalId: input.userId,
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

/** 按 metadata.threadId 查当前组织下与线程关联的 Run（禁止用 sessionId=threadId） */
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
    }>
  >`
    SELECT id, "orgId", status, intent, "errorCode", "errorMessage",
           metadata, "startedAt", "updatedAt", "completedAt"
    FROM "AgentRun"
    WHERE "orgId" = ${input.orgId}
      AND metadata IS NOT NULL
      AND metadata->>'threadId' = ${input.threadId}
    ORDER BY "startedAt" DESC NULLS LAST
    LIMIT ${input.take ?? 10}
  `;

  const dtos: AssistantRunStatusDto[] = [];
  for (const run of rows) {
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
        userId: input.userId,
        events,
        pendingActionStatus: pending?.status ?? null,
      }),
    );
  }
  return dtos;
}
