/**
 * GET/POST /api/ops/projects
 * 强制 workDomain=delivery
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { onProjectCreated } from "@/lib/project-discussion/system-events";
import { PROJECT_WORK_DOMAIN } from "@/lib/projects/work-domain";
import {
  canAccessOperationsWorkspace,
  type WorkspacePolicyContext,
} from "@/lib/rbac/workspace-policy";
import {
  canManageDeliveryProjects,
  canViewAllDeliveryProjects,
  clampDeliveryPageSize,
  listDeliveryProjects,
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
  return {
    wsCtx,
    opsCtx: { ...wsCtx, userId: user.id },
  };
}

export const GET = withAuth(async (request, _ctx, user) => {
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

  const sp = request.nextUrl.searchParams;
  const viewParam = sp.get("view");
  const wantTeam = viewParam === "team";
  const canTeam = canViewAllDeliveryProjects(opsCtx);
  if (wantTeam && !canTeam) {
    return NextResponse.json(
      { error: "无权查看团队执行项目", code: "TEAM_VIEW_FORBIDDEN" },
      { status: 403 },
    );
  }

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = clampDeliveryPageSize(
    Number(sp.get("pageSize") || sp.get("limit") || 20),
  );

  const result = await listDeliveryProjects({
    orgId: resolved.orgId,
    ctx: opsCtx,
    filters: {
      search: sp.get("search") || sp.get("q"),
      stage: sp.get("stage"),
      ownerId: sp.get("ownerId"),
      health: sp.get("health"),
      due: sp.get("due"),
      view: wantTeam && canTeam ? "team" : "mine",
      page,
      pageSize,
    },
  });

  return NextResponse.json({
    ...result,
    view: wantTeam && canTeam ? "team" : "mine",
    canToggleTeamView: canTeam,
  });
});

export const POST = withAuth(async (request, _ctx, user) => {
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

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  }

  const clientOrganization =
    typeof body.clientOrganization === "string"
      ? body.clientOrganization.trim() || null
      : typeof body.clientName === "string"
        ? body.clientName.trim() || null
        : null;
  if (!clientOrganization) {
    return NextResponse.json(
      { error: "请填写客户名称" },
      { status: 400 },
    );
  }

  const ownerId =
    typeof body.ownerId === "string" && body.ownerId.trim()
      ? body.ownerId.trim()
      : user.id;

  if (ownerId !== user.id && !canManageDeliveryProjects(opsCtx)) {
    return NextResponse.json(
      { error: "无权指定其他负责人为项目负责人" },
      { status: 403 },
    );
  }

  const owner = await db.user.findUnique({
    where: { id: ownerId },
    select: { id: true },
  });
  if (!owner) {
    return NextResponse.json({ error: "负责人不存在" }, { status: 400 });
  }

  let plannedCompletionDate: Date | null = null;
  if (body.plannedCompletionDate) {
    const d = new Date(String(body.plannedCompletionDate));
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "计划完成日期无效" },
        { status: 400 },
      );
    }
    plannedCompletionDate = d;
  }

  const description =
    typeof body.description === "string" ? body.description.trim() || null : null;

  // 拒绝通过 payload 改写工作域 / 投标字段
  if (
    body.workDomain != null &&
    String(body.workDomain).toLowerCase() !== PROJECT_WORK_DOMAIN.DELIVERY
  ) {
    return NextResponse.json(
      { error: "执行项目 API 不允许设置非 delivery 工作域" },
      { status: 400 },
    );
  }

  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name,
        description,
        clientOrganization,
        ownerId,
        orgId: resolved.orgId,
        workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
        deliveryStage: "handoff",
        plannedCompletionDate,
        status: "active",
        color: "#0F766E",
        members: {
          create: {
            userId: ownerId,
            role: "project_admin",
            status: "active",
          },
        },
        environments: {
          create: [
            { name: "测试环境", code: "test", status: "active" },
            { name: "正式环境", code: "prod", status: "active" },
          ],
        },
      },
      select: {
        id: true,
        name: true,
        workDomain: true,
        deliveryStage: true,
        clientOrganization: true,
        ownerId: true,
        plannedCompletionDate: true,
        orgId: true,
      },
    });

    if (ownerId !== user.id) {
      await tx.projectMember.upsert({
        where: {
          projectId_userId: { projectId: p.id, userId: user.id },
        },
        create: {
          projectId: p.id,
          userId: user.id,
          role: "project_admin",
          status: "active",
        },
        update: { status: "active" },
      });
    }

    await onProjectCreated(p.id, p.name, user.id, user.name, tx);
    return p;
  });

  await logAudit({
    userId: user.id,
    orgId: resolved.orgId,
    projectId: project.id,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: project.id,
    afterData: {
      id: project.id,
      name: project.name,
      workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
      deliveryStage: "handoff",
      clientOrganization,
    },
    request,
  });

  return NextResponse.json(project, { status: 201 });
});
