/**
 * GET /api/service-inbox — 客服会话列表（按组织隔离）
 *
 * query: orgId（多组织用户必带，apiFetch 自动附加）、status（open/handled，默认全部）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = request.nextUrl;
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const status = searchParams.get("status");
  const conversations = await db.serviceConversation.findMany({
    where: {
      orgId: orgRes.orgId,
      ...(status === "open" || status === "handled" ? { status } : {}),
    },
    orderBy: [{ unansweredSince: { sort: "asc", nulls: "last" } }, { lastCustomerMessageAt: "desc" }],
    take: 100,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, direction: true, createdAt: true },
      },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      externalUserId: c.externalUserId,
      displayName: c.displayName,
      status: c.status,
      lastCustomerMessageAt: c.lastCustomerMessageAt?.toISOString() ?? null,
      lastReplyAt: c.lastReplyAt?.toISOString() ?? null,
      unansweredSince: c.unansweredSince?.toISOString() ?? null,
      lastMessage: c.messages[0]
        ? {
            content: c.messages[0].content.slice(0, 80),
            direction: c.messages[0].direction,
            createdAt: c.messages[0].createdAt.toISOString(),
          }
        : null,
    })),
  });
});
