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
import { runConversationAgent } from "@/lib/agent-core/conversation/adapter";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import {
  findForbiddenDiagnosticFields,
  toBusinessMessageDto,
  toBusinessRuntimeDto,
  toPlatformDiagnosticMessageDto,
  toPlatformDiagnosticRuntimeDto,
} from "@/lib/conversations/dto";

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
    parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "100", 10) || 100),
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

  const diagnostic = isPlatformAdmin(access.user);

  return NextResponse.json({
    messages: messages.map((m) =>
      diagnostic
        ? toPlatformDiagnosticMessageDto(m)
        : toBusinessMessageDto(m),
    ),
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
  const diagnostic = isPlatformAdmin(user);

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, projectId },
  });
  if (!conv) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!diagnostic) {
    const forbidden = findForbiddenDiagnosticFields(body);
    if (forbidden.length > 0) {
      return NextResponse.json(
        {
          error: "不允许提交诊断字段",
          code: "DIAGNOSTIC_FIELDS_FORBIDDEN",
          fields: forbidden,
        },
        { status: 400 },
      );
    }
  }

  const content = typeof body.content === "string" ? body.content : "";

  let role = "user";
  let status = "success";
  let modelName: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  let errorMessage: string | null = null;
  let toolName: string | null = null;
  let toolCallId: string | null = null;
  let metadataJson: string | null = null;
  let parentMessageId: string | null = null;

  if (diagnostic) {
    role =
      typeof body.role === "string" && isValidMessageRole(body.role)
        ? body.role
        : "user";
    status =
      typeof body.status === "string" && isValidMessageStatus(body.status)
        ? body.status
        : "success";
    modelName =
      typeof body.modelName === "string" && body.modelName.trim()
        ? body.modelName.trim()
        : null;
    inputTokens =
      typeof body.inputTokens === "number" ? body.inputTokens : 0;
    outputTokens =
      typeof body.outputTokens === "number" ? body.outputTokens : 0;
    latencyMs = typeof body.latencyMs === "number" ? body.latencyMs : 0;
    errorMessage =
      typeof body.errorMessage === "string" && body.errorMessage.trim()
        ? body.errorMessage.trim()
        : null;
    toolName =
      typeof body.toolName === "string" && body.toolName.trim()
        ? body.toolName.trim()
        : null;
    toolCallId =
      typeof body.toolCallId === "string" && body.toolCallId.trim()
        ? body.toolCallId.trim()
        : null;
    metadataJson =
      typeof body.metadataJson === "string" && body.metadataJson.trim()
        ? body.metadataJson.trim()
        : null;
    parentMessageId =
      typeof body.parentMessageId === "string" && body.parentMessageId.trim()
        ? body.parentMessageId.trim()
        : null;
  }

  if (!content.trim() && role !== "tool") {
    return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  }

  const contentType =
    typeof body.contentType === "string" && isValidContentType(body.contentType)
      ? body.contentType
      : "text";

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
        parentMessageId,
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
      ...(diagnostic
        ? { modelName, tokens: inputTokens + outputTokens }
        : {}),
    },
    request,
  });

  const messageDto = diagnostic
    ? toPlatformDiagnosticMessageDto(message)
    : toBusinessMessageDto(message);

  const shouldRun = body.run === true && role === "user";

  if (!shouldRun) {
    return NextResponse.json({ message: messageDto }, { status: 201 });
  }

  const runtimeResult = await runConversationAgent({
    conversationId,
    projectId,
    userId: user.id,
  });

  if (runtimeResult.error) {
    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.RUNTIME_FAIL,
      targetType: AUDIT_TARGETS.RUNTIME,
      targetId: conversationId,
      afterData: {
        error: diagnostic
          ? runtimeResult.error.slice(0, 200)
          : "RUNTIME_FAILED",
      },
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
        ...(diagnostic
          ? { toolTraceCount: runtimeResult.toolTraces.length }
          : {}),
      },
      request,
    });
  }

  return NextResponse.json(
    {
      message: messageDto,
      runtime: diagnostic
        ? toPlatformDiagnosticRuntimeDto(runtimeResult)
        : toBusinessRuntimeDto(runtimeResult),
    },
    { status: 201 },
  );
}
