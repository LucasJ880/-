/**
 * Phase 3A-1：统一 Trace / Execution 读取层
 *
 * - 不建超级宽表；多源 adapter 投影
 * - 强制 TenantContext.orgId
 * - SkillExecution / ToolCallTrace 经可信 JOIN 封堵跨租户
 */

import { db } from "@/lib/db";
import type {
  CapabilitiesAccessContext,
  ExecutionProjection,
  TraceBundle,
  TraceTimelineItem,
} from "./types";
import {
  CapabilitiesAccessError,
  assertOrgScope,
  isOrgAdminRole,
  isWorkspaceMember,
  resolveDetailAccessMode,
  visibilityForMode,
} from "./access";
import { redactProjection } from "./visibility";
import {
  projectAgentRun,
  projectAgentRunEvent,
  projectSupervisorState,
} from "./adapters/agent-run";
import { projectSkillExecution } from "./adapters/skill-execution";
import { projectToolCallTrace } from "./adapters/tool-call-trace";
import { projectPendingAction } from "./adapters/pending-action";

function applyVisibility(
  access: CapabilitiesAccessContext,
  proj: ExecutionProjection,
): ExecutionProjection {
  const mode = resolveDetailAccessMode(access, proj.workspaceId);
  return redactProjection(proj, visibilityForMode(mode), {
    isWorkspaceMember: isWorkspaceMember(access, proj.workspaceId),
    isOrgAdmin: isOrgAdminRole(access.orgRole),
  });
}

/** 按 AgentRun id 读取（强制 org 边界） */
export async function getAgentRunProjection(
  access: CapabilitiesAccessContext,
  runId: string,
): Promise<ExecutionProjection> {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId: access.orgId },
    include: {
      session: { select: { userId: true, currentProjectId: true } },
    },
  });
  if (!run) {
    throw new CapabilitiesAccessError("Run 不存在", "NOT_FOUND", 404);
  }
  assertOrgScope(access, run.orgId);
  return applyVisibility(access, projectAgentRun(run));
}

/** 完整 Trace Bundle：Run + events + supervisor + 关联 PendingAction */
export async function getTraceBundle(
  access: CapabilitiesAccessContext,
  runId: string,
): Promise<TraceBundle> {
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId: access.orgId },
    include: {
      session: { select: { userId: true, currentProjectId: true } },
      events: { orderBy: { sequence: "asc" }, take: 200 },
    },
  });
  if (!run) {
    throw new CapabilitiesAccessError("Run 不存在", "NOT_FOUND", 404);
  }
  assertOrgScope(access, run.orgId);

  const root = applyVisibility(access, projectAgentRun(run));
  const items: TraceTimelineItem[] = [
    {
      ...root,
      sequence: 0,
      title: "AgentRun",
      eventType: "run.root",
    },
  ];

  const supervisor = projectSupervisorState(run, root);
  if (supervisor) {
    items.push({
      ...applyVisibility(access, supervisor),
      sequence: null,
      title: supervisor.title,
      eventType: supervisor.eventType,
    });
  }

  for (const ev of run.events) {
    const item = projectAgentRunEvent(ev, root);
    items.push({
      ...applyVisibility(access, item),
      sequence: item.sequence,
      title: item.title,
      eventType: item.eventType,
    });
  }

  const pendings = await db.pendingAction.findMany({
    where: { agentRunId: run.id, orgId: access.orgId },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const p of pendings) {
    const proj = projectPendingAction(p);
    if (!proj) continue;
    items.push({
      ...applyVisibility(access, proj),
      sequence: null,
      title: p.title,
      eventType: "approval.pending_action",
    });
  }

  const visibility = visibilityForMode(
    resolveDetailAccessMode(access, root.workspaceId),
  );

  return {
    orgId: access.orgId,
    traceId: root.traceId,
    rootRunId: run.id,
    visibility,
    items,
    aggregate: {
      itemCount: items.length,
      succeeded: items.filter((i) => i.status === "SUCCEEDED").length,
      failed: items.filter((i) => i.status === "FAILED").length,
      waitingApproval: items.filter((i) => i.status === "WAITING_APPROVAL")
        .length,
      totalDurationMs: root.durationMs,
    },
  };
}

/**
 * SkillExecution：禁止裸 id 读取；必须 skill.orgId === access.orgId
 */
export async function getSkillExecutionProjection(
  access: CapabilitiesAccessContext,
  executionId: string,
): Promise<ExecutionProjection> {
  const row = await db.skillExecution.findFirst({
    where: {
      id: executionId,
      skill: { orgId: access.orgId },
    },
    include: {
      skill: { select: { id: true, orgId: true, slug: true, name: true } },
    },
  });
  if (!row) {
    // 伪造他企 id → 404（不泄露存在性）
    throw new CapabilitiesAccessError("SkillExecution 不存在", "NOT_FOUND", 404);
  }
  assertOrgScope(access, row.skill.orgId);
  return applyVisibility(access, projectSkillExecution(row));
}

/**
 * ToolCallTrace：禁止裸 id；必须 project.orgId === access.orgId
 * （ToolCallTrace 无 Prisma Project relation，分步 JOIN）
 */
export async function getToolCallTraceProjection(
  access: CapabilitiesAccessContext,
  traceId: string,
): Promise<ExecutionProjection> {
  const row = await db.toolCallTrace.findFirst({
    where: { id: traceId },
  });
  if (!row) {
    throw new CapabilitiesAccessError("ToolCallTrace 不存在", "NOT_FOUND", 404);
  }
  const project = await db.project.findFirst({
    where: { id: row.projectId, orgId: access.orgId },
    select: { id: true, orgId: true, workspaceId: true },
  });
  if (!project?.orgId) {
    // 他企或无 org → 统一 404
    throw new CapabilitiesAccessError("ToolCallTrace 不存在", "NOT_FOUND", 404);
  }
  assertOrgScope(access, project.orgId);
  const proj = projectToolCallTrace({ ...row, project });
  if (!proj) {
    throw new CapabilitiesAccessError("ToolCallTrace 不存在", "NOT_FOUND", 404);
  }
  return applyVisibility(access, proj);
}

export async function getPendingActionProjection(
  access: CapabilitiesAccessContext,
  pendingId: string,
): Promise<ExecutionProjection> {
  const row = await db.pendingAction.findFirst({
    where: { id: pendingId, orgId: access.orgId },
  });
  if (!row) {
    throw new CapabilitiesAccessError("PendingAction 不存在", "NOT_FOUND", 404);
  }
  const proj = projectPendingAction(row);
  if (!proj) {
    throw new CapabilitiesAccessError("PendingAction 不存在", "NOT_FOUND", 404);
  }
  return applyVisibility(access, proj);
}

/** 列表：当前 org 最近 AgentRun（聚合级默认） */
export async function listRecentAgentRunProjections(
  access: CapabilitiesAccessContext,
  opts?: { limit?: number; since?: Date },
): Promise<ExecutionProjection[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = await db.agentRun.findMany({
    where: {
      orgId: access.orgId,
      ...(opts?.since ? { createdAt: { gte: opts.since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      session: { select: { userId: true, currentProjectId: true } },
    },
  });
  return rows.map((r) => applyVisibility(access, projectAgentRun(r)));
}
