import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOrgRole } from "@/lib/auth/guards";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  isValidOrgRole,
  isValidMemberStatus,
  countActiveOrgAdmins,
} from "@/lib/organizations/utils";

type RouteCtx = {
  params: Promise<{ orgId: string; memberId: string }>;
};

/** PATCH：修改角色 / 状态 */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const { orgId, memberId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  const member = await db.organizationMember.findFirst({
    where: { id: memberId, orgId },
  });
  if (!member) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  const body = await request.json();
  const data: { role?: string; status?: string } = {};

  if (body.role !== undefined) {
    const r = String(body.role);
    if (!isValidOrgRole(r)) {
      return NextResponse.json({ error: "无效的组织角色" }, { status: 400 });
    }
    data.role = r;
  }

  if (body.status !== undefined) {
    const s = String(body.status);
    if (!isValidMemberStatus(s)) {
      return NextResponse.json({ error: "无效的会员状态" }, { status: 400 });
    }
    data.status = s;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const nextRole = data.role ?? member.role;
  const nextStatus = data.status ?? member.status;

  if (
    member.role === "org_admin" &&
    member.status === "active" &&
    (nextRole !== "org_admin" || nextStatus !== "active")
  ) {
    const admins = await countActiveOrgAdmins(orgId);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "不能移除或降级唯一的组织管理员" },
        { status: 400 }
      );
    }
  }

  const before = { role: member.role, status: member.status };

  const updated = await db.organizationMember.update({
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
    userId: auth.user.id,
    orgId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.ORG_MEMBER,
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
      joinedAt: updated.joinedAt,
      user: updated.user,
    },
  });
}

/** DELETE：软移除（status=inactive） */
export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { orgId, memberId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  const member = await db.organizationMember.findFirst({
    where: { id: memberId, orgId },
  });
  if (!member) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  if (
    member.role === "org_admin" &&
    member.status === "active"
  ) {
    const admins = await countActiveOrgAdmins(orgId);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "不能移除唯一的组织管理员" },
        { status: 400 }
      );
    }
  }

  const before = { role: member.role, status: member.status };

  const updated = await db.organizationMember.update({
    where: { id: memberId },
    data: { status: "inactive" },
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
    userId: auth.user.id,
    orgId,
    action: AUDIT_ACTIONS.REMOVE,
    targetType: AUDIT_TARGETS.ORG_MEMBER,
    targetId: memberId,
    beforeData: before,
    afterData: { status: updated.status },
    request,
  });

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
