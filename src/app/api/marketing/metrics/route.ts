import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import { writeMarketingMetricSnapshot } from "@/lib/marketing/metrics";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const snapshots = await db.marketingMetricSnapshot.findMany({ where: { orgId: orgRes.orgId }, orderBy: { capturedAt: "desc" }, take: 100 });
  return NextResponse.json({ snapshots });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  let snapshot;
  try {
    snapshot = await writeMarketingMetricSnapshot({
      orgId: orgRes.orgId,
      userId: user.id,
      source: String(body.source || "manual"),
      ingestionKey: typeof body.ingestionKey === "string" ? body.ingestionKey : null,
      values: body,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "渠道数据无效" },
      { status: 400 },
    );
  }
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_metric_manual_create", targetType: "marketing_metric_snapshot", targetId: snapshot.id, afterData: snapshot, request });
  return NextResponse.json({ snapshot }, { status: 201 });
});
