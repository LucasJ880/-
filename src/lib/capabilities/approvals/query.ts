/**
 * 审批中心列表 / 详情查询
 *
 * VIS-1d（spec approvals/visibility，design D6）：岗位模式企业按审批的可见集合过滤，
 * PendingAction 在查询里过滤；详情不可见与不存在同一个 404。旧模式企业列表沿用原规则。
 */

import { db } from "@/lib/db";
import type { CapabilitiesAccessContext } from "../types";
import {
  CapabilitiesAccessError,
  isOrgAdminRole,
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
import {
  approvalRequestItem,
  isApprovalVisible,
  isLegacyOrg,
  legacyListVisible,
  pendingActionAudienceWhere,
  pendingActionItem,
  productContentItem,
  type ApprovalViewer,
} from "@/lib/approval/audience";
import { loadApprovalViewer } from "@/lib/approval/audience-server";

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

/** 调用方不传时按当前用户与企业取（审批中心路由、概览、首页岗位总览不改调用形状） */
async function viewerFor(access: CapabilitiesAccessContext, viewer?: ApprovalViewer): Promise<ApprovalViewer> {
  return viewer ?? loadApprovalViewer(access.userId, access.orgId);
}

const notFound = () => new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);

export async function listCapabilityApprovals(
  access: CapabilitiesAccessContext,
  filters: ApprovalListFilters = {},
  viewerInput?: ApprovalViewer,
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
  const viewer = await viewerFor(access, viewerInput);
  // 旧模式企业：列表沿用原规则（见文末）；岗位模式：按可见集合
  const legacy = isLegacyOrg(viewer);
  const visible = (item: Parameters<typeof isApprovalVisible>[0]) => legacy || isApprovalVisible(item, viewer);

  // PendingAction
  if (!wantSource || wantSource === "PENDING_ACTION") {
    const rows = await db.pendingAction.findMany({
      where: {
        ...(legacy ? {} : { AND: [pendingActionAudienceWhere(viewer)] }),
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
      if (!visible(approvalRequestItem(row))) continue;
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
      if (!visible(productContentItem(row))) continue;
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

  // 旧模式企业的原规则：org_owner / org_admin 看全企业，其余只见本人提交、本人为指定审批人或本人所在工作区的。
  // 判定输入取审批中心自己的访问上下文（与改动前同源）。
  if (legacy) {
    const legacyViewer: ApprovalViewer = {
      ...viewer,
      isOrgAdminRole: isOrgAdminRole(access.orgRole),
      workspaceIds: access.workspaceIds,
    };
    filtered = filtered.filter((i) =>
      legacyListVisible(
        {
          createdById: i.submittedById ?? null,
          approverUserId: i.assignedApproverIds?.includes(access.userId) ? access.userId : null,
          workspaceId: i.workspaceId ?? null,
        },
        legacyViewer,
      ),
    );
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
  viewerInput?: ApprovalViewer,
): Promise<ApprovalProjection> {
  const parsed = parseApprovalId(approvalId);
  if (!parsed) {
    throw notFound();
  }
  const viewer = await viewerFor(access, viewerInput);

  if (parsed.sourceType === "PENDING_ACTION") {
    const row = await db.pendingAction.findFirst({
      where: { id: parsed.sourceId, orgId: access.orgId },
    });
    // 不可见与不存在同一个错误（批准 / 驳回 / 撤回 / 重试都经这里加载）
    if (!row || !isApprovalVisible(pendingActionItem(row), viewer)) {
      throw notFound();
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
    if (!row || !isApprovalVisible(approvalRequestItem(row), viewer)) {
      throw notFound();
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
    if (!row || !isApprovalVisible(productContentItem(row), viewer)) {
      throw notFound();
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
