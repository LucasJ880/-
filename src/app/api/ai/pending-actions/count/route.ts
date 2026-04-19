/**
 * GET /api/ai/pending-actions/count
 * 轻量接口：返回当前用户"未过期的 pending 草稿"数量。
 * 给侧边栏红点用，避免每次拉 50 条完整列表。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (_request, _ctx, user) => {
  const count = await db.pendingAction.count({
    where: {
      createdById: user.id,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });

  return NextResponse.json({ count });
});
