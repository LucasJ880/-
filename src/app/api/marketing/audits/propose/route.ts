/**
 * POST /api/marketing/audits/propose
 * 从市场情报生成七维体检建议稿（不写库）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { proposeAuditFromSignals } from "@/lib/marketing/audit-from-signals";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  try {
    const proposal = await proposeAuditFromSignals(orgRes.orgId);
    return NextResponse.json({ proposal });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成建议失败" },
      { status: 409 },
    );
  }
});
