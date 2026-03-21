import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isValidToolCategory, isValidToolType, isValidToolStatus } from "@/lib/tools/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; toolId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, toolId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const tool = await db.toolRegistry.findFirst({
    where: { id: toolId, projectId },
    include: {
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      agentBindings: {
        include: {
          agent: { select: { id: true, key: true, name: true, environmentId: true } },
        },
      },
    },
  });
  if (!tool) return NextResponse.json({ error: "工具不存在" }, { status: 404 });

  return NextResponse.json({
    tool: {
      id: tool.id,
      key: tool.key,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: tool.type,
      status: tool.status,
      inputSchemaJson: tool.inputSchemaJson,
      outputSchemaJson: tool.outputSchemaJson,
      configJson: tool.configJson,
      createdBy: tool.createdBy,
      updatedBy: tool.updatedBy,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    },
    agentBindings: tool.agentBindings.map((b) => ({
      id: b.id,
      agent: b.agent,
      enabled: b.enabled,
    })),
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, toolId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const tool = await db.toolRegistry.findFirst({ where: { id: toolId, projectId } });
  if (!tool) return NextResponse.json({ error: "工具不存在" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.description === "string") updates.description = body.description.trim() || null;
  if (typeof body.category === "string" && isValidToolCategory(body.category)) updates.category = body.category;
  if (typeof body.type === "string" && isValidToolType(body.type)) updates.type = body.type;
  if (typeof body.status === "string" && isValidToolStatus(body.status)) updates.status = body.status;
  if (typeof body.inputSchemaJson === "string") updates.inputSchemaJson = body.inputSchemaJson.trim() || null;
  if (typeof body.outputSchemaJson === "string") updates.outputSchemaJson = body.outputSchemaJson.trim() || null;
  if (typeof body.configJson === "string") updates.configJson = body.configJson.trim() || null;

  const updated = await db.toolRegistry.update({
    where: { id: toolId },
    data: { ...updates, updatedById: user.id },
  });

  await logAudit({
    userId: user.id, orgId: project.orgId ?? undefined, projectId,
    action: AUDIT_ACTIONS.UPDATE, targetType: AUDIT_TARGETS.TOOL, targetId: toolId,
    afterData: updates,
    request,
  });

  return NextResponse.json({ tool: updated });
}
