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

/** SSE 事件：只含一致的 run DTO，可选 transition 且必须与 run.status 相同 */
export type RunStatusEvent = {
  type: "run_status";
  run: AssistantRunStatusDto;
  transition?: AssistantTaskStatus;
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

export function buildRunStatusEvent(
  run: AssistantRunStatusDto,
  statusOverride?: AssistantTaskStatus,
): RunStatusEvent {
  const status = statusOverride ?? run.status;
  const dto: AssistantRunStatusDto = { ...run, status };
  return {
    type: "run_status",
    run: dto,
    transition: status,
  };
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

function readInitiatedByUserId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).initiatedByUserId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 将 DB Run 映射为 DTO。
 * initiatedByPrincipalId 必须来自已验证的发起用户（metadata / session），
 * 不得把「当前调用方 userId」无条件冒充为发起人。
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
  /** 已验证的发起用户（session.userId 或 metadata.initiatedByUserId） */
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
 * 同时要求 session.userId / metadata.initiatedByUserId 匹配当前用户。
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

/** 纯函数：判断某条 Run 行是否对当前用户可见（单测用） */
export function runMatchesOwner(input: {
  orgId: string;
  activeOrgId: string;
  metadataThreadId: string | null;
  requestThreadId: string;
  sessionUserId: string | null;
  metadataInitiatedByUserId: string | null;
  currentUserId: string;
}): boolean {
  if (input.orgId !== input.activeOrgId) return false;
  if (input.metadataThreadId !== input.requestThreadId) return false;
  if (input.sessionUserId !== input.currentUserId) return false;
  if (
    input.metadataInitiatedByUserId &&
    input.metadataInitiatedByUserId !== input.currentUserId
  ) {
    return false;
  }
  return true;
}
