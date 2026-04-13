/**
 * 微信消息历史 API
 *
 * GET /api/messaging/messages — 获取消息历史
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const cursor = searchParams.get("cursor");

  const messages = await db.weChatMessage.findMany({
    where: {
      userId: user.id,
      ...(channel ? { channel } : {}),
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      direction: true,
      channel: true,
      content: true,
      messageType: true,
      agentProcessed: true,
      createdAt: true,
    },
  });

  const hasMore = messages.length > limit;
  const items = hasMore ? messages.slice(0, limit) : messages;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  return NextResponse.json({
    messages: items,
    nextCursor,
    hasMore,
  });
}
