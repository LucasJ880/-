import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import {
  normalizeToolKey,
  isValidToolKeyFormat,
  isValidToolCategory,
  isValidToolType,
} from "@/lib/tools/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const category = searchParams.get("category")?.trim() ?? "";
  const typeFilter = searchParams.get("type")?.trim() ?? "";
  const statusFilter = searchParams.get("status")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50));

  const where: Record<string, unknown> = { projectId };
  if (category) where.category = category;
  if (typeFilter) where.type = typeFilter;
  if (statusFilter) where.status = statusFilter;
  if (keyword) {
    where.OR = [
      { name: { contains: keyword, mode: "insensitive" } },
      { key: { contains: keyword, mode: "insensitive" } },
    ];
  }

  const [total, tools] = await Promise.all([
    db.toolRegistry.count({ where }),
    db.toolRegistry.findMany({
      where,
      include: {
        updatedBy: { select: { id: true, name: true } },
        _count: { select: { agentBindings: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    tools: tools.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      category: t.category,
      type: t.type,
      status: t.status,
      agentCount: t._count.agentBindings,
      updatedBy: t.updatedBy,
      updatedAt: t.updatedAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => ({}));

  const key = normalizeToolKey(typeof body.key === "string" ? body.key : "");
  if (!key || !isValidToolKeyFormat(key)) {
    return NextResponse.json({ error: "key 格式无效" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });

  const dup = await db.toolRegistry.findUnique({
    where: { projectId_key: { projectId, key } },
  });
  if (dup) return NextResponse.json({ error: "该项目下 key 已存在" }, { status: 409 });

  const category = typeof body.category === "string" && isValidToolCategory(body.category) ? body.category : "builtin";
  const type = typeof body.type === "string" && isValidToolType(body.type) ? body.type : "function";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const inputSchemaJson = typeof body.inputSchemaJson === "string" ? body.inputSchemaJson.trim() || null : null;
  const outputSchemaJson = typeof body.outputSchemaJson === "string" ? body.outputSchemaJson.trim() || null : null;
  const configJson = typeof body.configJson === "string" ? body.configJson.trim() || null : null;

  const tool = await db.toolRegistry.create({
    data: {
      projectId, key, name, description, category, type,
      inputSchemaJson, outputSchemaJson, configJson,
      createdById: user.id, updatedById: user.id,
    },
  });

  await logAudit({
    userId: user.id, orgId: project.orgId ?? undefined, projectId,
    action: AUDIT_ACTIONS.CREATE, targetType: AUDIT_TARGETS.TOOL, targetId: tool.id,
    afterData: { key, category, type },
    request,
  });

  return NextResponse.json({ tool }, { status: 201 });
}
