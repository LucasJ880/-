import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, conversationId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, projectId },
    select: { id: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const traces = await db.toolCallTrace.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    traces: traces.map((t) => ({
      id: t.id,
      toolKey: t.toolKey,
      toolName: t.toolName,
      toolCallId: t.toolCallId,
      inputJson: t.inputJson,
      outputJson: t.outputJson,
      status: t.status,
      errorMessage: t.errorMessage,
      durationMs: t.durationMs,
      agentId: t.agentId,
      messageId: t.messageId,
      createdAt: t.createdAt,
    })),
  });
}
