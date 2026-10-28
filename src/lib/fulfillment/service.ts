/**
 * PERM-3：工艺单访问（数据库侧）
 * - heldKeys：一次解析用户在企业内的 ALLOW 权限键（平台 super_admin 经 platformAdminBindings 拿到全部）
 * - resolveOrderOrgId：客户企业 → 项目企业 → 创建人唯一活跃企业 → null
 * - resolveOrderAccess：canRead（全企业读键 或 旧范围：可见项目 / 本人创建 / 无项目时关联客户所在企业的活跃成员）+ canEditOrder
 * - 品类 = 工艺单行 + sunny-process 参数行（国内下单 / 窗帘 / Vinyl / 外采购）的并集
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { resolveEffectiveBindings } from "@/lib/authorization/resolve-effective-permissions";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { loadProcessSpec, type ProcessOrderDb } from "@/lib/sunny-process/autogen";
import { orderCategoriesWithSpec, type FulfillmentCategory } from "./category";
import { canEditOrder, pickOrderOrgId, responsiblePositions, type OrderEditDecision } from "./order-access";

export const ORDER_ACCESS_SELECT = {
  id: true,
  status: true,
  projectId: true,
  creatorId: true,
  customerId: true,
  customer: { select: { orgId: true } },
  project: { select: { orgId: true } },
  items: { select: { productType: true } },
} as const;

export type OrderAccessRow = {
  id: string;
  status: string;
  projectId: string | null;
  creatorId: string;
  customerId: string | null;
  customer: { orgId: string } | null;
  project: { orgId: string | null } | null;
  items: Array<{ productType: string }>;
};

export async function activeOrgIdsOf(userId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({ where: { userId, status: "active" }, select: { orgId: true } });
  return rows.map((r) => r.orgId);
}

export async function loadHeldKeys(user: AuthUser, orgId: string): Promise<Set<string>> {
  const bindings = await resolveEffectiveBindings({ type: "HUMAN", id: user.id, orgId });
  return new Set(bindings.filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey));
}

export async function resolveOrderOrgId(order: Pick<OrderAccessRow, "creatorId" | "customer" | "project">): Promise<string | null> {
  const direct = pickOrderOrgId({ customerOrgId: order.customer?.orgId, projectOrgId: order.project?.orgId, creatorOrgIds: [] });
  if (direct) return direct;
  return pickOrderOrgId({ creatorOrgIds: await activeOrgIdsOf(order.creatorId) });
}

export type OrderAccess = {
  orgId: string | null;
  categories: FulfillmentCategory[];
  heldKeys: Set<string>;
  canRead: boolean;
  edit: OrderEditDecision;
  /** 给前端的摘要 */
  summary: { canEdit: boolean; categories: FulfillmentCategory[]; missingCategories: FulfillmentCategory[]; responsiblePositions: string[] };
};

export async function resolveOrderAccess(user: AuthUser, order: OrderAccessRow): Promise<OrderAccess> {
  const orgId = await resolveOrderOrgId(order);
  const spec = await loadProcessSpec(db as unknown as Pick<ProcessOrderDb, "auditLog">, order.id);
  const categories = orderCategoriesWithSpec(order.items, spec);
  const heldKeys = orgId ? await loadHeldKeys(user, orgId) : new Set<string>();
  const isPlatformAdmin = isPlatformSuperAdmin(user.role);

  // 旧范围：可见项目的单 + 本人创建（项目可见性作为附加条件保留）
  let legacyVisible = order.creatorId === user.id;
  let projectOk = true;
  if (order.projectId) {
    const visible = await getVisibleProjectIds(user.id, user.role);
    projectOk = visible === null || visible.includes(order.projectId);
    legacyVisible = legacyVisible || projectOk;
  } else if (!legacyVisible && order.customer?.orgId) {
    // sunny-process：自动生成的单无项目、创建人是销售 → 关联客户所在企业的活跃成员可读（工厂核对）
    legacyVisible = (await activeOrgIdsOf(user.id)).includes(order.customer.orgId);
  }
  const orgRead = Boolean(orgId) && heldKeys.has("orders.fulfillment.read");
  const canRead = isPlatformAdmin || ((orgRead || legacyVisible) && projectOk);

  const editRaw = canEditOrder({ categories, heldKeys, isPlatformAdmin });
  const edit: OrderEditDecision = canRead ? editRaw : { allowed: false, missingCategories: categories, reason: "NO_CATEGORY_KEYS" };

  return {
    orgId,
    categories,
    heldKeys,
    canRead,
    edit,
    summary: {
      canEdit: edit.allowed,
      categories,
      missingCategories: edit.allowed ? [] : edit.missingCategories,
      responsiblePositions: responsiblePositions(categories),
    },
  };
}

/**
 * 列表：持 orders.fulfillment.read 时返回"属于 orgId 的工艺单"的 where 与后置过滤；否则 null（走旧范围）。
 * 创建人多企业的无客户无项目单推不出企业 → 后置过滤掉（spec：只对创建人与平台管理员可见）。
 */
export async function orgWideOrderFilter(user: AuthUser, orgId: string): Promise<null | {
  where: Record<string, unknown>;
  postFilter: (rows: Array<{ customerId: string | null; projectId: string | null; creatorId: string }>) => Promise<Set<string>>;
}> {
  const held = await loadHeldKeys(user, orgId);
  if (!held.has("orders.fulfillment.read")) return null;
  return {
    where: {
      OR: [
        { customer: { orgId } },
        { customerId: null, project: { orgId } },
        { customerId: null, projectId: null, creator: { orgMemberships: { some: { orgId, status: "active" } } } },
        { creatorId: user.id },
      ],
    },
    postFilter: async (rows) => {
      const creatorIds = [...new Set(rows.filter((r) => !r.customerId && !r.projectId).map((r) => r.creatorId))];
      const multi = new Set<string>();
      for (const cid of creatorIds) {
        if (cid === user.id) continue;
        if ((await activeOrgIdsOf(cid)).length !== 1) multi.add(cid);
      }
      return multi; // 需要剔除的创建人
    },
  };
}
