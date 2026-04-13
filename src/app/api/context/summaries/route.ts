/**
 * 会话摘要 API
 *
 * GET  /api/context/summaries          — 获取用户最近的会话摘要
 * POST /api/context/summaries          — 压缩指定会话 / 批量压缩
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  compressSession,
  compressAllUserSessions,
  getRecentSummaries,
} from "@/lib/context/compressor";
import type { SessionSourceType } from "@/lib/context/types";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "10", 10);

  const summaries = await getRecentSummaries(user.id, limit);
  return NextResponse.json({ summaries });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  if (body.action === "compress_all") {
    const count = await compressAllUserSessions(user.id, membership?.orgId);
    return NextResponse.json({ message: `已压缩 ${count} 个会话`, count });
  }

  if (!body.sourceType || !body.sessionId) {
    return NextResponse.json(
      { error: "需要 sourceType 和 sessionId" },
      { status: 400 },
    );
  }

  const result = await compressSession({
    userId: user.id,
    sourceType: body.sourceType as SessionSourceType,
    sessionId: body.sessionId,
    force: body.force ?? false,
  });

  if (!result) {
    return NextResponse.json({ message: "消息不足，暂不压缩" });
  }

  return NextResponse.json({ summary: result });
}
