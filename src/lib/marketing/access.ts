import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { canAccessMarketingWorkspace } from "@/lib/marketing/route-access";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditMarketingBrandProfile } from "./access-policy";
export { canAccessMarketingWorkspace } from "./route-access";

export async function getMarketingBrandProfileAccess(
  user: AuthUser,
  orgId: string,
): Promise<{ canEdit: boolean; membershipRole: string | null }> {
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    select: { role: true, status: true },
  });
  return {
    canEdit: await canEditMarketingBrandProfile(user, orgId),
    membershipRole: membership?.status === "active" ? membership.role : null,
  };
}

export async function requireMarketingWriteAccess(
  user: AuthUser,
  orgId: string,
): Promise<NextResponse | null> {
  const access = await getMarketingBrandProfileAccess(user, orgId);
  if (access.canEdit) return null;
  return NextResponse.json(
    { error: "当前账号为只读成员，无法修改增长中心数据" },
    { status: 403 },
  );
}

/**
 * PERM-4c5：增长中心只读接口在岗位模式企业按岗位派生平台角色拦销售（等同旧模式中间件对平台角色 sales 的拦截；
 * 压扁后 JWT 角色为 user，中间件放行，由这里拦）。旧模式企业派生角色 = 平台角色，结果与中间件一致。
 */
export async function requireMarketingReadAccess(
  user: AuthUser,
  orgId: string,
): Promise<NextResponse | null> {
  const role = await resolveEffectivePlatformRole({ userId: user.id, orgId, platformRole: user.role });
  if (canAccessMarketingWorkspace(role)) return null;
  return NextResponse.json({ error: "销售账号无权访问营销工作区" }, { status: 403 });
}

/**
 * 销售账号只使用销售 / 报价数字员工，不开放营销数字员工。
 * 其他角色沿用现有组织成员权限，避免影响运营与管理账号。
 */
export function canUseMarketingDigitalEmployee(
  role: string | null | undefined,
): boolean {
  return Boolean(role && role !== "sales");
}
