import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

const projectInclude = {
  owner: { select: { id: true, name: true } },
  _count: { select: { tasks: true, environments: true } },
} as const;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (isSuperAdmin(user.role)) {
    const projects = await db.project.findMany({
      include: projectInclude,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(projects);
  }

  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
  });
  const orgIds = memberships.map((m) => m.orgId);

  const projects = await db.project.findMany({
    where: {
      OR: [
        { ownerId: user.id, orgId: null },
        ...(orgIds.length ? [{ orgId: { in: orgIds } }] : []),
        {
          members: {
            some: { userId: user.id, status: "active" },
          },
        },
      ],
    },
    include: projectInclude,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(projects);
}

/**
 * POST：创建项目 + 创建者 project_admin + 默认 test / prod 环境（同一事务）
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

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
}
