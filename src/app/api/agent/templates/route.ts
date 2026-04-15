import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { listTemplates as listPresetTemplates } from "@/lib/agent/templates";
import type { StepTemplate } from "@/lib/agent/types";

/**
 * GET /api/agent/templates
 * 获取所有模板（预设 + 用户自定义）
 */
export const GET = withAuth(async (_request, _ctx, user) => {
  const presets = listPresetTemplates().map((t) => ({
    ...t,
    type: "preset" as const,
    enabled: true,
  }));

  const custom = await db.customFlowTemplate.findMany({
    where: {
      OR: [
        { createdById: user.id },
        { isPublic: true },
      ],
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const customMapped = custom.map((t) => {
    let steps: StepTemplate[] = [];
    try {
      steps = JSON.parse(t.stepsJson);
    } catch {}
    return {
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      stepCount: steps.length,
      type: "custom" as const,
      icon: t.icon,
      category: t.category,
      enabled: t.enabled,
      isOwn: t.createdById === user.id,
      usageCount: t.usageCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({ presets, custom: customMapped });
});

/**
 * POST /api/agent/templates
 * 创建自定义模板
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const { name, description, icon, category, steps, isPublic } = body as {
    name: string;
    description?: string;
    icon?: string;
    category?: string;
    steps: StepTemplate[];
    isPublic?: boolean;
  };

  if (!name || !steps || steps.length === 0) {
    return NextResponse.json({ error: "名称和步骤不能为空" }, { status: 400 });
  }

  const template = await db.customFlowTemplate.create({
    data: {
      name,
      description: description ?? null,
      icon: icon ?? null,
      category: category ?? "custom",
      stepsJson: JSON.stringify(steps),
      createdById: user.id,
      isPublic: isPublic ?? false,
    },
  });

  return NextResponse.json({ template }, { status: 201 });
});
