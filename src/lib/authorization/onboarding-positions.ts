/**
 * PERM-6b：入驻 / 交接负责人 / 经企业邀请码注册之后的默认岗位
 *
 * - 落地岗位模板并按 seed 规则自动绑（org_owner / org_admin 系统模板、平台 sales → sales_rep、平台 trade → trade_rep；
 *   已有任何绑定的人不动，见 seedOrgAuthorizationProfiles）。
 * - 岗位模式企业且行业包有 owner 岗位时，把平台管理员在入驻 / 交接中指定的企业负责人绑 owner（管理层信号）。
 *   这是平台管理员的显式指定，不是"所有 org_owner 自动当管理层"（4c1 / 4c2 口径不变）；审计 via onboarding。
 * 岗位模式下没有绑定 = 没有权限（4c3），所以入驻流程必须在建好成员后落岗位。
 */

import { db } from "@/lib/db";
import { OWNER_POSITION_KEY } from "./position-binding";
import { executeBindingPlan, loadBindingContext } from "./position-binding-service";
import { hasPositionTemplates } from "./role-defaults";
import { seedOrgAuthorizationProfiles } from "./seed-org-profiles";

export async function ensureDefaultPositions(input: {
  orgId: string;
  actorUserId: string;
  /** 入驻 / 交接中指定的企业负责人；为空只落模板与自动绑 */
  ownerUserId?: string | null;
}): Promise<{ ownerBound: boolean }> {
  await seedOrgAuthorizationProfiles(input.orgId);
  if (!input.ownerUserId) return { ownerBound: false };

  const org = await db.organization.findUnique({ where: { id: input.orgId }, select: { industryPackId: true } });
  if (!hasPositionTemplates(org?.industryPackId)) return { ownerBound: false };

  const ctx = await loadBindingContext(input.orgId, "HUMAN");
  if (!ctx.profileIdByKey.has(OWNER_POSITION_KEY)) return { ownerBound: false };
  const alreadyActive = ctx.existingRows.some(
    (r) => r.principalId === input.ownerUserId && r.roleProfile.key === OWNER_POSITION_KEY && r.status === "active",
  );
  if (alreadyActive) return { ownerBound: false };

  const owner = await db.user.findUnique({ where: { id: input.ownerUserId }, select: { email: true } });
  await executeBindingPlan({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    principalType: "HUMAN",
    plan: {
      create: [{ email: owner?.email ?? input.ownerUserId, userId: input.ownerUserId, profileKey: OWNER_POSITION_KEY }],
      keep: [],
      deactivate: [],
    },
    ctx,
    via: "onboarding",
  });
  return { ownerBound: true };
}
