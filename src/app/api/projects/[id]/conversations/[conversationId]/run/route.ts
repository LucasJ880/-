import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDiagnosticProjectManageAccess as requireProjectManageAccess } from "@/lib/projects/diagnostic-access";
import { runConversationAgent } from "@/lib/agent-core/conversation/adapter";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { toPlatformDiagnosticRuntimeDto } from "@/lib/conversations/dto";

type Ctx = { params: Promise<{ id: string; conversationId: string }> };

/**
 * 诊断用手动触发 Runtime：仅平台管理员（requireDiagnosticProjectManageAccess）。
 * 普通用户通过 POST messages?run=true 获得业务 Runtime DTO。
 */
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
    return NextResponse.json(
      { error: "会话正在运行中，请稍后再试" },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const maxToolRounds =
    typeof body.maxToolRounds === "number"
      ? Math.min(body.maxToolRounds, 5)
      : undefined;

  const result = await runConversationAgent({
    conversationId,
    projectId,
    maxToolRounds,
    userId: user.id,
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

  return NextResponse.json({
    runtime: toPlatformDiagnosticRuntimeDto(result),
  });
}
