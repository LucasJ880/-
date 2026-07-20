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
import {
  dutyToMemberRole,
  isValidProjectDuty,
  resolveProjectDuty,
  type ProjectDuty,
} from "@/lib/projects/duty";
import { onMemberRemoved } from "@/lib/project-discussion/system-events";
import { syncProjectMilestoneCalendars } from "@/lib/projects/sync-milestone-calendar";

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
  let duty: ProjectDuty | undefined;

  if (body.duty !== undefined) {
    if (!isValidProjectDuty(String(body.duty))) {
      return NextResponse.json({ error: "无效的项目身份" }, { status: 400 });
    }
    duty = body.duty as ProjectDuty;
    data.role = dutyToMemberRole(duty);
  }

  if (body.role !== undefined && duty === undefined) {
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

  if (Object.keys(data).length === 0 && duty === undefined) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const nextRole = data.role ?? member.role;
  const nextStatus = data.status ?? member.status;

  if (
    member.role === "project_admin" &&
    member.status === "active" &&
    (nextRole !== "project_admin" || nextStatus !== "active") &&
    duty !== "owner"
  ) {
    const admins = await countActiveProjectAdmins(projectId);
    if (admins <= 1 && project.ownerId === member.userId) {
      return NextResponse.json(
        { error: "请先指定新的主负责人，再调整当前主负责人身份" },
        { status: 400 }
      );
    }
    if (admins <= 1 && duty === undefined) {
      return NextResponse.json(
        { error: "不能降级或停用唯一的项目管理员" },
        { status: 400 }
      );
    }
  }

  if (duty === "participant" && project.ownerId === member.userId) {
    return NextResponse.json(
      { error: "不能将唯一主负责人直接改为参与者，请先指定新的主负责人" },
      { status: 400 }
    );
  }

  const before = {
    role: member.role,
    status: member.status,
    ownerId: project.ownerId,
    purchaserId: project.purchaserId,
  };

  const updated = await db.$transaction(async (tx) => {
    const m = await tx.projectMember.update({
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

    if (duty === "owner") {
      await tx.project.update({
        where: { id: projectId },
        data: { ownerId: member.userId },
      });
      // 确保新负责人具备 project_admin
      await tx.projectMember.update({
        where: { id: memberId },
        data: { role: "project_admin" },
      });
    } else if (duty === "purchaser") {
      await tx.project.update({
        where: { id: projectId },
        data: { purchaserId: member.userId },
      });
    } else if (duty === "participant") {
      if (project.purchaserId === member.userId) {
        await tx.project.update({
          where: { id: projectId },
          data: { purchaserId: null },
        });
      }
    }

    return m;
  });

  const refreshed = await db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, purchaserId: true },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.PROJECT_MEMBER,
    targetId: memberId,
    beforeData: before,
    afterData: {
      role: updated.role,
      status: updated.status,
      duty: resolveProjectDuty(
        updated.userId,
        refreshed?.ownerId ?? project.ownerId,
        refreshed?.purchaserId
      ),
      ownerId: refreshed?.ownerId,
      purchaserId: refreshed?.purchaserId,
    },
    request,
  });

  syncProjectMilestoneCalendars(projectId).catch(() => null);

  return NextResponse.json({
    member: {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      duty: resolveProjectDuty(
        updated.userId,
        refreshed?.ownerId ?? project.ownerId,
        refreshed?.purchaserId
      ),
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

  if (member.userId === project.ownerId) {
    return NextResponse.json(
      { error: "不能移除主负责人，请先转让主负责人身份" },
      { status: 400 }
    );
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

  const updated = await db.$transaction(async (tx) => {
    if (project.purchaserId === member.userId) {
      await tx.project.update({
        where: { id: projectId },
        data: { purchaserId: null },
      });
    }
    const m = await tx.projectMember.update({
      where: { id: memberId },
      data: { status: "inactive" },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    await onMemberRemoved(projectId, m.user.name, user.id, m.userId, tx);
    return m;
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

  syncProjectMilestoneCalendars(projectId).catch(() => null);

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
