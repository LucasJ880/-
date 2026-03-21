import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  isValidRating,
  isValidScore,
  isValidFeedbackStatus,
  isValidSentiment,
  isValidIssueType,
  FEEDBACK_STATUSES,
  ISSUE_TYPES,
} from "@/lib/feedback/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const sp = new URL(request.url).searchParams;
  const environmentId = sp.get("environmentId")?.trim() || undefined;
  const conversationId = sp.get("conversationId")?.trim() || undefined;
  const agentId = sp.get("agentId")?.trim() || undefined;
  const issueType = sp.get("issueType")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const rating = sp.get("rating") ? parseInt(sp.get("rating")!, 10) : undefined;
  const keyword = sp.get("keyword")?.trim() || "";
  const startDate = sp.get("startDate")?.trim() || "";
  const endDate = sp.get("endDate")?.trim() || "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10) || 20));

  const where: Record<string, unknown> = { projectId };
  if (environmentId) where.environmentId = environmentId;
  if (conversationId) where.conversationId = conversationId;
  if (agentId) where.agentId = agentId;
  if (issueType && (ISSUE_TYPES as readonly string[]).includes(issueType)) where.issueType = issueType;
  if (status && (FEEDBACK_STATUSES as readonly string[]).includes(status)) where.status = status;
  if (rating && rating >= 1 && rating <= 5) where.rating = rating;
  if (keyword) where.note = { contains: keyword, mode: "insensitive" };
  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.createdAt = dateFilter;
  }

  const [items, total] = await Promise.all([
    db.conversationFeedback.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { tags: { include: { tag: true } } },
    }),
    db.conversationFeedback.count({ where: where as never }),
  ]);

  return NextResponse.json({
    items,
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

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "无效请求体" }, { status: 400 });

  const { conversationId, rating, scoreAccuracy, scoreHelpfulness, scoreSafety, scoreCompleteness, sentiment, issueType, note, tagIds } = body;

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json({ error: "conversationId 必填" }, { status: 400 });
  }
  if (!isValidRating(rating)) {
    return NextResponse.json({ error: "rating 必须为 1-5 整数" }, { status: 400 });
  }
  if (scoreAccuracy !== undefined && !isValidScore(scoreAccuracy)) {
    return NextResponse.json({ error: "scoreAccuracy 必须为 1-5 或空" }, { status: 400 });
  }
  if (scoreHelpfulness !== undefined && !isValidScore(scoreHelpfulness)) {
    return NextResponse.json({ error: "scoreHelpfulness 必须为 1-5 或空" }, { status: 400 });
  }
  if (scoreSafety !== undefined && !isValidScore(scoreSafety)) {
    return NextResponse.json({ error: "scoreSafety 必须为 1-5 或空" }, { status: 400 });
  }
  if (scoreCompleteness !== undefined && !isValidScore(scoreCompleteness)) {
    return NextResponse.json({ error: "scoreCompleteness 必须为 1-5 或空" }, { status: 400 });
  }
  if (sentiment && !isValidSentiment(sentiment)) {
    return NextResponse.json({ error: "无效 sentiment" }, { status: 400 });
  }
  if (issueType && !isValidIssueType(issueType)) {
    return NextResponse.json({ error: "无效 issueType" }, { status: 400 });
  }

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, projectId },
    include: { contextSnapshots: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  if (!conv) {
    return NextResponse.json({ error: "会话不存在或不属于本项目" }, { status: 404 });
  }

  const snapshot = conv.contextSnapshots[0];

  const feedback = await db.conversationFeedback.create({
    data: {
      projectId,
      environmentId: conv.environmentId,
      conversationId: conv.id,
      agentId: conv.agentId ?? null,
      promptId: snapshot?.promptId ?? null,
      promptVersionId: snapshot?.promptVersionId ?? null,
      knowledgeBaseId: conv.knowledgeBaseId ?? null,
      knowledgeBaseVersionId: snapshot?.knowledgeBaseVersionId ?? null,
      createdById: user.id,
      rating,
      scoreAccuracy: scoreAccuracy ?? null,
      scoreHelpfulness: scoreHelpfulness ?? null,
      scoreSafety: scoreSafety ?? null,
      scoreCompleteness: scoreCompleteness ?? null,
      sentiment: sentiment ?? "neutral",
      issueType: issueType ?? null,
      note: typeof note === "string" ? note.slice(0, 2000) : null,
      status: "open",
      ...(Array.isArray(tagIds) && tagIds.length > 0
        ? { tags: { create: tagIds.map((tid: string) => ({ tagId: tid })) } }
        : {}),
    },
    include: { tags: { include: { tag: true } } },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId,
    action: AUDIT_ACTIONS.CREATE_CONVERSATION_FEEDBACK,
    targetType: AUDIT_TARGETS.CONVERSATION_FEEDBACK,
    targetId: feedback.id,
    afterData: { conversationId, rating, issueType },
    request,
  });

  return NextResponse.json({ feedback }, { status: 201 });
}
