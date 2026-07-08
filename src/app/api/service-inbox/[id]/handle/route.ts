/**
 * POST /api/service-inbox/[id]/handle — 标记会话已处理
 * （客服在微信里直接回复过、或该消息无需回复时，手动清除未回状态）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { markConversationHandled } from "@/lib/service-inbox/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const orgRes = await resolveRequestOrgIdForUser(
    user,
    (body.orgId as string | undefined) ?? request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const ok = await markConversationHandled({
    orgId: orgRes.orgId,
    conversationId: id,
    userId: user.id,
  });
  if (!ok) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
