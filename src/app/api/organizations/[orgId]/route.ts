import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireOrgRole } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidPlanType } from "@/lib/organizations/utils";

type RouteCtx = { params: Promise<{ orgId: string }> };

/** GET：成员或 super_admin 可查看 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  if (!isSuperAdmin(user.role)) {
    const m = await getOrgMembership(user.id, orgId);
    if (!m || m.status !== "active") {
      return NextResponse.json({ error: "无权查看该组织" }, { status: 403 });
    }
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: { select: { members: true } },
    },
  });

  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  const projectWhere: Record<string, unknown> = { orgId };
  if (!isSuperAdmin(user.role)) {
    projectWhere.intakeStatus = "dispatched";
  }
  const projectCount = await db.project.count({ where: projectWhere });

  const myMembership = await getOrgMembership(user.id, orgId);
  const myRole =
    myMembership?.status === "active" ? myMembership.role : null;

  return NextResponse.json({
    organization: {
      id: org.id,
      name: org.name,
      code: org.code,
      status: org.status,
      planType: org.planType,
      ownerId: org.ownerId,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      memberCount: org._count.members,
      projectCount,
      myRole,
    },
  });
}

/** PUT：org_admin / super_admin；code 不可改；status 仅 super_admin */
export async function PUT(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  const body = await request.json();
  const data: {
    name?: string;
    planType?: string;
    status?: string;
  } = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) {
      return NextResponse.json({ error: "组织名称不能为空" }, { status: 400 });
    }
    data.name = name;
  }

  if (body.planType !== undefined) {
    const p = String(body.planType);
    if (!isValidPlanType(p)) {
      return NextResponse.json({ error: "无效的 planType" }, { status: 400 });
    }
    data.planType = p;
  }

  if (body.status !== undefined) {
    if (!isSuperAdmin(user.role)) {
      return NextResponse.json(
        { error: "仅平台管理员可修改组织状态" },
        { status: 403 }
      );
    }
    const s = String(body.status);
    if (!["active", "archived", "suspended", "inactive"].includes(s)) {
      return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
    }
    data.status = s;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const before = {
    name: org.name,
    planType: org.planType,
    status: org.status,
  };

  const updated = await db.organization.update({
    where: { id: orgId },
    data,
  });

  await logAudit({
    userId: user.id,
    orgId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.ORG,
    targetId: orgId,
    beforeData: before,
    afterData: {
      name: updated.name,
      planType: updated.planType,
      status: updated.status,
    },
    request,
  });

  return NextResponse.json({
    organization: {
      id: updated.id,
      name: updated.name,
      code: updated.code,
      status: updated.status,
      planType: updated.planType,
      ownerId: updated.ownerId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}

/**
 * DELETE：软删除（status=archived）
 * 不物理删除；下属项目保留关联，归档后不可再在该组织下新建项目。
 */
export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  if (org.status === "archived") {
    return NextResponse.json({ error: "组织已归档" }, { status: 400 });
  }

  const before = { status: org.status };

  const updated = await db.organization.update({
    where: { id: orgId },
    data: { status: "archived" },
  });

  await logAudit({
    userId: user.id,
    orgId,
    action: AUDIT_ACTIONS.DELETE,
    targetType: AUDIT_TARGETS.ORG,
    targetId: orgId,
    beforeData: before,
    afterData: { status: updated.status },
    request,
  });

  return NextResponse.json({
    ok: true,
    organization: {
      id: updated.id,
      status: updated.status,
    },
  });
}
