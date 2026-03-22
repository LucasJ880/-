import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  isValidProjectMemberRole,
  isValidProjectMemberStatus,
  countActiveProjectAdmins,
  isSelfPromotion,
} from "@/lib/projects/members-utils";
import { onMemberRemoved } from "@/lib/project-discussion/system-events";

type Ctx = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, memberId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const member = await db.projectMember.findFirst({
    where: { id: memberId, projectId },
  });
  if (!member) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  const body = await request.json();
  const data: { role?: string; status?: string } = {};

  if (body.role !== undefined) {
    const r = String(body.role);
    if (!isValidProjectMemberRole(r)) {
      return NextResponse.json({ error: "无效的项目角色" }, { status: 400 });
    }
    if (isSelfPromotion(user.id, member.userId, member.role, r)) {
      return NextResponse.json({ error: "不能自行提升项目角色" }, { status: 403 });
    }
    data.role = r;
  }

  if (body.status !== undefined) {
    const s = String(body.status);
    if (!isValidProjectMemberStatus(s)) {
      return NextResponse.json({ error: "无效的成员状态" }, { status: 400 });
    }
    data.status = s;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const nextRole = data.role ?? member.role;
  const nextStatus = data.status ?? member.status;

  if (
    member.role === "project_admin" &&
    member.status === "active" &&
    (nextRole !== "project_admin" || nextStatus !== "active")
  ) {
    const admins = await countActiveProjectAdmins(projectId);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "不能降级或停用唯一的项目管理员" },
        { status: 400 }
      );
    }
  }

  const before = { role: member.role, status: member.status };

  const updated = await db.projectMember.update({
    where: { id: memberId },
    data,
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

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.PROJECT_MEMBER,
    targetId: memberId,
    beforeData: before,
    afterData: { role: updated.role, status: updated.status },
    request,
  });

  return NextResponse.json({
    member: {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      status: updated.status,
      user: updated.user,
    },
  });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id: projectId, memberId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const member = await db.projectMember.findFirst({
    where: { id: memberId, projectId },
  });
  if (!member) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  if (member.role === "project_admin" && member.status === "active") {
    const admins = await countActiveProjectAdmins(projectId);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "不能移除唯一的项目管理员" },
        { status: 400 }
      );
    }
  }

  const before = { role: member.role, status: member.status };

  const updated = await db.projectMember.update({
    where: { id: memberId },
    data: { status: "inactive" },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.REMOVE,
    targetType: AUDIT_TARGETS.PROJECT_MEMBER,
    targetId: memberId,
    beforeData: before,
    afterData: { status: updated.status },
    request,
  });

  onMemberRemoved(projectId, updated.user.name, user.id).catch(() => {});

  return NextResponse.json({
    ok: true,
    member: {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      status: updated.status,
    },
  });
}
