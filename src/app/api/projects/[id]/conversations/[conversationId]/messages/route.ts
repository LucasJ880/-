import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import {
  isValidMessageRole,
  isValidContentType,
  isValidMessageStatus,
} from "@/lib/conversations/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { runAgentForConversation } from "@/lib/runtime/agent-runtime";

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

  const { searchParams } = new URL(request.url);
  const page = Math.max(
    1,
    parseInt(searchParams.get("page") ?? "1", 10) || 1
  );
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "100", 10) || 100)
  );

  const [total, messages] = await Promise.all([
    db.message.count({ where: { conversationId } }),
    db.message.findMany({
      where: { conversationId },
      orderBy: { sequence: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      contentType: m.contentType,
      sequence: m.sequence,
      modelName: m.modelName,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      latencyMs: m.latencyMs,
      status: m.status,
      errorMessage: m.errorMessage,
      toolName: m.toolName,
      toolCallId: m.toolCallId,
      parentMessageId: m.parentMessageId,
      metadataJson: m.metadataJson,
      createdAt: m.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

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

  const body = await request.json().catch(() => ({}));

  const role =
    typeof body.role === "string" && isValidMessageRole(body.role)
      ? body.role
      : "user";
  const content =
    typeof body.content === "string" ? body.content : "";
  if (!content.trim() && role !== "tool") {
    return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  }

  const contentType =
    typeof body.contentType === "string" && isValidContentType(body.contentType)
      ? body.contentType
      : "text";
  const status =
    typeof body.status === "string" && isValidMessageStatus(body.status)
      ? body.status
      : "success";
  const modelName =
    typeof body.modelName === "string" && body.modelName.trim()
      ? body.modelName.trim()
      : null;
  const inputTokens =
    typeof body.inputTokens === "number" ? body.inputTokens : 0;
  const outputTokens =
    typeof body.outputTokens === "number" ? body.outputTokens : 0;
  const latencyMs =
    typeof body.latencyMs === "number" ? body.latencyMs : 0;
  const errorMessage =
    typeof body.errorMessage === "string" && body.errorMessage.trim()
      ? body.errorMessage.trim()
      : null;
  const toolName =
    typeof body.toolName === "string" && body.toolName.trim()
      ? body.toolName.trim()
      : null;
  const toolCallId =
    typeof body.toolCallId === "string" && body.toolCallId.trim()
      ? body.toolCallId.trim()
      : null;
  const metadataJson =
    typeof body.metadataJson === "string" && body.metadataJson.trim()
      ? body.metadataJson.trim()
      : null;

  const now = new Date();

  const message = await db.$transaction(async (tx) => {
    const maxSeq = await tx.message.aggregate({
      where: { conversationId },
      _max: { sequence: true },
    });
    const nextSeq = (maxSeq._max.sequence ?? 0) + 1;

    const msg = await tx.message.create({
      data: {
        conversationId,
        role,
        content,
        contentType,
        sequence: nextSeq,
        modelName,
        inputTokens,
        outputTokens,
        latencyMs,
        status,
        errorMessage,
        toolName,
        toolCallId,
        metadataJson,
      },
    });

    const newTotalTokens = conv.totalTokens + inputTokens + outputTokens;
    const newMsgCount = conv.messageCount + 1;
    const totalLatency = conv.avgLatencyMs * conv.messageCount + latencyMs;

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        messageCount: newMsgCount,
        inputTokens: conv.inputTokens + inputTokens,
        outputTokens: conv.outputTokens + outputTokens,
        totalTokens: newTotalTokens,
        avgLatencyMs:
          newMsgCount > 0 ? Math.round(totalLatency / newMsgCount) : 0,
        lastMessageAt: now,
      },
    });

    return msg;
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.MESSAGE,
    targetId: message.id,
    afterData: {
      conversationId,
      role,
      sequence: message.sequence,
      modelName,
      tokens: inputTokens + outputTokens,
    },
    request,
  });

  const shouldRun = body.run === true && role === "user";

  if (!shouldRun) {
    return NextResponse.json({ message }, { status: 201 });
  }

  const runtimeResult = await runAgentForConversation({
    conversationId,
    projectId,
  });

  if (runtimeResult.error) {
    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.RUNTIME_FAIL,
      targetType: AUDIT_TARGETS.RUNTIME,
      targetId: conversationId,
      afterData: { error: runtimeResult.error.slice(0, 200) },
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
        newMessageCount: runtimeResult.newMessages.length,
        toolTraceCount: runtimeResult.toolTraces.length,
      },
      request,
    });
  }

  return NextResponse.json({
    message,
    runtime: runtimeResult,
  }, { status: 201 });
}
