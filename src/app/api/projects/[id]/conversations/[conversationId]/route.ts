import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isValidConversationStatus } from "@/lib/conversations/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, conversationId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, projectId },
    include: {
      environment: { select: { id: true, code: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!conv) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const contextSnapshot = await db.conversationContextSnapshot.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
  });

  let promptInfo: {
    id: string;
    key: string;
    name: string;
    version: number | null;
  } | null = null;
  if (conv.promptId) {
    const p = await db.prompt.findFirst({
      where: { id: conv.promptId },
      select: { id: true, key: true, name: true },
    });
    let version: number | null = null;
    if (conv.promptVersionId) {
      const pv = await db.promptVersion.findFirst({
        where: { id: conv.promptVersionId },
        select: { version: true },
      });
      version = pv?.version ?? null;
    }
    if (p) promptInfo = { ...p, version };
  }

  let kbInfo: {
    id: string;
    key: string;
    name: string;
    version: number | null;
  } | null = null;
  if (conv.knowledgeBaseId) {
    const kb = await db.knowledgeBase.findFirst({
      where: { id: conv.knowledgeBaseId },
      select: { id: true, key: true, name: true },
    });
    let version: number | null = null;
    if (conv.knowledgeBaseVersionId) {
      const kbv = await db.knowledgeBaseVersion.findFirst({
        where: { id: conv.knowledgeBaseVersionId },
        select: { version: true },
      });
      version = kbv?.version ?? null;
    }
    if (kb) kbInfo = { ...kb, version };
  }

  return NextResponse.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      channel: conv.channel,
      status: conv.status,
      environment: conv.environment,
      user: conv.user,
      messageCount: conv.messageCount,
      inputTokens: conv.inputTokens,
      outputTokens: conv.outputTokens,
      totalTokens: conv.totalTokens,
      estimatedCost: conv.estimatedCost,
      avgLatencyMs: conv.avgLatencyMs,
      agentId: conv.agentId,
      runtimeStatus: conv.runtimeStatus,
      lastErrorMessage: conv.lastErrorMessage,
      runCount: conv.runCount,
      startedAt: conv.startedAt,
      lastMessageAt: conv.lastMessageAt,
      endedAt: conv.endedAt,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    },
    prompt: promptInfo,
    knowledgeBase: kbInfo,
    contextSnapshot: contextSnapshot
      ? {
          id: contextSnapshot.id,
          promptKey: contextSnapshot.promptKey,
          knowledgeBaseKey: contextSnapshot.knowledgeBaseKey,
          systemPromptSnapshot: contextSnapshot.systemPromptSnapshot,
          retrievalConfigJson: contextSnapshot.retrievalConfigJson,
          extraConfigJson: contextSnapshot.extraConfigJson,
          createdAt: contextSnapshot.createdAt,
        }
      : null,
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
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

  const body = await request.json().catch(() => ({}));
  const data: { title?: string; status?: string; endedAt?: Date } = {};

  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim();
  }
  if (typeof body.status === "string" && body.status.trim()) {
    if (!isValidConversationStatus(body.status.trim())) {
      return NextResponse.json({ error: "无效的 status" }, { status: 400 });
    }
    data.status = body.status.trim();
    if (
      (data.status === "completed" || data.status === "archived") &&
      !conv.endedAt
    ) {
      data.endedAt = new Date();
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const before = { title: conv.title, status: conv.status };

  const updated = await db.conversation.update({
    where: { id: conversationId },
    data,
    include: {
      environment: { select: { id: true, code: true, name: true } },
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.CONVERSATION,
    targetId: conversationId,
    beforeData: before,
    afterData: { title: updated.title, status: updated.status },
    request,
  });

  return NextResponse.json({ conversation: updated });
}
