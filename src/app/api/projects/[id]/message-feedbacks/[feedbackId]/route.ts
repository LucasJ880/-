import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidFeedbackStatus } from "@/lib/feedback/validation";

type Ctx = { params: Promise<{ id: string; feedbackId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, feedbackId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const feedback = await db.messageFeedback.findFirst({
    where: { id: feedbackId, projectId },
    include: { tags: { include: { tag: true } } },
  });

  if (!feedback) {
    return NextResponse.json({ error: "反馈不存在" }, { status: 404 });
  }

  return NextResponse.json({ feedback });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, feedbackId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const feedback = await db.messageFeedback.findFirst({
    where: { id: feedbackId, projectId },
  });
  if (!feedback) {
    return NextResponse.json({ error: "反馈不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "无效请求体" }, { status: 400 });

  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!isValidFeedbackStatus(body.status)) {
      return NextResponse.json({ error: "无效状态" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (typeof body.note === "string") {
    updates.note = body.note.slice(0, 2000);
  }

  const updated = await db.messageFeedback.update({
    where: { id: feedbackId },
    data: updates,
    include: { tags: { include: { tag: true } } },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId,
    action: AUDIT_ACTIONS.UPDATE_MESSAGE_FEEDBACK,
    targetType: AUDIT_TARGETS.MESSAGE_FEEDBACK,
    targetId: feedbackId,
    beforeData: { status: feedback.status },
    afterData: updates,
    request,
  });

  return NextResponse.json({ feedback: updated });
}
