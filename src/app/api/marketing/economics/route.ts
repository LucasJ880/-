import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { normalizeMarketingEconomics } from "@/lib/marketing/economics";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const setting = await db.marketingEconomicsSetting.findUnique({
    where: { orgId: orgRes.orgId },
  });
  return NextResponse.json({
    setting: setting || {
      defaultGrossMarginRate: null,
      targetRoas: null,
      targetRoi: null,
      attributionWindowDays: 90,
      currency: "CAD",
      productMarginsJson: [],
    },
  });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  let values;
  try {
    values = normalizeMarketingEconomics(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "经济模型设置无效" },
      { status: 400 },
    );
  }
  const { productMargins, ...scalarValues } = values;
  const setting = await db.marketingEconomicsSetting.upsert({
    where: { orgId: orgRes.orgId },
    create: {
      orgId: orgRes.orgId,
      ...scalarValues,
      productMarginsJson: productMargins,
      updatedById: user.id,
    },
    update: {
      ...scalarValues,
      productMarginsJson: productMargins,
      updatedById: user.id,
    },
  });
  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "marketing_economics_update",
    targetType: "marketing_economics_setting",
    targetId: setting.id,
    afterData: setting,
    request,
  });
  return NextResponse.json({ setting });
});
