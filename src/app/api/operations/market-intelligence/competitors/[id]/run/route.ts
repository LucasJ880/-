import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { runMarketCompetitorNow } from "@/lib/market-intelligence/service";
import { canManageMarketIntelligence } from "@/lib/market-intelligence/access";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgRes = await resolveRequestOrgIdForUser(user, body?.orgId ?? null);
  if (!orgRes.ok) return orgRes.response;
  const canManage = await canManageMarketIntelligence({
    userId: user.id,
    platformRole: user.role,
    orgId: orgRes.orgId,
  });
  if (!canManage) {
    return NextResponse.json({ error: "只有组织管理员可以执行竞品监听" }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const run = await runMarketCompetitorNow(orgRes.orgId, id);
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "执行失败" },
      { status: 400 },
    );
  }
});
