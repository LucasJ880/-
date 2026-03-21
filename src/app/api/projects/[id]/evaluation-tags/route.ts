import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidTagCategory, TAG_CATEGORIES } from "@/lib/feedback/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const sp = new URL(request.url).searchParams;
  const category = sp.get("category")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const keyword = sp.get("keyword")?.trim() || "";

  const where: Record<string, unknown> = { projectId };
  if (category && (TAG_CATEGORIES as readonly string[]).includes(category)) where.category = category;
  if (status === "active" || status === "archived") where.status = status;
  if (keyword) where.label = { contains: keyword, mode: "insensitive" };

  const tags = await db.evaluationTag.findMany({
    where: where as never,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tags });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "无效请求体" }, { status: 400 });

  const { key, label, category, color } = body;

  if (!key || typeof key !== "string" || !label || typeof label !== "string") {
    return NextResponse.json({ error: "key 和 label 必填" }, { status: 400 });
  }
  if (category && !isValidTagCategory(category)) {
    return NextResponse.json({ error: "无效 category" }, { status: 400 });
  }

  const normalizedKey = key.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 64);

  const existing = await db.evaluationTag.findUnique({
    where: { projectId_key: { projectId, key: normalizedKey } },
  });
  if (existing) {
    return NextResponse.json({ error: `标签 key '${normalizedKey}' 已存在` }, { status: 409 });
  }

  const tag = await db.evaluationTag.create({
    data: {
      projectId,
      key: normalizedKey,
      label: label.trim().slice(0, 100),
      category: category ?? "quality",
      color: typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#6b7280",
      createdById: user.id,
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId,
    action: AUDIT_ACTIONS.CREATE_EVALUATION_TAG,
    targetType: AUDIT_TARGETS.EVALUATION_TAG,
    targetId: tag.id,
    afterData: { key: tag.key, label: tag.label, category: tag.category },
    request,
  });

  return NextResponse.json({ tag }, { status: 201 });
}
