import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";

const COUNT_FIELDS = ["impressions", "views", "engagements", "clicks", "leads", "qualifiedLeads", "appointments", "quotes", "wins"] as const;
function nonNegative(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

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
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
  if (Number.isNaN(capturedAt.getTime())) return NextResponse.json({ error: "capturedAt 无效" }, { status: 400 });
  const counts = Object.fromEntries(COUNT_FIELDS.map((field) => [field, nonNegative(body[field])]));
  const snapshot = await db.marketingMetricSnapshot.create({ data: {
    orgId: orgRes.orgId,
    source: String(body.source || "manual"),
    channelAccountId: typeof body.channelAccountId === "string" ? body.channelAccountId : null,
    campaignId: typeof body.campaignId === "string" ? body.campaignId : null,
    publicationId: typeof body.publicationId === "string" ? body.publicationId : null,
    capturedAt,
    ...counts,
    spend: Math.max(0, Number(body.spend) || 0),
    revenue: Math.max(0, Number(body.revenue) || 0),
    currency: String(body.currency || "CAD").slice(0, 3).toUpperCase(),
    rawJson: body.raw ?? undefined,
    createdById: user.id,
  } });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_metric_manual_create", targetType: "marketing_metric_snapshot", targetId: snapshot.id, afterData: snapshot, request });
  return NextResponse.json({ snapshot }, { status: 201 });
});
