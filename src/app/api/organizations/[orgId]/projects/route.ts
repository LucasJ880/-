import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOrgRole } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidCodeFormat } from "@/lib/common/validation";

type RouteCtx = { params: Promise<{ orgId: string }> };

/**
 * GET /api/organizations/[orgId]/projects
 * 获取组织下的项目列表（成员可读）
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_viewer");
  if (auth instanceof NextResponse) return auth;

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  const where: Record<string, unknown> = { orgId, status: "active" };
  if (!isSuperAdmin(auth.user.role)) {
    where.intakeStatus = "dispatched";
  }

  const projects = await db.project.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, avatar: true } },
      _count: { select: { members: true, environments: true, tasks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ projects });
}

/**
 * POST /api/organizations/[orgId]/projects
 * 在组织下创建项目（org_member 及以上）
 * 自动创建默认环境 test + prod，创建者成为 project_admin
 */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { orgId } = await ctx.params;

  const auth = await requireOrgRole(request, orgId, "org_member");
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "项目名称不能超过 100 字符" }, { status: 400 });
  }

  let code: string | undefined;
  if (body.code != null && String(body.code).trim() !== "") {
    code = String(body.code).trim().toLowerCase();
    if (!isValidCodeFormat(code)) {
      return NextResponse.json(
        { error: "code 须为小写字母、数字、连字符，2–48 位" },
        { status: 400 }
      );
    }
    const existing = await db.project.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ error: "该 code 已被占用" }, { status: 409 });
    }
  }

  const description = typeof body.description === "string" ? body.description.trim() : null;
  const color = typeof body.color === "string" ? body.color.trim() : "#3B82F6";

  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name,
        code: code ?? null,
        description,
        color,
        orgId,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "project_admin",
            status: "active",
          },
        },
        environments: {
          create: [
            { name: "测试环境", code: "test", status: "active" },
            { name: "正式环境", code: "prod", status: "active" },
          ],
        },
      },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { members: true, environments: true } },
      },
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
      code: project.code,
      orgId,
      defaultEnvironments: ["test", "prod"],
    },
    request,
  });

  return NextResponse.json({ project }, { status: 201 });
}
