import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canReadPlaybook,
  resolveEffectiveAccountContext,
} from "@/lib/operations/playbook";

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canReadPlaybook(user.role)) {
    return NextResponse.json({ error: "无权查看账号上下文" }, { status: 403 });
  }
  const { id: accountId } = await ctx.params;
  const sp = request.nextUrl.searchParams;
  const orgRes = await resolveRequestOrgIdForUser(user, sp.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  try {
    const result = await resolveEffectiveAccountContext({
      orgId: orgRes.orgId,
      accountId,
      campaignId: sp.get("campaignId"),
      contentPlanItemId: sp.get("contentPlanItemId"),
      allowDraftPreview: sp.get("preview") === "1",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "解析失败" },
      { status: 400 },
    );
  }
});
