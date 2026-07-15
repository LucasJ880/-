import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { createMarketCompetitor } from "@/lib/market-intelligence/service";
import { canManageMarketIntelligence } from "@/lib/market-intelligence/access";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求内容无效" }, { status: 400 });
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;
  const canManage = await canManageMarketIntelligence({
    userId: user.id,
    platformRole: user.role,
    orgId: orgRes.orgId,
  });
  if (!canManage) {
    return NextResponse.json({ error: "只有组织管理员可以新增竞品监听" }, { status: 403 });
  }

  try {
    const competitor = await createMarketCompetitor({
      orgId: orgRes.orgId,
      userId: user.id,
      name: typeof body.name === "string" ? body.name : "",
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : "",
      targetGeography: typeof body.targetGeography === "string" ? body.targetGeography : undefined,
      primaryProduct: typeof body.primaryProduct === "string" ? body.primaryProduct : undefined,
      salesModel: typeof body.salesModel === "string" ? body.salesModel : undefined,
      watchFocus: typeof body.watchFocus === "string" ? body.watchFocus : undefined,
      scheduleText: typeof body.scheduleText === "string" ? body.scheduleText : undefined,
    });
    return NextResponse.json({ competitor }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "竞品监听创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
