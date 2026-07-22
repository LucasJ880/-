/**
 * Phase 3A-2：运行中心列表查询
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CapabilitiesAccessContext, ExecutionStatus } from "../types";
import {
  CapabilitiesAccessError,
  isOrgAdminRole,
  resolveDetailAccessMode,
  visibilityForMode,
} from "../access";
import { projectAgentRun } from "../adapters/agent-run";
import { redactProjection } from "../visibility";
import { mapAgentRunStatus } from "../execution-status";
import { USAGE_MAX_RANGE_DAYS } from "../usage/query";

export const RUNS_DEFAULT_PAGE_SIZE = 20;
export const RUNS_MAX_PAGE_SIZE = 100;

export type RunListFilters = {
  from?: Date;
  to?: Date;
  workspaceId?: string;
  projectId?: string;
  status?: string;
  executionType?: string;
  agent?: string;
  skill?: string;
  tool?: string;
  userId?: string;
  model?: string;
  hasError?: boolean;
  waitingApproval?: boolean;
  page?: number;
  pageSize?: number;
};

export type RunListItem = {
  runId: string;
  traceId: string | null;
  startedAt: Date | null;
  status: ExecutionStatus;
  executionType: string;
  agentOrSkill: string | null;
  workspaceId: string | null;
  projectId: string | null;
  userId: string | null;
  model: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  currency: string | null;
  toolCallCount: number;
  waitingApproval: boolean;
  hasError: boolean;
  visibility: string;
};

function clampPageSize(n: number | undefined): number {
  const v = n ?? RUNS_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(v, 1), RUNS_MAX_PAGE_SIZE);
}

export async function listCapabilityRuns(
  access: CapabilitiesAccessContext,
  filters: RunListFilters = {},
): Promise<{
  items: RunListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}> {
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = clampPageSize(filters.pageSize);
  const to = filters.to ?? new Date();
  const from =
    filters.from ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (to.getTime() - from.getTime() > USAGE_MAX_RANGE_DAYS * 86400000) {
    throw new CapabilitiesAccessError(
      `时间范围不得超过 ${USAGE_MAX_RANGE_DAYS} 天`,
      "FORBIDDEN",
      403,
    );
  }

  if (
    filters.workspaceId &&
    !isOrgAdminRole(access.orgRole) &&
    !access.workspaceIds.includes(filters.workspaceId)
  ) {
    throw new CapabilitiesAccessError("无 Workspace 权限", "FORBIDDEN", 403);
  }

  const statusFilter = filters.status
    ? mapUiStatusToDb(filters.status)
    : undefined;

  const where: Prisma.AgentRunWhereInput = {
    orgId: access.orgId,
    createdAt: { gte: from, lte: to },
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.hasError === true
      ? { OR: [{ errorCode: { not: null } }, { status: "failed" }] }
      : {}),
    ...(filters.waitingApproval === true
      ? { status: "waiting_for_approval" }
      : {}),
    ...(filters.userId
      ? { session: { userId: filters.userId } }
      : {}),
    ...(filters.projectId
      ? {
          OR: [
            { session: { currentProjectId: filters.projectId } },
            {
              metadata: {
                path: ["projectId"],
                equals: filters.projectId,
              },
            },
          ],
        }
      : {}),
    ...(filters.agent
      ? { runType: { contains: filters.agent, mode: "insensitive" } }
      : {}),
  };

  // 非 org_admin：限制可见会话用户或 metadata.workspace
  if (!isOrgAdminRole(access.orgRole)) {
    where.AND = [
      {
        OR: [
          { session: { userId: access.userId } },
          ...(access.workspaceIds.length
            ? access.workspaceIds.map((ws) => ({
                metadata: { path: ["workspaceId"], equals: ws },
              }))
            : []),
        ],
      },
    ];
  } else if (filters.workspaceId) {
    where.AND = [
      {
        metadata: {
          path: ["workspaceId"],
          equals: filters.workspaceId,
        },
      },
    ];
  }

  const [total, rows] = await Promise.all([
    db.agentRun.count({ where }),
    db.agentRun.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        session: { select: { userId: true, currentProjectId: true } },
        events: {
          where: {
            OR: [
              { eventType: { contains: "tool" } },
              { eventType: { contains: "skill" } },
            ],
          },
          select: { id: true, eventType: true },
          take: 100,
        },
        _count: {
          select: {
            events: true,
          },
        },
      },
    }),
  ]);

  const runIds = rows.map((r) => r.id);
  const traceIds = rows.map((r) => r.traceId).filter(Boolean) as string[];

  const ledgerRows =
    runIds.length === 0
      ? []
      : await db.aiUsageLedger.findMany({
          where: {
            orgId: access.orgId,
            OR: [
              { runId: { in: runIds } },
              ...(traceIds.length ? [{ traceId: { in: traceIds } }] : []),
            ],
          },
          select: {
            runId: true,
            traceId: true,
            costAmount: true,
            inputTokens: true,
            outputTokens: true,
          },
          take: 5000,
        });

  const costByRun = new Map<
    string,
    { cost: number; tokens: number; count: number }
  >();
  const runIdByTrace = new Map(
    rows.filter((r) => r.traceId).map((r) => [r.traceId!, r.id]),
  );
  for (const g of ledgerRows) {
    const rid = g.runId ?? (g.traceId ? runIdByTrace.get(g.traceId) : null);
    if (!rid) continue;
    const cur = costByRun.get(rid) ?? { cost: 0, tokens: 0, count: 0 };
    cur.cost += Number(g.costAmount.toString());
    cur.tokens += (g.inputTokens ?? 0) + (g.outputTokens ?? 0);
    cur.count += 1;
    costByRun.set(rid, cur);
  }

  // skill/tool 文本筛选（事件级，后过滤）
  let filtered = rows;
  if (filters.skill) {
    const s = filters.skill.toLowerCase();
    filtered = filtered.filter((r) =>
      r.events.some((e) => e.eventType.toLowerCase().includes(s)),
    );
  }
  if (filters.tool) {
    const t = filters.tool.toLowerCase();
    filtered = filtered.filter((r) =>
      r.events.some((e) => e.eventType.toLowerCase().includes(t)),
    );
  }
  if (filters.executionType && filters.executionType !== "AGENT") {
    // 主轴为 AgentRun；其他类型在 3A-2 列表弱化为空
    if (filters.executionType !== "WORKFLOW") {
      filtered = [];
    }
  }

  const pendingCounts = await db.pendingAction.groupBy({
    by: ["agentRunId"],
    where: {
      orgId: access.orgId,
      agentRunId: { in: filtered.map((r) => r.id) },
      status: "pending",
    },
    _count: true,
  });
  const pendingByRun = new Map(
    pendingCounts.map((p) => [p.agentRunId!, p._count]),
  );

  const items: RunListItem[] = filtered.map((r) => {
    const proj = projectAgentRun(r);
    const mode = resolveDetailAccessMode(access, proj.workspaceId);
    const visibility = visibilityForMode(mode);
    const redacted = redactProjection(proj, visibility, {
      isWorkspaceMember: mode === "full",
      isOrgAdmin: isOrgAdminRole(access.orgRole),
    });
    const costs = costByRun.get(r.id);
    const toolCallCount = r.events.filter((e) =>
      e.eventType.toLowerCase().includes("tool"),
    ).length;

    return {
      runId: r.id,
      traceId: redacted.traceId,
      startedAt: redacted.startedAt,
      status: redacted.status,
      executionType: redacted.executionType,
      agentOrSkill: redacted.capabilityKey,
      workspaceId: redacted.workspaceId,
      projectId: redacted.projectId,
      userId: redacted.userId,
      model: mode === "aggregate" ? null : redacted.modelName,
      durationMs: redacted.durationMs,
      totalTokens: costs?.tokens ?? null,
      totalCost: costs?.cost ?? null,
      currency: costs ? "USD" : null,
      toolCallCount,
      waitingApproval:
        redacted.status === "WAITING_APPROVAL" ||
        (pendingByRun.get(r.id) ?? 0) > 0,
      hasError: Boolean(redacted.errorCode) || redacted.status === "FAILED",
      visibility,
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  };
}

function mapUiStatusToDb(status: string): string[] {
  const s = status.toUpperCase();
  const map: Record<string, string[]> = {
    QUEUED: ["queued"],
    RUNNING: ["running", "claimed"],
    WAITING_APPROVAL: ["waiting_for_approval"],
    SUCCEEDED: ["completed", "succeeded"],
    FAILED: ["failed"],
    CANCELLED: ["cancelled"],
    TIMED_OUT: ["timed_out", "timeout"],
    PARTIAL: ["partial"],
  };
  return map[s] ?? [status.toLowerCase()];
}
