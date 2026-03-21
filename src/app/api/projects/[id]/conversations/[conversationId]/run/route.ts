import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { runAgentForConversation } from "@/lib/runtime/agent-runtime";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; conversationId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, conversationId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, projectId },
  });
  if (!conv) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  if (conv.runtimeStatus === "running") {
    return NextResponse.json({ error: "会话正在运行中，请稍后再试" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const maxToolRounds = typeof body.maxToolRounds === "number"
    ? Math.min(body.maxToolRounds, 5)
    : undefined;

  const result = await runAgentForConversation({
    conversationId,
    projectId,
    maxToolRounds,
  });

  if (result.error) {
    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.RUNTIME_FAIL,
      targetType: AUDIT_TARGETS.RUNTIME,
      targetId: conversationId,
      afterData: { error: result.error.slice(0, 200) },
      request,
    });
  } else {
    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.RUNTIME_RUN,
      targetType: AUDIT_TARGETS.RUNTIME,
      targetId: conversationId,
      afterData: {
        newMessageCount: result.newMessages.length,
        toolTraceCount: result.toolTraces.length,
      },
      request,
    });
  }

  return NextResponse.json({ result });
}
