import { NextResponse } from "next/server";
import { getRequestPreview } from "@/lib/preview/server";
import { activePreviewFor, previewBannerInfo } from "@/lib/preview/identity";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { parseCompanyIds, getCompaniesByIds } from "@/lib/companies/service";
import { hasAutopilotCapability } from "@/lib/autopilot/access";
import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";

export const GET = withAuth(async (request, _ctx, user) => {
  // 公司归属（联合品牌）：左上角显示「青砚 × 公司logo」
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { companyIdsJson: true, activeOrgId: true },
  });
  const companies = await getCompaniesByIds(parseCompanyIds(row?.companyIdsJson));
  // VIS-1e：以岗位预览（spec authorization/position-preview「横幅与失效」）。active 时当前企业为预览企业、无 Autopilot
  const previewState = await getRequestPreview(request, user.id);
  const preview = activePreviewFor(previewState, user.id);
  const activeOrgId = preview ? preview.orgId : (row?.activeOrgId ?? null);
  const autopilotAllowed =
    !preview &&
    hasAutopilotCapability(
      { id: user.id, role: user.role },
      "autopilot.view",
    );

  // PERM-4c5：当前企业的岗位派生平台角色（前端按业务角色显示模块用；role 保持平台角色不变）
  let orgForRole = activeOrgId;
  if (!orgForRole) {
    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id, status: "active" },
      select: { orgId: true },
      take: 2,
    });
    orgForRole = memberships.length === 1 ? memberships[0].orgId : null;
  }
  const effectiveRole = await resolveEffectivePlatformRole({
    userId: user.id,
    orgId: orgForRole,
    platformRole: user.role,
  });

  return NextResponse.json({
    user: {
      ...user,
      companies,
      activeOrgId,
      autopilotAllowed,
      effectiveRole,
    },
    preview: previewState ? previewBannerInfo(previewState) : null,
  });
});
