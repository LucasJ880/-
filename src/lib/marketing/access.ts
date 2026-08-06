import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditMarketingBrandProfile } from "./access-policy";

export async function getMarketingBrandProfileAccess(
  user: AuthUser,
  orgId: string,
): Promise<{ canEdit: boolean; membershipRole: string | null }> {
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    select: { role: true, status: true },
  });
  return {
    canEdit: canEditMarketingBrandProfile(user.role, membership),
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
 * 销售账号只使用销售 / 报价数字员工，不开放营销数字员工。
 * 其他角色沿用现有组织成员权限，避免影响运营与管理账号。
 */
export function canUseMarketingDigitalEmployee(
  role: string | null | undefined,
): boolean {
  return Boolean(role && role !== "sales");
}
