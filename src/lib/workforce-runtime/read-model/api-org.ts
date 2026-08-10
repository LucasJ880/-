/**
 * Workforce Read API — org 解析的生产装配（2D-1 共享，避免每个路由复制）
 *
 * 纯逻辑规则在 api-access.ts（fail-closed：stale activeOrg 拒用、
 * 多可用 org 不随机代选、逐 org canUserUseOrg 现查重授权）；
 * 本文件只做依赖装配：getUserActiveOrgId / canUserUseOrg /
 * active membership 枚举，全部懒加载（纯测试进程不实例化 Prisma）。
 *
 * `/api/workforce/jobs` 与 `/api/workforce/jobs/:id` 共用此入口——
 * org access 逻辑只有一份。
 */

import { resolveWorkforceApiOrg } from "./api-access";
import type { WorkforceApiOrgResolution } from "./api-access";

export async function resolveWorkforceApiOrgForUser(user: {
  id: string;
  role: string;
}): Promise<WorkforceApiOrgResolution> {
  const [{ db }, activeOrg] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/organizations/active-org"),
  ]);
  return resolveWorkforceApiOrg(
    { userId: user.id, userRole: user.role },
    {
      getActiveOrgId: activeOrg.getUserActiveOrgId,
      canUseOrg: activeOrg.canUserUseOrg,
      listActiveMembershipOrgIds: async (userId) => {
        const memberships = await db.organizationMember.findMany({
          where: { userId, status: "active" },
          select: { orgId: true },
        });
        return memberships.map((m) => m.orgId);
      },
    },
  );
}

/**
 * org 解析失败 → HTTP 响应数据（纯数据，路由层负责 NextResponse）。
 * 与 #84 单 Job 路由既有响应完全一致。
 */
export function workforceOrgFailureHttp(
  reason: "NO_ORG" | "ORG_SELECTION_REQUIRED",
): { status: 403; body: Record<string, unknown> } {
  if (reason === "ORG_SELECTION_REQUIRED") {
    return {
      status: 403,
      body: { error: "请先选择工作组织", needsSelection: true },
    };
  }
  return { status: 403, body: { error: "无组织" } };
}
