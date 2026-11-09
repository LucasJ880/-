/**
 * USR-1：平台邀请码绑定企业时的查库校验（校验规则本身见 onboarding-rules.ts 的 validateAdminInviteOrgBinding）。
 */
import { db } from "@/lib/db";

/** 绑定的企业须存在且启用（注册时还会再查一次） */
export async function findBindableOrg(orgId: string): Promise<{ id: string; name: string; companyId: string | null } | null> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, status: true, companyId: true },
  });
  if (!org || org.status !== "active") return null;
  return { id: org.id, name: org.name, companyId: org.companyId };
}
