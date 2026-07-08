/**
 * POST /api/service-inbox/[id]/reply — 在青砚里回复客户（经机器人微信号发出）
 *
 * body: { text: string, orgId?: string }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { replyToConversation } from "@/lib/service-inbox/service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const orgRes = await resolveRequestOrgIdForUser(
    user,
    (body.orgId as string | undefined) ?? request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "回复内容不能为空" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "回复内容过长" }, { status: 400 });
  }

  const result = await replyToConversation({
    orgId: orgRes.orgId,
    conversationId: id,
    userId: user.id,
    text,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
});
