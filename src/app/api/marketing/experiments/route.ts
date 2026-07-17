import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const experiments = await db.marketingExperiment.findMany({ where: { orgId: orgRes.orgId }, include: { campaign: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ experiments });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const campaign = await db.marketingCampaign.findFirst({ where: { id: String(body.campaignId || ""), orgId: orgRes.orgId }, select: { id: true } });
  if (!campaign) return NextResponse.json({ error: "营销活动不存在或跨组织" }, { status: 400 });
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!body.name || !body.hypothesis || !body.primaryMetric || variants.length < 2) return NextResponse.json({ error: "实验需要名称、假设、主指标和至少两个变体" }, { status: 400 });
  const experiment = await db.marketingExperiment.create({ data: {
    orgId: orgRes.orgId,
    campaignId: campaign.id,
    name: String(body.name).slice(0, 200),
    hypothesis: String(body.hypothesis).slice(0, 4000),
    primaryMetric: String(body.primaryMetric).slice(0, 100),
    secondaryMetricsJson: Array.isArray(body.secondaryMetrics) ? body.secondaryMetrics : [],
    variantsJson: variants.slice(0, 50),
    trafficAllocationJson: body.trafficAllocation ?? undefined,
    status: String(body.status || "draft"),
    stopCondition: body.stopCondition ? String(body.stopCondition).slice(0, 2000) : null,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    createdById: user.id,
  } });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_experiment_create", targetType: "marketing_experiment", targetId: experiment.id, afterData: experiment, request });
  return NextResponse.json({ experiment }, { status: 201 });
});
