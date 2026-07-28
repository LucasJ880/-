/**
 * GET/PATCH /api/ops/projects/[id]
 * 强制 workDomain=delivery；白名单字段更新
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { PROJECT_WORK_DOMAIN } from "@/lib/projects/work-domain";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import {
  canAccessOperationsWorkspace,
  type WorkspacePolicyContext,
} from "@/lib/rbac/workspace-policy";
import {
  canCancelOrHoldDelivery,
  canEditOwnedDeliveryProject,
  canManageDeliveryProjects,
  canReopenCompletedDelivery,
  canViewDeliveryProject,
  getDeliveryProjectDetail,
  normalizeDeliveryStage,
  transitionDeliveryStage,
  type OpsAccessContext,
} from "@/lib/operations/projects";

async function resolveOrgRole(
  userId: string,
  orgId: string | null,
): Promise<string | null> {
  if (!orgId) return null;
  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true, status: true },
  });
  return member?.status === "active" ? member.role : null;
}

async function buildOpsCtx(
  user: { id: string; role: string },
  orgId: string,
): Promise<{ wsCtx: WorkspacePolicyContext; opsCtx: OpsAccessContext }> {
  const orgRole = await resolveOrgRole(user.id, orgId);
  const wsCtx: WorkspacePolicyContext = {
    platformRole: user.role,
    orgRole,
    hasMembership: Boolean(orgRole),
  };
  return { wsCtx, opsCtx: { ...wsCtx, userId: user.id } };
}

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const resolved = await resolvePreferredOrgId(user.id, user.role);
  if (!resolved.orgId) {
    return NextResponse.json(
      { error: "请先选择企业", code: "ORG_REQUIRED" },
      { status: 400 },
    );
  }

  const { wsCtx, opsCtx } = await buildOpsCtx(user, resolved.orgId);
  if (!canAccessOperationsWorkspace(wsCtx)) {
    return NextResponse.json(
      { error: "无权访问运营中心", code: "OPS_FORBIDDEN" },
      { status: 403 },
    );
  }

  // 非 delivery / 跨组织：404，避免泄漏 tender/general
  const exists = await db.project.findFirst({
    where: {
      id,
      orgId: resolved.orgId,
      workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
    },
    select: {
      ownerId: true,
      members: {
        where: { status: "active" },
        select: { userId: true },
      },
    },
  });

  if (!exists) {
    return NextResponse.json(
      { error: "执行项目不存在", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const memberUserIds = exists.members.map((m) => m.userId);
  if (
    !canViewDeliveryProject(opsCtx, {
      ownerId: exists.ownerId,
      memberUserIds,
    })
  ) {
    return NextResponse.json(
      { error: "无权查看该执行项目", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const deliveryRow = await db.project.findFirst({
    where: {
      id,
      orgId: resolved.orgId,
      workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
    },
    select: { sourceTenderProjectId: true },
  });
  let canReadSourceTender = false;
  if (deliveryRow?.sourceTenderProjectId) {
    const visible = await getVisibleProjectIds(user.id, user.role);
    canReadSourceTender =
      visible === null ||
      visible.includes(deliveryRow.sourceTenderProjectId);
  }

  const detail = await getDeliveryProjectDetail({
    orgId: resolved.orgId,
    projectId: id,
    ctx: opsCtx,
    canManage: canManageDeliveryProjects(opsCtx),
    canReopenCompleted: canReopenCompletedDelivery(opsCtx),
    canReadSourceTender,
  });

  if (!detail) {
    return NextResponse.json(
      { error: "执行项目不存在", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json(detail);
});

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const resolved = await resolvePreferredOrgId(user.id, user.role);
  if (!resolved.orgId) {
    return NextResponse.json(
      { error: "请先选择企业", code: "ORG_REQUIRED" },
      { status: 400 },
    );
  }

  const { wsCtx, opsCtx } = await buildOpsCtx(user, resolved.orgId);
  if (!canAccessOperationsWorkspace(wsCtx)) {
    return NextResponse.json(
      { error: "无权访问运营中心", code: "OPS_FORBIDDEN" },
      { status: 403 },
    );
  }

  const project = await db.project.findFirst({
    where: {
      id,
      orgId: resolved.orgId,
      workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
    },
    select: {
      id: true,
      orgId: true,
      ownerId: true,
      workDomain: true,
      deliveryStage: true,
      members: {
        where: { status: "active" },
        select: { userId: true },
      },
    },
  });

  if (!project) {
    return NextResponse.json(
      { error: "执行项目不存在", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const memberUserIds = project.members.map((m) => m.userId);
  const canEdit = canEditOwnedDeliveryProject(opsCtx, {
    ownerId: project.ownerId,
    memberUserIds,
  });
  if (!canEdit) {
    return NextResponse.json(
      { error: "无权修改该执行项目", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));

  // 禁止字段
  const forbidden = [
    "workDomain",
    "tenderStatus",
    "estimatedValue",
    "ourBidPrice",
    "winningBidPrice",
    "closeDate",
    "awardDate",
    "solicitationNumber",
    "sourceSystem",
    "intakeStatus",
  ] as const;
  for (const key of forbidden) {
    if (key in body) {
      return NextResponse.json(
        { error: `不允许通过执行项目 API 修改 ${key}`, code: "FIELD_FORBIDDEN" },
        { status: 400 },
      );
    }
  }

  const data: {
    name?: string;
    description?: string | null;
    clientOrganization?: string | null;
    ownerId?: string;
    plannedCompletionDate?: Date | null;
  } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
    }
    data.name = name;
  }

  if ("description" in body) {
    data.description =
      typeof body.description === "string"
        ? body.description.trim() || null
        : null;
  }

  if ("clientOrganization" in body || "clientName" in body) {
    const client =
      typeof body.clientOrganization === "string"
        ? body.clientOrganization.trim()
        : typeof body.clientName === "string"
          ? body.clientName.trim()
          : "";
    data.clientOrganization = client || null;
  }

  if ("ownerId" in body) {
    if (!canManageDeliveryProjects(opsCtx)) {
      return NextResponse.json(
        { error: "无权重新分配负责人", code: "FORBIDDEN" },
        { status: 403 },
      );
    }
    const ownerId = String(body.ownerId || "").trim();
    if (!ownerId) {
      return NextResponse.json({ error: "负责人无效" }, { status: 400 });
    }
    const owner = await db.user.findUnique({
      where: { id: ownerId },
      select: { id: true },
    });
    if (!owner) {
      return NextResponse.json({ error: "负责人不存在" }, { status: 400 });
    }
    data.ownerId = ownerId;
  }

  if ("plannedCompletionDate" in body) {
    if (body.plannedCompletionDate == null || body.plannedCompletionDate === "") {
      data.plannedCompletionDate = null;
    } else {
      const d = new Date(String(body.plannedCompletionDate));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "计划完成日期无效" },
          { status: 400 },
        );
      }
      data.plannedCompletionDate = d;
    }
  }

  const stageRaw =
    typeof body.deliveryStage === "string" ? body.deliveryStage : null;

  try {
    await db.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.project.update({
          where: { id: project.id },
          data,
        });
      }

      if (stageRaw) {
        const next = normalizeDeliveryStage(stageRaw);
        if (!next) throw new Error(`非法 deliveryStage: ${stageRaw}`);

        if (
          (next === "cancelled" || next === "on_hold") &&
          !canCancelOrHoldDelivery(opsCtx)
        ) {
          throw new Error("无权暂停或取消项目");
        }

        if (
          project.deliveryStage === "completed" &&
          next !== "completed" &&
          !canReopenCompletedDelivery(opsCtx)
        ) {
          throw new Error("从已完成恢复需要更高权限");
        }

        if (!canManageDeliveryProjects(opsCtx) && next !== project.deliveryStage) {
          // 普通负责人可在主流程内推进，但不能 cancel/hold/reopen（已上方拦截）
          if (next === "cancelled" || next === "on_hold") {
            throw new Error("无权暂停或取消项目");
          }
        }

        await transitionDeliveryStage({
          project: {
            id: project.id,
            orgId: project.orgId,
            workDomain: project.workDomain,
            deliveryStage: project.deliveryStage,
          },
          nextStage: next,
          actor: {
            userId: user.id,
            allowReopenCompleted: canReopenCompletedDelivery(opsCtx),
          },
          client: tx,
        });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "更新失败";
    const status =
      msg.includes("无权") || msg.includes("更高权限") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const detail = await getDeliveryProjectDetail({
    orgId: resolved.orgId,
    projectId: id,
    ctx: opsCtx,
    canManage: canManageDeliveryProjects(opsCtx),
    canReopenCompleted: canReopenCompletedDelivery(opsCtx),
  });

  return NextResponse.json(detail);
});
