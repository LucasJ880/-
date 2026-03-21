import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireOrgRole } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidOrgRole } from "@/lib/organizations/utils";

type RouteCtx = { params: Promise<{ orgId: string }> };

/** GET：组织成员可查看列表 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  if (!isSuperAdmin(user.role)) {
    const m = await getOrgMembership(user.id, orgId);
    if (!m || m.status !== "active") {
      return NextResponse.json({ error: "无权查看成员列表" }, { status: 403 });
    }
  }

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  const members = await db.organizationMember.findMany({
    where: { orgId },
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
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
      createdAt: m.createdAt,
      user: m.user,
    })),
  });
}

/**
 * POST：通过 userId 添加/恢复成员（无邮件邀请，便于内测与后续扩展）
 * 仅 org_admin / super_admin
 */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const role =
    typeof body.role === "string" && body.role ? body.role : "org_member";

  if (!userId) {
    return NextResponse.json({ error: "userId 必填" }, { status: 400 });
  }

  if (!isValidOrgRole(role)) {
    return NextResponse.json({ error: "无效的组织角色" }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target || target.status !== "active") {
    return NextResponse.json({ error: "用户不存在或已停用" }, { status: 404 });
  }

  const existing = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });

  if (existing) {
    if (existing.status === "active") {
      return NextResponse.json({ error: "该用户已是组织成员" }, { status: 409 });
    }
    const updated = await db.organizationMember.update({
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
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: AUDIT_ACTIONS.CREATE,
      targetType: AUDIT_TARGETS.ORG_MEMBER,
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
          joinedAt: updated.joinedAt,
          user: updated.user,
        },
      },
      { status: 201 }
    );
  }

  const created = await db.organizationMember.create({
    data: {
      orgId,
      userId,
      role,
      status: "active",
    },
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
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.ORG_MEMBER,
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
        joinedAt: created.joinedAt,
        user: created.user,
      },
    },
    { status: 201 }
  );
}
