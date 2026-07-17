import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { getMarketingBrandProfileAccess, requireMarketingWriteAccess } from "@/lib/marketing/access";
import { validateBrandTruth } from "@/lib/marketing/brand-validation";
import { logAudit } from "@/lib/audit/logger";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const profile = await db.marketingBrandProfile.findUnique({ where: { orgId: orgRes.orgId } });
  const permissions = await getMarketingBrandProfileAccess(user, orgRes.orgId);
  return NextResponse.json({ profile, permissions });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const validation = validateBrandTruth(body);
  const previous = await db.marketingBrandProfile.findUnique({ where: { orgId: orgRes.orgId } });
  const data = {
    legalName: validation.value.legalName,
    brandName: validation.value.brandName,
    website: validation.value.website,
    phone: validation.value.phone,
    addressLine: validation.value.addressLine,
    city: validation.value.city,
    region: validation.value.region,
    country: validation.value.country,
    postalCode: validation.value.postalCode,
    timezone: validation.value.timezone,
    industry: validation.value.industry,
    productsJson: validation.value.products,
    serviceAreasJson: validation.value.serviceAreas,
    targetAudiencesJson: validation.value.targetAudiences,
    competitorsJson: validation.value.competitors,
    forbiddenContextsJson: validation.value.forbiddenContexts,
    canonicalNapJson: {
      name: validation.value.brandName,
      address: [validation.value.addressLine, validation.value.city, validation.value.region, validation.value.postalCode, validation.value.country].filter(Boolean).join(", "),
      phone: validation.value.phone,
    },
    validationStatus: validation.status,
    validationScore: validation.score,
    validationIssues: JSON.parse(JSON.stringify(validation.issues)),
    validatedAt: validation.status === "valid" ? new Date() : null,
    validatedById: validation.status === "valid" ? user.id : null,
    updatedById: user.id,
  };
  const profile = await db.marketingBrandProfile.upsert({
    where: { orgId: orgRes.orgId },
    create: { orgId: orgRes.orgId, ...data },
    update: data,
  });
  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: previous ? "marketing_brand_profile_update" : "marketing_brand_profile_create",
    targetType: "marketing_brand_profile",
    targetId: profile.id,
    beforeData: previous,
    afterData: { ...profile, validationIssues: validation.issues },
    request,
  });
  return NextResponse.json({ profile, validation });
});
