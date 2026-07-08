/**
 * GET /api/service-inbox/[id] — 单个客服会话 + 消息记录
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const conversation = await db.serviceConversation.findFirst({
    where: { id, orgId: orgRes.orgId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      channel: conversation.channel,
      externalUserId: conversation.externalUserId,
      displayName: conversation.displayName,
      status: conversation.status,
      unansweredSince: conversation.unansweredSince?.toISOString() ?? null,
      messages: conversation.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        content: m.content,
        messageType: m.messageType,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
});
