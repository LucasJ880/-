/**
 * 跨会话搜索 API
 *
 * POST /api/context/search — 语义搜索历史对话
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchHistory } from "@/lib/context/search-engine";
import type { MessageSourceType } from "@/lib/context/types";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json();
  if (!body.query || typeof body.query !== "string") {
    return NextResponse.json({ error: "query 为必填" }, { status: 400 });
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  const results = await searchHistory({
    userId: user.id,
    orgId: membership?.orgId,
    query: body.query,
    sourceTypes: body.sourceTypes as MessageSourceType[] | undefined,
    limit: body.limit ?? 10,
    minSimilarity: body.minSimilarity ?? 0.65,
  });

  return NextResponse.json({
    results: results.map((r) => ({
      ...r,
      content: r.content.slice(0, 800),
    })),
  });
}
