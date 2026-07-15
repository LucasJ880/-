import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";

export async function canManageMarketIntelligence(input: {
  userId: string;
  platformRole: string;
  orgId: string;
}): Promise<boolean> {
  if (isAdmin(input.platformRole) || input.platformRole === "manager") return true;
  const membership = await db.organizationMember.findFirst({
    where: {
      userId: input.userId,
      orgId: input.orgId,
      role: "org_admin",
      status: "active",
    },
    select: { id: true },
  });
  return Boolean(membership);
}
