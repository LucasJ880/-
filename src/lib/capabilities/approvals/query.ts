/**
 * 审批中心列表 / 详情查询
 */

import { db } from "@/lib/db";
import type { CapabilitiesAccessContext } from "../types";
import {
  CapabilitiesAccessError,
  isOrgAdminRole,
  isWorkspaceMember,
  resolveDetailAccessMode,
} from "../access";
import { canWorkspaceApprove, getWorkspaceMembership } from "@/lib/tenancy/workspace-rbac";
import {
  projectApprovalRequestApproval,
  projectPendingActionApproval,
  projectProductContentApproval,
} from "./adapters";
import type { ApprovalProjection, ApprovalSourceType } from "./types";
import { parseApprovalId } from "./types";

export const APPROVALS_MAX_PAGE = 100;
export const APPROVALS_DEFAULT_PAGE = 20;
export const APPROVALS_MAX_RANGE_DAYS = 90;

export type ApprovalListFilters = {
  from?: Date;
  to?: Date;
  workspaceId?: string;
  projectId?: string;
  sourceType?: ApprovalSourceType;
  actionType?: string;
  riskLevel?: string;
  status?: string;
  executionStatus?: string;
  submittedById?: string;
  tab?: string; // pending_mine | submitted_by_me | ...
  page?: number;
  pageSize?: number;
};

async function canDecidePending(
  access: CapabilitiesAccessContext,
  row: {
    createdById: string;
    approverUserId: string | null;
    orgId: string | null;
    workspaceId: string | null;
    payload: unknown;
  },
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
): Promise<boolean> {
  if (row.approverUserId && row.approverUserId === access.userId) return true;
  if (!row.approverUserId && row.createdById === access.userId) return true;

  const payload = row.payload as { workspaceId?: string } | null;
  const ws =
    row.workspaceId ??
    (typeof payload?.workspaceId === "string" ? payload.workspaceId : null);

  if (ws) {
    const m = await getWorkspaceMembership({
      userId: access.userId,
      workspaceId: ws,
      orgId: access.orgId,
    });
    if (m && canWorkspaceApprove(m.role, risk)) return true;
    // Org Admin 无 WS membership：默认不能直接批准业务动作
    return false;
  }

  // 无 WS：org_admin 可处理企业级草稿（与既有 team 语义对齐的保守子集）
  return isOrgAdminRole(access.orgRole);
}

function visibilityMode(
  access: CapabilitiesAccessContext,
  workspaceId: string | null | undefined,
): "full" | "metadata" | "aggregate" {
  return resolveDetailAccessMode(access, workspaceId);
}

