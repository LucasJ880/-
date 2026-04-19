/**
 * GET /api/ai/pending-actions
 * 查询当前用户的待审批动作（默认 pending；可选 ?status=xxx、?threadId=xxx）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "pending";
  const threadId = searchParams.get("threadId");

  const actions = await db.pendingAction.findMany({
    where: {
      createdById: user.id,
      ...(status === "all" ? {} : { status }),
      ...(threadId ? { threadId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      title: true,
      preview: true,
      status: true,
      threadId: true,
      messageId: true,
      expiresAt: true,
      decidedAt: true,
      executedAt: true,
      failureReason: true,
      resultRef: true,
      createdAt: true,
    },
  });

  // 附上所属对话的标题（PR4.5 Inbox 要显示"在哪个对话里产生的"）
  const threadIds = Array.from(
    new Set(actions.map((a) => a.threadId).filter(Boolean) as string[]),
  );
  const threads =
    threadIds.length > 0
      ? await db.aiThread.findMany({
          where: { id: { in: threadIds }, userId: user.id },
          select: { id: true, title: true },
        })
      : [];
  const threadTitleById = new Map(threads.map((t) => [t.id, t.title]));

  const enriched = actions.map((a) => ({
    ...a,
    threadTitle: a.threadId ? (threadTitleById.get(a.threadId) ?? null) : null,
  }));

  return NextResponse.json({ actions: enriched });
});
