/**
 * /api/admin/onboarding — 厂家入驻向导（平台管理员专用）
 *   GET  企业列表 + 就绪摘要 + 可选行业包
 *   POST 建工厂组织（provisionFactoryOrg，按 code 幂等）
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { listIndustryPacks } from "@/lib/industry-packs/registry";
import {
  findActiveUserIdByEmail,
  getOnboardingStatus,
  listOnboardingOrgs,
  provisionFactoryOrg,
} from "@/lib/organizations/onboarding";
import { onboardingErrorResponse, readJsonBody, validationErrorResponse } from "@/lib/organizations/onboarding-http";
import { DEFAULT_FACTORY_TIMEZONE, validateProvisionRequest } from "@/lib/organizations/onboarding-rules";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const organizations = await listOnboardingOrgs();
    return NextResponse.json({
      organizations,
      packs: listIndustryPacks().map((p) => ({
        id: p.id,
        name: p.name,
        modules: p.enabledModules,
        workspaces: (p.defaultWorkspaces ?? []).map((w) => w.slug),
        hasCatalog: !!p.productCategoryCatalog?.length,
      })),
      defaultTimezone: DEFAULT_FACTORY_TIMEZONE,
    });
  } catch (err) {
    return onboardingErrorResponse(err, "list");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const v = validateProvisionRequest(parsed.body);
  if (!v.ok) return validationErrorResponse(v.errors);
  try {
    const ownerUserId = v.value.ownerEmail ? await findActiveUserIdByEmail(v.value.ownerEmail) : null;
    const result = await provisionFactoryOrg({
      name: v.value.name,
      code: v.value.code,
      industryPackId: v.value.industryPackId,
      timezone: v.value.timezone,
      actorUserId: auth.user.id,
      ownerUserId,
    });
    const status = await getOnboardingStatus(result.orgId);
    return NextResponse.json({ result, status }, { status: result.created ? 201 : 200 });
  } catch (err) {
    return onboardingErrorResponse(err, "provision");
  }
}