export async function listCapabilityApprovals(
  access: CapabilitiesAccessContext,
  filters: ApprovalListFilters = {},
): Promise<{
  items: ApprovalProjection[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}> {
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(
    Math.max(filters.pageSize ?? APPROVALS_DEFAULT_PAGE, 1),
    APPROVALS_MAX_PAGE,
  );
  const to = filters.to ?? new Date();
  const from =
    filters.from ?? new Date(to.getTime() - 30 * 86400000);
  if (to.getTime() - from.getTime() > APPROVALS_MAX_RANGE_DAYS * 86400000) {
    throw new CapabilitiesAccessError(
      `时间范围不得超过 ${APPROVALS_MAX_RANGE_DAYS} 天`,
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

  const wantSource = filters.sourceType;
  const items: ApprovalProjection[] = [];

  // PendingAction
  if (!wantSource || wantSource === "PENDING_ACTION") {
    const rows = await db.pendingAction.findMany({
      where: {
        orgId: access.orgId,
        createdAt: { gte: from, lte: to },
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        ...(filters.submittedById
          ? { createdById: filters.submittedById }
          : {}),
        ...(filters.actionType
          ? { type: { contains: filters.actionType } }
          : {}),
        ...(filters.workspaceId
          ? {
              OR: [
                { workspaceId: filters.workspaceId },
                {
                  payload: {
                    path: ["workspaceId"],
                    equals: filters.workspaceId,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    for (const row of rows) {
      const mode = visibilityMode(access, row.workspaceId);
      const canDecide = await canDecidePending(access, row, "MEDIUM");
      const proj = projectPendingActionApproval(row, {
        canDecide,
        visibility: mode,
      });
      if (proj) items.push(proj);
    }
  }

  // ApprovalRequest via project.orgId
  if (!wantSource || wantSource === "APPROVAL_REQUEST") {
    const rows = await db.approvalRequest.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        task: {
          project: {
            orgId: access.orgId,
            ...(filters.projectId ? { id: filters.projectId } : {}),
            ...(filters.workspaceId
              ? { workspaceId: filters.workspaceId }
              : {}),
          },
          ...(filters.submittedById
            ? { createdById: filters.submittedById }
            : {}),
        },
        ...(filters.actionType
          ? { actionType: { contains: filters.actionType } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        task: {
          select: {
            id: true,
            createdById: true,
            project: {
              select: {
                id: true,
                orgId: true,
                workspaceId: true,
                name: true,
              },
            },
          },
        },
        step: { select: { id: true, title: true, skillId: true } },
      },
    });

    for (const row of rows) {
      const ws = row.task.project.workspaceId;
      const mode = visibilityMode(access, ws);
      let canDecide = row.approverUserId === access.userId;
      if (!canDecide && ws) {
        const m = await getWorkspaceMembership({
          userId: access.userId,
          workspaceId: ws,
          orgId: access.orgId,
        });
        canDecide = !!(m && canWorkspaceApprove(m.role, "HIGH"));
      }
      const proj = projectApprovalRequestApproval(row, {
        canDecide,
        visibility: mode,
      });
      if (proj) items.push(proj);
    }
  }

  // Product Content
  if (!wantSource || wantSource === "PRODUCT_CONTENT") {
    const rows = await db.productContentApproval.findMany({
      where: {
        orgId: access.orgId,
        createdAt: { gte: from, lte: to },
        ...(filters.submittedById
          ? { requestedById: filters.submittedById }
          : {}),
        ...(filters.actionType
          ? { actionKey: { contains: filters.actionType } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    for (const row of rows) {
      const mode = visibilityMode(access, null);
      const canDecide =
        isOrgAdminRole(access.orgRole) ||
        row.requestedById === access.userId;
      items.push(
        projectProductContentApproval(row, { canDecide, visibility: mode }),
      );
    }
  }

  // 服务端筛选：状态 / 风险 / tab
  let filtered = items;
  if (filters.status) {
    filtered = filtered.filter((i) => i.status === filters.status);
  }
  if (filters.riskLevel) {
    filtered = filtered.filter((i) => i.riskLevel === filters.riskLevel);
  }
  if (filters.executionStatus) {
    filtered = filtered.filter(
      (i) => i.executionStatus === filters.executionStatus,
    );
  }

  const tab = filters.tab ?? "pending_mine";
  if (tab === "pending_mine") {
    filtered = filtered.filter(
      (i) => i.status === "PENDING" && i.capabilities.canApprove,
    );
  } else if (tab === "submitted_by_me") {
    filtered = filtered.filter((i) => i.submittedById === access.userId);
  } else if (tab === "processing") {
    filtered = filtered.filter(
      (i) => i.status === "APPROVED" || i.status === "EXECUTING",
    );
  } else if (tab === "approved") {
    filtered = filtered.filter((i) => i.status === "APPROVED");
  } else if (tab === "rejected") {
    filtered = filtered.filter((i) => i.status === "REJECTED");
  } else if (tab === "executed") {
    filtered = filtered.filter((i) => i.status === "EXECUTED");
  } else if (tab === "execution_failed") {
    filtered = filtered.filter(
      (i) =>
        i.status === "EXECUTION_FAILED" || i.status === "EXECUTION_BLOCKED",
    );
  } else if (tab === "expired") {
    filtered = filtered.filter((i) => i.status === "EXPIRED");
  }

  // 非 org_admin：过滤不可见 WS
  if (!isOrgAdminRole(access.orgRole)) {
    filtered = filtered.filter((i) => {
      if (!i.workspaceId) {
        return (
          i.submittedById === access.userId ||
          i.assignedApproverIds?.includes(access.userId)
        );
      }
      return (
        isWorkspaceMember(access, i.workspaceId) ||
        i.submittedById === access.userId ||
        i.assignedApproverIds?.includes(access.userId)
      );
    });
  }

  filtered.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  };
}

export async function getCapabilityApproval(
  access: CapabilitiesAccessContext,
  approvalId: string,
): Promise<ApprovalProjection> {
  const parsed = parseApprovalId(approvalId);
  if (!parsed) {
    throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
  }

  if (parsed.sourceType === "PENDING_ACTION") {
    const row = await db.pendingAction.findFirst({
      where: { id: parsed.sourceId, orgId: access.orgId },
    });
    if (!row) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }
    const mode = visibilityMode(access, row.workspaceId);
    const canDecide = await canDecidePending(access, row, "MEDIUM");
    const proj = projectPendingActionApproval(row, {
      canDecide,
      visibility: mode,
    });
    if (!proj) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }
    return proj;
  }

  if (parsed.sourceType === "APPROVAL_REQUEST") {
    const row = await db.approvalRequest.findFirst({
      where: {
        id: parsed.sourceId,
        task: { project: { orgId: access.orgId } },
      },
      include: {
        task: {
          select: {
            id: true,
            createdById: true,
            project: {
              select: {
                id: true,
                orgId: true,
                workspaceId: true,
                name: true,
              },
            },
          },
        },
        step: { select: { id: true, title: true, skillId: true } },
      },
    });
    if (!row) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }
    const ws = row.task.project.workspaceId;
    const mode = visibilityMode(access, ws);
    let canDecide = row.approverUserId === access.userId;
    if (!canDecide && ws) {
      const m = await getWorkspaceMembership({
        userId: access.userId,
        workspaceId: ws,
        orgId: access.orgId,
      });
      canDecide = !!(m && canWorkspaceApprove(m.role, "HIGH"));
    }
    const proj = projectApprovalRequestApproval(row, {
      canDecide,
      visibility: mode,
    });
    if (!proj) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }
    return proj;
  }

  if (parsed.sourceType === "PRODUCT_CONTENT") {
    const row = await db.productContentApproval.findFirst({
      where: { id: parsed.sourceId, orgId: access.orgId },
    });
    if (!row) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }
    const mode = visibilityMode(access, null);
    const canDecide =
      isOrgAdminRole(access.orgRole) ||
      row.requestedById === access.userId;
    return projectProductContentApproval(row, {
      canDecide,
      visibility: mode,
    });
  }

  throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
}
