import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidTagCategory } from "@/lib/feedback/validation";

type Ctx = { params: Promise<{ id: string; tagId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, tagId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const tag = await db.evaluationTag.findFirst({
    where: { id: tagId, projectId },
  });
  if (!tag) {
    return NextResponse.json({ error: "标签不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "无效请求体" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.label === "string") updates.label = body.label.trim().slice(0, 100);
  if (body.category && isValidTagCategory(body.category)) updates.category = body.category;
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(body.color)) updates.color = body.color;
  if (body.status === "active" || body.status === "archived") updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const updated = await db.evaluationTag.update({
    where: { id: tagId },
    data: updates,
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId,
    action: AUDIT_ACTIONS.UPDATE_EVALUATION_TAG,
    targetType: AUDIT_TARGETS.EVALUATION_TAG,
    targetId: tagId,
    beforeData: { label: tag.label, category: tag.category, status: tag.status },
    afterData: updates,
    request,
  });

  return NextResponse.json({ tag: updated });
}
