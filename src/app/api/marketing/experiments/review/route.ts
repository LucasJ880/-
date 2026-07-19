/**
 * POST /api/marketing/experiments/review
 * 按变体汇总指标，返回方向性信号；不写 winner，需人在实验页确认。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { reviewMarketingExperiments } from "@/lib/marketing/experiment-review";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const experimentId =
    typeof body.experimentId === "string" && body.experimentId.trim()
      ? body.experimentId.trim()
      : null;

  const result = await reviewMarketingExperiments({
    orgId: orgRes.orgId,
    experimentId,
  });
  return NextResponse.json(result);
});
