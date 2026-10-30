/**
 * PERM-3：工艺单访问判定（纯函数 + 事务内状态写入）
 */

import type { Prisma } from "@prisma/client";
import { canTransition, timestampField } from "@/lib/blinds/order-state-machine";
import { CATEGORY_POSITION, FULFILLMENT_UMBRELLA_KEY, updateKeyFor, type FulfillmentCategory } from "./category";

export type OrderEditDecision =
  | { allowed: true; via: "umbrella" | "category" | "platform_admin" }
  | { allowed: false; missingCategories: FulfillmentCategory[]; reason: "NO_CATEGORY_KEYS" | "EMPTY_CATEGORIES" };

/**
 * 修改权：伞键 → 允许；否则单的每一个品类都在持有键内才允许；空品类集合只给伞键。
 * heldKeys = 该用户在企业内 ALLOW 的权限键集合（authorize 多键一次性解析）。
 */
export function canEditOrder(input: {
  categories: FulfillmentCategory[];
  heldKeys: ReadonlySet<string> | readonly string[];
  isPlatformAdmin?: boolean;
}): OrderEditDecision {
  const held = input.heldKeys instanceof Set ? input.heldKeys : new Set(input.heldKeys);
  if (input.isPlatformAdmin) return { allowed: true, via: "platform_admin" };
  if (held.has(FULFILLMENT_UMBRELLA_KEY)) return { allowed: true, via: "umbrella" };
  if (input.categories.length === 0) {
    return { allowed: false, missingCategories: [], reason: "EMPTY_CATEGORIES" };
  }
  const missing = input.categories.filter((c) => !held.has(updateKeyFor(c)));
  if (missing.length > 0) return { allowed: false, missingCategories: missing, reason: "NO_CATEGORY_KEYS" };
  return { allowed: true, via: "category" };
}

export function missingCategories(decision: OrderEditDecision): FulfillmentCategory[] {
  return decision.allowed ? [] : decision.missingCategories;
}

/** 负责岗位名（给详情页"本单品类 · 负责岗位"） */
export function responsiblePositions(categories: FulfillmentCategory[]): string[] {
  return categories.map((c) => CATEGORY_POSITION[c].name);
}

/**
 * 企业归属推导（design D3）：客户企业 → 项目企业 → 创建人唯一活跃企业 → null
 */
export function pickOrderOrgId(input: {
  customerOrgId?: string | null;
  projectOrgId?: string | null;
  creatorOrgIds: readonly string[];
}): string | null {
  if (input.customerOrgId) return input.customerOrgId;
  if (input.projectOrgId) return input.projectOrgId;
  if (input.creatorOrgIds.length === 1) return input.creatorOrgIds[0];
  return null;
}

/** 可从 draft ↔ confirmed 退回的"普通推进"集合（不含 scheduled / cancelled，它们各有判定） */
export const PLAIN_TRANSITIONS = new Set(["confirmed", "in_production", "ready", "installed", "completed", "draft"]);

export function isPlainTransition(from: string, to: string): boolean {
  if (to === "draft") return from === "confirmed"; // 退回
  if (!PLAIN_TRANSITIONS.has(to)) return false;
  return canTransition(from, to);
}

type TxLike = Pick<Prisma.TransactionClient, "blindsOrder" | "orderStatusLog">;

/**
 * 置状态 + 时间戳字段 + OrderStatusLog（design D7：transition 路由与作废执行器共用）
 */
export async function applyOrderTransition(
  tx: TxLike,
  order: { id: string; status: string },
  toStatus: string,
  operatorId: string,
  note: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const data: Record<string, unknown> = { status: toStatus, ...extra };
  const ts = timestampField(toStatus);
  if (ts) data[ts] = new Date();
  await tx.blindsOrder.update({ where: { id: order.id }, data: data as Prisma.BlindsOrderUncheckedUpdateInput });
  await tx.orderStatusLog.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus, note, operatorId },
  });
}
