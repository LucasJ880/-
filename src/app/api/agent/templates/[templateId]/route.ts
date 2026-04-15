import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import type { StepTemplate } from "@/lib/agent/types";

/**
 * GET /api/agent/templates/:templateId
 */
export const GET = withAuth(async (_request, ctx, user) => {
  const { templateId } = await ctx.params;

  const template = await db.customFlowTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) return NextResponse.json({ error: "模板不存在" }, { status: 404 });

  if (!template.isPublic && template.createdById !== user.id) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  let steps: StepTemplate[] = [];
  try {
    steps = JSON.parse(template.stepsJson);
  } catch {}

  return NextResponse.json({
    template: { ...template, steps, stepsJson: undefined },
  });
});

/**
 * PATCH /api/agent/templates/:templateId
 */
export const PATCH = withAuth(async (request, ctx, user) => {
  const { templateId } = await ctx.params;

  const existing = await db.customFlowTemplate.findUnique({
    where: { id: templateId },
  });

  if (!existing) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  if (existing.createdById !== user.id) {
    return NextResponse.json({ error: "只能编辑自己的模板" }, { status: 403 });
  }

  const body = await request.json();
  const { name, description, icon, category, steps, isPublic, enabled } = body as {
    name?: string;
    description?: string;
    icon?: string;
    category?: string;
    steps?: StepTemplate[];
    isPublic?: boolean;
    enabled?: boolean;
  };

  const template = await db.customFlowTemplate.update({
    where: { id: templateId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(steps !== undefined ? { stepsJson: JSON.stringify(steps) } : {}),
      ...(isPublic !== undefined ? { isPublic } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    },
  });

  return NextResponse.json({ template });
});

/**
 * DELETE /api/agent/templates/:templateId
 */
export const DELETE = withAuth(async (_request, ctx, user) => {
  const { templateId } = await ctx.params;

  const existing = await db.customFlowTemplate.findUnique({
    where: { id: templateId },
  });

  if (!existing) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  if (existing.createdById !== user.id) {
    return NextResponse.json({ error: "只能删除自己的模板" }, { status: 403 });
  }

  await db.customFlowTemplate.delete({ where: { id: templateId } });

  return NextResponse.json({ success: true });
});
