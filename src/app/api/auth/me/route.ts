import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { parseCompanyIds, getCompaniesByIds } from "@/lib/companies/service";
import { hasAutopilotCapability } from "@/lib/autopilot/access";
import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";

export const GET = withAuth(async (_request, _ctx, user) => {
  // 公司归属（联合品牌）：左上角显示「青砚 × 公司logo」
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { companyIdsJson: true, activeOrgId: true },
  });
  const companies = await getCompaniesByIds(parseCompanyIds(row?.companyIdsJson));
  const autopilotAllowed = hasAutopilotCapability(
    { id: user.id, role: user.role },
    "autopilot.view",
  );

  // PERM-4c5：当前企业的岗位派生平台角色（前端按业务角色显示模块用；role 保持平台角色不变）
  let orgForRole = row?.activeOrgId ?? null;
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
      activeOrgId: row?.activeOrgId ?? null,
      autopilotAllowed,
      effectiveRole,
    },
  });
});
