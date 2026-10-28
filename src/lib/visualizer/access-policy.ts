/**
 * Visualizer 可见性纯函数（不 import db，可脱离数据库单测）
 *
 * 原则：先企业、后范围。
 * - 企业边界：session 归属 = customer.orgId；不属于当前企业一律不可见（任何平台角色都不例外）
 * - 企业内范围：
 *   - super_admin / dataScope=all（admin / boss）：看本企业全部
 *   - 其他角色（sales / trade / user …）：只看
 *     1) 自己创建的 session（createdById = me）
 *     2) 自己作为 salesOwner 的 session（salesOwnerId = me）
 *     3) 所属 customer 是自己创建的
 *
 * 这样能覆盖：销售 A 创建客户后，销售 B 代做方案 → B 建 session 后 A 仍可见。
 * （创建 session 也必须先通过客户可见性校验）
 */

import { isGlobalScope } from "@/lib/rbac/data-scope";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";

export type MinimalUser = { id: string; role: string | null | undefined };

/** ok 放行；not_found 跨企业（与不存在同响应，不暴露存在性）；forbidden 同企业内无权 */
export type VisualizerAccess = "ok" | "not_found" | "forbidden";

export type SessionAccessFields = {
  createdById: string;
  salesOwnerId: string | null;
  customer: { createdById: string | null; orgId: string };
};

function seesWholeOrg(user: MinimalUser): boolean {
  return isPlatformSuperAdmin(user.role) || isGlobalScope(user.role);
}

/** 列表查询 where 片段：始终带 customer.orgId 企业边界 */
export function visualizerSessionListScope(
  user: MinimalUser,
  orgId: string,
): Record<string, unknown> {
  const orgClause = { customer: { orgId } };
  if (seesWholeOrg(user)) return { AND: [orgClause] };
  return {
    AND: [
      orgClause,
      {
        OR: [
          { createdById: user.id },
          { salesOwnerId: user.id },
          { customer: { createdById: user.id } },
        ],
      },
    ],
  };
}

/** 单条 session 可见性（含经 image / region / variant / productOption 反查到的 session） */
export function visualizerSessionAccess(
  session: SessionAccessFields,
  user: MinimalUser,
  orgId: string,
): VisualizerAccess {
  if (session.customer.orgId !== orgId) return "not_found";
  if (seesWholeOrg(user)) return "ok";
  if (session.createdById === user.id) return "ok";
  if (session.salesOwnerId && session.salesOwnerId === user.id) return "ok";
  if (session.customer.createdById === user.id) return "ok";
  return "forbidden";
}

export type CustomerCreateFields = {
  orgId: string;
  archivedAt: Date | null;
  createdById: string | null;
};

/**
 * 新建 / 打开 session 前的客户校验：
 * - 客户不存在或不属于当前企业 → 404（同文案）
 * - 已归档 → 400
 * - 非全企业范围必须是客户创建人 → 403
 */
export function customerCreateAccess(
  customer: CustomerCreateFields | null,
  user: MinimalUser,
  orgId: string,
): { ok: true } | { ok: false; reason: string; status: number } {
  if (!customer || customer.orgId !== orgId) {
    return { ok: false, reason: "客户不存在", status: 404 };
  }
  if (customer.archivedAt) {
    return { ok: false, reason: "该客户已归档，无法创建可视化方案", status: 400 };
  }
  if (!seesWholeOrg(user) && customer.createdById !== user.id) {
    return { ok: false, reason: "无权为该客户创建可视化方案", status: 403 };
  }
  return { ok: true };
}
