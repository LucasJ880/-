import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  isValidProjectMemberRole,
  DEFAULT_NEW_PROJECT_MEMBER_ROLE,
} from "@/lib/projects/members-utils";
import { onMemberJoined } from "@/lib/project-discussion/system-events";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project } = access;

  const members = await db.projectMember.findMany({
    where: { projectId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          nickname: true,
          avatar: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  let orgRoleByUserId = new Map<string, string>();
  if (project.orgId) {
    const orgMembers = await db.organizationMember.findMany({
      where: {
        orgId: project.orgId,
        userId: { in: members.map((m) => m.userId) },
        status: "active",
      },
    });
    orgRoleByUserId = new Map(orgMembers.map((m) => [m.userId, m.role]));
  }

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt,
      user: m.user,
      orgRole: project.orgId ? orgRoleByUserId.get(m.userId) ?? null : null,
    })),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json();
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const role =
    typeof body.role === "string" && body.role.trim()
      ? body.role.trim()
      : DEFAULT_NEW_PROJECT_MEMBER_ROLE;

  if (!userId) {
    return NextResponse.json({ error: "userId 必填" }, { status: 400 });
  }

  if (!isValidProjectMemberRole(role)) {
    return NextResponse.json({ error: "无效的项目角色" }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target || target.status !== "active") {
    return NextResponse.json({ error: "用户不存在或已停用" }, { status: 404 });
  }

  if (project.orgId) {
    const om = await getOrgMembership(userId, project.orgId);
    if (!om || om.status !== "active") {
      return NextResponse.json(
        { error: "该用户须先加入所属组织后，才能加入项目" },
        { status: 403 }
      );
    }
  }

  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });

  if (existing) {
    if (existing.status === "active") {
      return NextResponse.json({ error: "该用户已是项目成员" }, { status: 409 });
    }
    const updated = await db.$transaction(async (tx) => {
      const m = await tx.projectMember.update({
        where: { id: existing.id },
        data: { role, status: "active" },
        include: {
          user: { select: { id: true, email: true, name: true, nickname: true, avatar: true, status: true } },
        },
      });
      await onMemberJoined(projectId, m.user.name, m.role, user.id, m.userId, tx);
      return m;
    });
    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.CREATE,
      targetType: AUDIT_TARGETS.PROJECT_MEMBER,
      targetId: updated.id,
      afterData: { userId, role: updated.role, status: updated.status },
      request,
    });
    return NextResponse.json(
      {
        member: {
          id: updated.id,
          userId: updated.userId,
          role: updated.role,
          status: updated.status,
          user: updated.user,
        },
      },
      { status: 201 }
    );
  }

  const created = await db.$transaction(async (tx) => {
    const m = await tx.projectMember.create({
      data: { projectId, userId, role, status: "active" },
      include: {
        user: { select: { id: true, email: true, name: true, nickname: true, avatar: true, status: true } },
      },
    });
    await onMemberJoined(projectId, m.user.name, m.role, user.id, m.userId, tx);
    return m;
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROJECT_MEMBER,
    targetId: created.id,
    afterData: { userId, role: created.role },
    request,
  });

  return NextResponse.json(
    {
      member: {
        id: created.id,
        userId: created.userId,
        role: created.role,
        status: created.status,
        user: created.user,
      },
    },
    { status: 201 }
  );
}
