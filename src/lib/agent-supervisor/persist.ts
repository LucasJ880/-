/**
 * Supervisor 状态持久化 — AgentRun.supervisorState 为真相源
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { appendAgentRunEvent, updateAgentRunStatus } from "@/lib/agent-runtime/run";
import type { SupervisorState, SupervisorStatus } from "./types";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function saveSupervisorState(
  state: SupervisorState,
): Promise<void> {
  await db.agentRun.updateMany({
    where: { id: state.runId, orgId: state.orgId },
    data: { supervisorState: asJson(state) },
  });
}

export async function loadSupervisorState(
  orgId: string,
  runId: string,
): Promise<SupervisorState | null> {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
    select: { supervisorState: true },
  });
  if (!run?.supervisorState || typeof run.supervisorState !== "object") {
    return null;
  }
  return run.supervisorState as unknown as SupervisorState;
}

export async function emitSupervisorEvent(input: {
  orgId: string;
  runId: string;
  eventType: string;
  title: string;
  payload?: Record<string, unknown>;
  visibleToUser?: boolean;
}) {
  // 扩展事件用 payload.supervisorEvent 兼容现有 AgentRunEventType 约束
  const known = new Set([
    "run.started",
    "planning.started",
    "planning.completed",
    "skill.started",
    "skill.completed",
    "approval.required",
    "response.started",
    "response.completed",
    "run.completed",
    "run.failed",
    "run.cancelled",
    "tool.started",
    "tool.completed",
  ]);
  const eventType = known.has(input.eventType)
    ? (input.eventType as Parameters<typeof appendAgentRunEvent>[0]["eventType"])
    : "planning.completed";

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType,
    title: input.title,
    payload: {
      supervisorEvent: input.eventType,
      ...(input.payload || {}),
    },
    visibleToUser: input.visibleToUser ?? true,
  });
}

export async function syncRunStatusFromSupervisor(
  state: SupervisorState,
): Promise<void> {
  const map: Partial<Record<SupervisorStatus, Parameters<typeof updateAgentRunStatus>[2]>> =
    {
      understanding: "planning",
      planning: "planning",
      running: "running",
      replanning: "running",
      waiting_for_user: "awaiting_approval",
      waiting_for_approval: "awaiting_approval",
      completed: "completed",
      failed: "failed",
      cancelled: "cancelled",
    };
  const status = map[state.status];
  if (!status) return;
  if (status === "completed" || status === "failed" || status === "cancelled") {
    // 完成类由 engine 显式调用，避免中途误标
    if (state.status === "waiting_for_approval" || state.status === "waiting_for_user") {
      await updateAgentRunStatus(state.orgId, state.runId, "awaiting_approval");
    }
    return;
  }
  await updateAgentRunStatus(state.orgId, state.runId, status);
}
