import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { createDraft } from "@/lib/pending-actions/drafts";
import { logAudit } from "@/lib/audit/logger";
import { ensureGrowthCenterProject, resolveMarketingLeader } from "@/lib/marketing/team";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const campaigns = await db.marketingCampaign.findMany({
    where: { orgId: orgRes.orgId },
    include: { assets: true, publications: true, experiments: true, _count: { select: { attributions: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ campaigns });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const profile = await db.marketingBrandProfile.findUnique({ where: { orgId: orgRes.orgId } });
  if (profile?.validationStatus !== "valid") return NextResponse.json({ error: "企业事实中心校验通过后才能创建活动" }, { status: 409 });

  const name = String(body.name || "").trim();
  const objective = String(body.objective || "").trim();
  const primaryConversion = String(body.primaryConversion || "").trim();
  if (!name || !objective || !primaryConversion) return NextResponse.json({ error: "name、objective、primaryConversion 为必填项" }, { status: 400 });

  const geography = String(body.geography || "").trim();
  const product = String(body.product || "").trim();
  const serviceAreas = Array.isArray(profile.serviceAreasJson) ? profile.serviceAreasJson.map(String) : [];
  const products = Array.isArray(profile.productsJson) ? profile.productsJson.map(String) : [];
  const matches = (value: string, allowed: string[]) => !value || allowed.some((item) => item.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(item.toLowerCase()));
  if (!matches(geography, serviceAreas)) return NextResponse.json({ error: "活动地域不在企业事实中心确认的服务地区内" }, { status: 422 });
  if (!matches(product, products)) return NextResponse.json({ error: "活动产品未经企业事实中心确认" }, { status: 422 });

  const requestApproval = body.requestApproval !== false;
  const campaign = await db.marketingCampaign.create({ data: {
    orgId: orgRes.orgId,
    name: name.slice(0, 200),
    objective: objective.slice(0, 1000),
    product: product || null,
    geography: geography || null,
    offer: body.offer ? String(body.offer).slice(0, 1000) : null,
    primaryConversion: primaryConversion.slice(0, 100),
    status: requestApproval ? "awaiting_approval" : "draft",
    budget: body.budget == null ? null : Math.max(0, Number(body.budget) || 0),
    currency: String(body.currency || "CAD").slice(0, 3).toUpperCase(),
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    createdById: user.id,
  } });

  let pendingAction: unknown = null;
  if (requestApproval) {
    const project = await ensureGrowthCenterProject(orgRes.orgId, user.id);
    const leaderId = await resolveMarketingLeader({ orgId: orgRes.orgId, projectId: project.id, requesterId: user.id });
    const draft = await createDraft({
      type: "marketing.activate_campaign",
      title: `审批营销活动：${campaign.name}`,
      preview: [`目标：${campaign.objective}`, campaign.product && `产品：${campaign.product}`, campaign.geography && `地域：${campaign.geography}`, campaign.budget != null && `预算：${campaign.currency} ${campaign.budget}`].filter(Boolean).join("\n"),
      payload: { campaignId: campaign.id, metadata: { orgId: orgRes.orgId, targetType: "marketing_campaign", targetId: campaign.id } },
      userId: user.id,
      orgId: orgRes.orgId,
      projectId: project.id,
      approverUserId: leaderId,
      requiredRole: "project_admin",
      ttlHours: 72,
    });
    pendingAction = draft.data;
  }
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_campaign_create", targetType: "marketing_campaign", targetId: campaign.id, afterData: campaign, request });
  return NextResponse.json({ campaign, pendingAction }, { status: 201 });
});
