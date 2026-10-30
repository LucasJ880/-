/**
 * PERM-7：岗位绑定的连库执行（脚本 scripts/bind-positions.ts 与岗位绑定界面共用）
 *
 * 读模板与现有绑定 → （调用方用 position-binding 纯函数校验 / 算差异）→ 写入 → 审计。
 * 审计动作与字段与脚本原有一致（authorization.position.bind / .unbind），via 区分来源。
 * 人类与数字员工绑定按 principalType 分开读写，互不影响。
 */

import { db } from "@/lib/db";
import { logAuthorizationChange } from "./audit";
import type { BindingPlan, BindingPrincipalType } from "./position-binding";

export type BindingRow = {
  id: string;
  principalId: string;
  status: string;
  roleProfile: { key: string };
};

export interface BindingContext {
  /** 本企业 active RoleProfile */
  profiles: Array<{ id: string; key: string; name: string }>;
  profileIdByKey: Map<string, string>;
  /** 本企业该主体类型的全部绑定（含 inactive，用于重新启用） */
  existingRows: BindingRow[];
}

export async function loadBindingContext(orgId: string, principalType: BindingPrincipalType): Promise<BindingContext> {
  const [profiles, existingRows] = await Promise.all([
    db.roleProfile.findMany({
      where: { orgId, status: "active" },
      select: { id: true, key: true, name: true },
      orderBy: { key: "asc" },
    }),
    db.principalRoleBinding.findMany({
      where: { orgId, principalType },
      select: { id: true, principalId: true, status: true, roleProfile: { select: { key: true } } },
    }),
  ]);
  return { profiles, profileIdByKey: new Map(profiles.map((p) => [p.key, p.id])), existingRows };
}

/** 按差异计划写入并逐条审计；返回实际新增 / 停用条数 */
export async function executeBindingPlan(input: {
  orgId: string;
  actorUserId: string;
  principalType: BindingPrincipalType;
  plan: BindingPlan;
  ctx: BindingContext;
  /** 来源：脚本路径或 "console"（岗位绑定界面） */
  via: string;
}): Promise<{ created: number; deactivated: number }> {
  const { orgId, actorUserId, principalType, plan, ctx, via } = input;
  let created = 0;
  let deactivated = 0;

  for (const c of plan.create) {
    const roleProfileId = ctx.profileIdByKey.get(c.profileKey)!;
    const inactive = ctx.existingRows.find(
      (r) => r.principalId === c.userId && r.roleProfile.key === c.profileKey && r.status !== "active",
    );
    if (inactive) {
      await db.principalRoleBinding.update({ where: { id: inactive.id }, data: { status: "active" } });
    } else {
      await db.principalRoleBinding.create({
        data: { orgId, principalType, principalId: c.userId, roleProfileId, status: "active" },
      });
    }
    created++;
    await logAuthorizationChange({
      actorUserId,
      orgId,
      action: "authorization.position.bind",
      targetType: "principal_role_binding",
      targetPrincipalId: c.userId,
      after:
        principalType === "DIGITAL_EMPLOYEE"
          ? { principalType, agentName: c.email, profileKey: c.profileKey, via }
          : { email: c.email, profileKey: c.profileKey, via },
    });
  }

  for (const d of plan.deactivate) {
    const row = ctx.existingRows.find(
      (r) => r.principalId === d.userId && r.roleProfile.key === d.profileKey && r.status === "active",
    );
    if (!row) continue;
    await db.principalRoleBinding.update({ where: { id: row.id }, data: { status: "inactive" } });
    deactivated++;
    await logAuthorizationChange({
      actorUserId,
      orgId,
      action: "authorization.position.unbind",
      targetType: "principal_role_binding",
      targetPrincipalId: d.userId,
      before:
        principalType === "DIGITAL_EMPLOYEE"
          ? { principalType, agentName: d.email, profileKey: d.profileKey }
          : { email: d.email, profileKey: d.profileKey },
      after: { status: "inactive", via },
    });
  }

  return { created, deactivated };
}
