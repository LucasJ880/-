/**
 * POST /api/visualizer/sessions/[id]/share
 *
 * - body: { ttlDays?, revoke? }
 * - revoke=true：清空 shareToken / shareExpiresAt
 * - 否则：生成新 token + 默认 7 天有效期（最长 60 天）
 *
 * 仅会话可见者（销售/管理员）可生成。
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { canSeeVisualizerSession } from "@/lib/visualizer/access";
import {
  generateVisualizerShareToken,
  makeShareExpiresAt,
} from "@/lib/visualizer/share";
import type { CreateVisualizerShareRequest } from "@/lib/visualizer/types";

function buildShareUrl(req: Request, token: string): string {
  const url = new URL(req.url);
  return `${url.origin}/sales/share/visualizer/${token}`;
}

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const session = await db.visualizerSession.findUnique({
    where: { id },
    select: {
      id: true,
      createdById: true,
      salesOwnerId: true,
      shareToken: true,
      shareExpiresAt: true,
      customer: { select: { createdById: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<CreateVisualizerShareRequest>(request);

  if (body?.revoke) {
    await db.visualizerSession.update({
      where: { id },
      data: { shareToken: null, shareExpiresAt: null },
    });
    return NextResponse.json({
      shareToken: null,
      shareExpiresAt: null,
      shareUrl: null,
    });
  }

  const token = generateVisualizerShareToken();
  const expiresAt = makeShareExpiresAt(body?.ttlDays);

  const updated = await db.visualizerSession.update({
    where: { id },
    data: { shareToken: token, shareExpiresAt: expiresAt },
    select: { shareToken: true, shareExpiresAt: true },
  });

  return NextResponse.json({
    shareToken: updated.shareToken,
    shareExpiresAt: updated.shareExpiresAt?.toISOString() ?? null,
    shareUrl: updated.shareToken ? buildShareUrl(request, updated.shareToken) : null,
  });
});
