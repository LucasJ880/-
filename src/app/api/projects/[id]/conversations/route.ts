import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { getEnvironmentInProject } from "@/lib/prompts/scope";
import {
  isValidChannel,
} from "@/lib/conversations/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { runAgentForConversation } from "@/lib/runtime/agent-runtime";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const environmentId = searchParams.get("environmentId")?.trim() ?? "";
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const statusFilter = searchParams.get("status")?.trim() ?? "";
  const channelFilter = searchParams.get("channel")?.trim() ?? "";
  const startDate = searchParams.get("startDate")?.trim() ?? "";
  const endDate = searchParams.get("endDate")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20)
  );

  const where: Record<string, unknown> = { projectId };
  if (environmentId) where.environmentId = environmentId;
  if (statusFilter) where.status = statusFilter;
  if (channelFilter) where.channel = channelFilter;
  if (keyword) {
    where.title = { contains: keyword, mode: "insensitive" };
  }
  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.createdAt = dateFilter;
  }

  const [total, conversations] = await Promise.all([
    db.conversation.count({ where }),
    db.conversation.findMany({
      where,
      include: {
        environment: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const promptIds = conversations
    .map((c) => c.promptId)
    .filter((id): id is string => !!id);
  const kbIds = conversations
    .map((c) => c.knowledgeBaseId)
    .filter((id): id is string => !!id);

  const [promptMap, kbMap] = await Promise.all([
    promptIds.length > 0
      ? db.prompt
          .findMany({
            where: { id: { in: promptIds } },
            select: { id: true, key: true, name: true },
          })
          .then((ps) => new Map(ps.map((p) => [p.id, p])))
      : Promise.resolve(new Map<string, { id: string; key: string; name: string }>()),
    kbIds.length > 0
      ? db.knowledgeBase
          .findMany({
            where: { id: { in: kbIds } },
            select: { id: true, key: true, name: true },
          })
          .then((ks) => new Map(ks.map((k) => [k.id, k])))
      : Promise.resolve(new Map<string, { id: string; key: string; name: string }>()),
  ]);

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      channel: c.channel,
      status: c.status,
      environment: c.environment,
      user: c.user,
      messageCount: c.messageCount,
      totalTokens: c.totalTokens,
      estimatedCost: c.estimatedCost,
      startedAt: c.startedAt,
      lastMessageAt: c.lastMessageAt,
      prompt: c.promptId ? promptMap.get(c.promptId) ?? null : null,
      knowledgeBase: c.knowledgeBaseId
        ? kbMap.get(c.knowledgeBaseId) ?? null
        : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => ({}));

  const environmentId =
    typeof body.environmentId === "string" ? body.environmentId.trim() : "";
  if (!environmentId) {
    return NextResponse.json(
      { error: "environmentId 必填" },
      { status: 400 }
    );
  }

  const env = await getEnvironmentInProject(projectId, environmentId);
  if (!env) {
    return NextResponse.json(
      { error: "环境不存在或不属于该项目" },
      { status: 404 }
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "新会话";

  const channel =
    typeof body.channel === "string" && isValidChannel(body.channel)
      ? body.channel
      : "web";

  const agentId =
    typeof body.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : null;

  let promptId =
    typeof body.promptId === "string" && body.promptId.trim()
      ? body.promptId.trim()
      : null;
  let knowledgeBaseId =
    typeof body.knowledgeBaseId === "string" && body.knowledgeBaseId.trim()
      ? body.knowledgeBaseId.trim()
      : null;
  const initialMessage =
    typeof body.initialMessage === "string" && body.initialMessage.trim()
      ? body.initialMessage.trim()
      : null;

  let agentKey: string | null = null;
  let agentConfigSnapshot: string | null = null;

  if (agentId) {
    const agent = await db.agent.findFirst({
      where: { id: agentId, projectId },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
    }
    agentKey = agent.key;
    agentConfigSnapshot = JSON.stringify({
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      systemBehaviorNote: agent.systemBehaviorNote,
    });
    if (!promptId && agent.promptId) promptId = agent.promptId;
    if (!knowledgeBaseId && agent.knowledgeBaseId) knowledgeBaseId = agent.knowledgeBaseId;
  }

  let promptVersionId: string | null = null;
  let kbVersionId: string | null = null;
  let promptKey: string | null = null;
  let kbKey: string | null = null;
  let systemPromptSnapshot: string | null = null;

  if (promptId) {
    const p = await db.prompt.findFirst({
      where: { id: promptId, projectId },
      include: {
        activeVersion: { select: { id: true, content: true } },
      },
    });
    if (p) {
      promptVersionId = p.activeVersionId;
      promptKey = p.key;
      systemPromptSnapshot = p.activeVersion?.content ?? null;
    }
  }

  if (knowledgeBaseId) {
    const kb = await db.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, projectId },
    });
    if (kb) {
      kbVersionId = kb.activeVersionId;
      kbKey = kb.key;
    }
  }

  const now = new Date();

  const conversation = await db.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        projectId,
        environmentId,
        userId: user.id,
        title,
        channel,
        status: "active",
        promptId,
        promptVersionId,
        knowledgeBaseId,
        knowledgeBaseVersionId: kbVersionId,
        agentId: agentId ?? undefined,
        startedAt: now,
        messageCount: initialMessage ? 1 : 0,
        lastMessageAt: initialMessage ? now : null,
      },
    });

    await tx.conversationContextSnapshot.create({
      data: {
        conversationId: conv.id,
        promptId,
        promptVersionId,
        promptKey,
        knowledgeBaseId,
        knowledgeBaseVersionId: kbVersionId,
        knowledgeBaseKey: kbKey,
        environmentId,
        systemPromptSnapshot,
        extraConfigJson: agentConfigSnapshot,
      },
    });

    if (initialMessage) {
      await tx.message.create({
        data: {
          conversationId: conv.id,
          role: "user",
          content: initialMessage,
          contentType: "text",
          sequence: 1,
          status: "success",
        },
      });
    }

    return conv;
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.CONVERSATION,
    targetId: conversation.id,
    afterData: {
      environmentId,
      channel,
      agentId,
      agentKey,
      promptId,
      knowledgeBaseId,
      hasInitialMessage: !!initialMessage,
    },
    request,
  });

  const autoRun = body.autoRun === true && !!initialMessage;

  if (!autoRun) {
    return NextResponse.json({ conversation }, { status: 201 });
  }

  const runtimeResult = await runAgentForConversation({
    conversationId: conversation.id,
    projectId,
  });

  return NextResponse.json({ conversation, runtime: runtimeResult }, { status: 201 });
}
