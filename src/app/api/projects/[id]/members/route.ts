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
import {
  dutyToMemberRole,
  isValidProjectDuty,
  resolveProjectDuty,
  type ProjectDuty,
} from "@/lib/projects/duty";
import { onMemberJoined } from "@/lib/project-discussion/system-events";
import { syncProjectMilestoneCalendars } from "@/lib/projects/sync-milestone-calendar";

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
    ownerId: project.ownerId,
    purchaserId: project.purchaserId ?? null,
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      duty: resolveProjectDuty(m.userId, project.ownerId, project.purchaserId),
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

  let duty: ProjectDuty | null = null;
  if (body.duty !== undefined) {
    if (!isValidProjectDuty(String(body.duty))) {
      return NextResponse.json({ error: "无效的项目身份" }, { status: 400 });
    }
    duty = body.duty as ProjectDuty;
  }

  const role =
    duty
      ? dutyToMemberRole(duty)
      : typeof body.role === "string" && body.role.trim()
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

  const member = await db.$transaction(async (tx) => {
    let m;
    if (existing) {
      if (existing.status === "active") {
        throw new Error("ALREADY_MEMBER");
      }
      m = await tx.projectMember.update({
        where: { id: existing.id },
        data: { role, status: "active" },
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
      });
    } else {
      m = await tx.projectMember.create({
        data: { projectId, userId, role, status: "active" },
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
      });
    }

    if (duty === "owner") {
      await tx.project.update({
        where: { id: projectId },
        data: { ownerId: userId },
      });
    } else if (duty === "purchaser") {
      await tx.project.update({
        where: { id: projectId },
        data: { purchaserId: userId },
      });
    }

    await onMemberJoined(projectId, m.user.name, m.role, user.id, m.userId, tx);
    return m;
  }).catch((err: Error) => {
    if (err.message === "ALREADY_MEMBER") return null;
    throw err;
  });

  if (!member) {
    return NextResponse.json({ error: "该用户已是项目成员" }, { status: 409 });
  }

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROJECT_MEMBER,
    targetId: member.id,
    afterData: { userId, role: member.role, duty },
    request,
  });

  syncProjectMilestoneCalendars(projectId).catch(() => null);

  const refreshed = await db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, purchaserId: true },
  });

  return NextResponse.json(
    {
      member: {
        id: member.id,
        userId: member.userId,
        role: member.role,
        duty: resolveProjectDuty(
          member.userId,
          refreshed?.ownerId ?? project.ownerId,
          refreshed?.purchaserId ?? project.purchaserId
        ),
        status: member.status,
        user: member.user,
      },
    },
    { status: 201 }
  );
}
