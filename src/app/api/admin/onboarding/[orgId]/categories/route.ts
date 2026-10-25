/**
 * POST /api/admin/onboarding/[orgId]/categories — 发布企业产品品类（平台管理员专用）
 * body: { make: string[], dontMake: string[], excludedCategoryAction?: "review" | "decline" }
 * 未勾选的品类 = 不确定。写入 revenue_spine.business_profile 新版本（其余商务事实原样保留）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { getOnboardingStatus, setOrgProductCategories } from "@/lib/organizations/onboarding";
import { onboardingErrorResponse, readJsonBody } from "@/lib/organizations/onboarding-http";

type Ctx = { params: Promise<{ orgId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const published = await setOrgProductCategories(orgId, parsed.body, auth.user.id);
    const status = await getOnboardingStatus(orgId);
    return NextResponse.json({ published, status });
  } catch (err) {
    return onboardingErrorResponse(err, "categories");
  }
}
