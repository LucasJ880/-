import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  deleteMarketCompetitor,
  setMarketCompetitorActive,
} from "@/lib/market-intelligence/service";
import { canManageMarketIntelligence } from "@/lib/market-intelligence/access";

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    typeof body?.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;
  const canManage = await canManageMarketIntelligence({
    userId: user.id,
    platformRole: user.role,
    orgId: orgRes.orgId,
  });
  if (!canManage) {
    return NextResponse.json({ error: "只有组织管理员可以修改竞品监听" }, { status: 403 });
  }
  if (typeof body?.active !== "boolean") {
    return NextResponse.json({ error: "需要 active: boolean" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const competitor = await setMarketCompetitorActive({
      orgId: orgRes.orgId,
      competitorId: id,
      active: body.active,
    });
    return NextResponse.json({ competitor });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 400 },
    );
  }
});

export const DELETE = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const canManage = await canManageMarketIntelligence({
    userId: user.id,
    platformRole: user.role,
    orgId: orgRes.orgId,
  });
  if (!canManage) {
    return NextResponse.json({ error: "只有组织管理员可以删除竞品监听" }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    await deleteMarketCompetitor(orgRes.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 400 },
    );
  }
});
