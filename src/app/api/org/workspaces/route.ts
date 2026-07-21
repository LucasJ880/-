import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";

/**
 * GET /api/org/workspaces?orgId=
 * POST /api/org/workspaces  body: { name, slug, type?, description? }
 */
export async function GET(request: NextRequest) {
  const tenant = await requireTenantContext(request, {
    requireMembership: true,
    loadWorkspaces: true,
  });
  if (tenant instanceof NextResponse) return tenant;

  const list = await db.workspace.findMany({
    where: { orgId: tenant.orgId, status: { not: "archived" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      description: true,
      createdAt: true,
      _count: { select: { members: true, projects: true } },
    },
  });

  return NextResponse.json({
    workspaces: list,
    myWorkspaceIds: tenant.workspaceIds ?? [],
  });
}

export async function POST(request: NextRequest) {
  const tenant = await requireTenantContext(request, {
    requireMembership: true,
  });
  if (tenant instanceof NextResponse) return tenant;

  if (tenant.orgRole !== "org_admin" && !tenant.isPlatformAdmin) {
    return NextResponse.json({ error: "需要组织管理员" }, { status: 403 });
  }

  let body: {
    name?: string;
    slug?: string;
    type?: string;
    description?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const slug = (body.slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || !slug) {
    return NextResponse.json({ error: "name 与 slug 必填" }, { status: 400 });
  }

  try {
    const ws = await db.workspace.create({
      data: {
        orgId: tenant.orgId,
        name,
        slug,
        type: (body.type ?? "department").trim() || "department",
        description: body.description?.trim() || null,
        status: "active",
      },
    });
    return NextResponse.json({ workspace: ws }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "创建失败（slug 可能已存在）" },
      { status: 400 },
    );
  }
}
