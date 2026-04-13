/**
 * 消息索引管理 API
 *
 * POST /api/context/index — 索引/重建用户消息嵌入
 * GET  /api/context/index — 获取索引统计
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  indexAiThreadMessages,
  indexTradeChatMessages,
  getIndexStats,
  rebuildIndex,
} from "@/lib/context/search-engine";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const stats = await getIndexStats(user.id);
  return NextResponse.json({ stats });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  const action = body.action ?? "index";

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  if (action === "rebuild") {
    const count = await rebuildIndex(user.id, membership?.orgId);
    return NextResponse.json({ message: `已重建索引，共 ${count} 条`, count });
  }

  let indexed = 0;
  const sourceType = body.sourceType ?? "all";

  if (sourceType === "ai_message" || sourceType === "all") {
    indexed += await indexAiThreadMessages(user.id);
  }
  if ((sourceType === "trade_chat" || sourceType === "all") && membership?.orgId) {
    indexed += await indexTradeChatMessages(user.id, membership.orgId);
  }

  return NextResponse.json({ message: `已索引 ${indexed} 条新消息`, indexed });
}
