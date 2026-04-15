import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";
import type { IntakeStatusFilter } from "@/lib/projects/visibility";
import { onProjectCreated } from "@/lib/project-discussion/system-events";

const projectInclude = {
  owner: { select: { id: true, name: true } },
  _count: { select: { tasks: true, environments: true } },
} as const;

export const GET = withAuth(async (request, _ctx, user) => {
  const intakeFilter = (request.nextUrl.searchParams.get("intakeStatus") ?? "all") as IntakeStatusFilter;

  const where = await buildProjectVisibilityWhere(user, {
    intakeStatusFilter: intakeFilter,
  });

  const take = Math.min(
    parseInt(request.nextUrl.searchParams.get("take") ?? "50", 10) || 50,
    200
  );

  const projects = await db.project.findMany({
    where: where ?? undefined,
    include: projectInclude,
    orderBy: { createdAt: "desc" },
    take,
  });

  return NextResponse.json(projects);
});

/**
 * POST：创建项目 + 创建者 project_admin + 默认 test / prod 环境（同一事务）
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();

  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) {
    return NextResponse.json(
      { error: "必须指定所属组织 orgId" },
      { status: 400 }
    );
  }

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  if (org.status !== "active") {
    return NextResponse.json(
      { error: "组织已归档或不可用，无法新建项目" },
      { status: 403 }
    );
  }

  if (!isSuperAdmin(user.role)) {
    const om = await getOrgMembership(user.id, orgId);
    if (!om || om.status !== "active") {
      return NextResponse.json({ error: "无权在该组织下创建项目" }, { status: 403 });
    }
    if (!hasOrgRole(om.role, "org_member")) {
      return NextResponse.json(
        { error: "组织观察员不能创建项目" },
        { status: 403 }
      );
    }
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  }

  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name,
        description: body.description || null,
        color: body.color || "#3B82F6",
        ownerId: user.id,
        orgId,
        members: {
          create: {
            userId: user.id,
            role: "project_admin",
            status: "active",
          },
        },
        environments: {
          create: [
            {
              name: "测试环境",
              code: "test",
              status: "active",
            },
            {
              name: "正式环境",
              code: "prod",
              status: "active",
            },
          ],
        },
      },
      include: projectInclude,
    });
    await onProjectCreated(p.id, p.name, user.id, user.name, tx);
    return p;
  });

  await logAudit({
    userId: user.id,
    orgId,
    projectId: project.id,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: project.id,
    afterData: {
      id: project.id,
      name: project.name,
      orgId,
      defaultEnvironments: ["test", "prod"],
    },
    request,
  });

  return NextResponse.json(project, { status: 201 });
});
