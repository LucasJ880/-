import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";

export const POST = withAuth(async (request, context, user) => {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const campaign = await db.marketingCampaign.findFirst({ where: { id, orgId: orgRes.orgId }, select: { id: true } });
  if (!campaign) return NextResponse.json({ error: "营销活动不存在" }, { status: 404 });
  if (!body.contentPlanItemId && !body.videoAssetId) return NextResponse.json({ error: "需关联现有内容计划或视频资产" }, { status: 400 });
  if (body.contentPlanItemId) {
    const content = await db.contentPlanItem.findFirst({ where: { id: body.contentPlanItemId, orgId: orgRes.orgId }, select: { id: true, status: true } });
    if (!content) return NextResponse.json({ error: "内容计划不存在或跨组织" }, { status: 400 });
  }
  if (body.videoAssetId) {
    const video = await db.videoAsset.findFirst({ where: { id: body.videoAssetId, orgId: orgRes.orgId }, select: { id: true } });
    if (!video) return NextResponse.json({ error: "视频资产不存在或跨组织" }, { status: 400 });
  }
  const asset = await db.marketingContentAsset.create({ data: {
    orgId: orgRes.orgId,
    campaignId: campaign.id,
    contentPlanItemId: body.contentPlanItemId || null,
    videoAssetId: body.videoAssetId || null,
    assetType: String(body.assetType || "video"),
    variantKey: body.variantKey ? String(body.variantKey) : null,
    approvalStatus: String(body.approvalStatus || "draft"),
    metadataJson: body.metadata ?? undefined,
  } });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_campaign_asset_link", targetType: "marketing_content_asset", targetId: asset.id, afterData: asset, request });
  return NextResponse.json({ asset }, { status: 201 });
});
