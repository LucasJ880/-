import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  slugifyOrgCode,
  ensureUniqueOrgCode,
  isValidPlanType,
} from "@/lib/organizations/utils";

/**
 * GET /api/organizations
 * super_admin: 全部组织 + myRole
 * 普通用户: 仅所属成员关系为 active 的组织
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  if (isSuperAdmin(user.role)) {
    const orgs = await db.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { members: true, projects: true } },
      },
    });
    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id, status: "active" },
    });
    const roleByOrg = new Map(memberships.map((m) => [m.orgId, m.role]));

    return NextResponse.json({
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        code: o.code,
        status: o.status,
        planType: o.planType,
        ownerId: o.ownerId,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        memberCount: o._count.members,
        projectCount: o._count.projects,
        myRole: roleByOrg.get(o.id) ?? null,
      })),
    });
  }

  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    include: {
      org: {
        include: { _count: { select: { members: true, projects: true } } },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  return NextResponse.json({
    organizations: memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      code: m.org.code,
      status: m.org.status,
      planType: m.org.planType,
      ownerId: m.org.ownerId,
      createdAt: m.org.createdAt,
      updatedAt: m.org.updatedAt,
      memberCount: m.org._count.members,
      projectCount: m.org._count.projects,
      myRole: m.role,
    })),
  });
}

/**
 * POST /api/organizations
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "组织名称不能为空" }, { status: 400 });
  }

  let code: string;
  if (body.code != null && String(body.code).trim() !== "") {
    const raw = String(body.code).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(raw)) {
      return NextResponse.json(
        { error: "code 仅允许小写字母、数字、连字符，2–63 位" },
        { status: 400 }
      );
    }
    const exists = await db.organization.findUnique({ where: { code: raw } });
    if (exists) {
      return NextResponse.json({ error: "该 code 已被占用" }, { status: 409 });
    }
    code = raw;
  } else {
    const base = slugifyOrgCode(name);
    code = await ensureUniqueOrgCode(base);
  }

  let planType = "free";
  if (body.planType != null && body.planType !== "") {
    const p = String(body.planType);
    if (!isValidPlanType(p)) {
      return NextResponse.json({ error: "无效的 planType" }, { status: 400 });
    }
    planType = p;
  }

  const org = await db.organization.create({
    data: {
      name,
      code,
      ownerId: user.id,
      planType,
      status: "active",
      members: {
        create: {
          userId: user.id,
          role: "org_admin",
          status: "active",
        },
      },
    },
  });

  await logAudit({
    userId: user.id,
    orgId: org.id,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.ORG,
    targetId: org.id,
    afterData: {
      id: org.id,
      name: org.name,
      code: org.code,
      planType: org.planType,
    },
    request,
  });

  return NextResponse.json(
    {
      organization: {
        id: org.id,
        name: org.name,
        code: org.code,
        status: org.status,
        planType: org.planType,
        ownerId: org.ownerId,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
        myRole: "org_admin",
      },
    },
    { status: 201 }
  );
}
