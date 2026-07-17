import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { buildMarketingDailyBrief } from "@/lib/marketing/wechat-daily-brief";
import { logAudit } from "@/lib/audit/logger";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const text = await buildMarketingDailyBrief(orgRes.orgId);
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_daily_brief_generate", targetType: "marketing_daily_brief", afterData: { channel: "preview" }, request });
  return NextResponse.json({ text });
});
