/**
 * 工艺单服务端接线：真实 db / 通知门控 / 可见性。路由只调这里。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { shouldDeliverInApp } from "@/lib/notifications/delivery-gate";
import type { AuthUser } from "@/lib/auth";
import { ORDER_ACCESS_SELECT, resolveOrderAccess, type OrderAccess, type OrderAccessRow } from "@/lib/fulfillment/service";
import {
  generateProcessOrderForSignedQuote,
  type GenerationResult,
  type NotifyFn,
  type ProcessOrderDb,
} from "./autogen";

export const processOrderDb = db as unknown as ProcessOrderDb;

/** 站内通知（尊重用户通知偏好）；不发邮件 / 微信 */
export const notifyProcessOrder: NotifyFn = async (n) => {
  if (!(await shouldDeliverInApp(n.userId, { type: n.type, priority: n.priority }))) return;
  await createNotification(n);
};

/** 签字路由调用：从不抛出 */
export function generateForSignedQuote(quoteId: string): Promise<GenerationResult> {
  return generateProcessOrderForSignedQuote(quoteId, { db: processOrderDb, notify: notifyProcessOrder });
}

/**
 * 工艺单可见性（详情 / 导出 / 工艺参数 / 挪行 / 状态转换）：与 PERM-3 `resolveOrderAccess().canRead` 同一规则——
 *   平台管理员；持 orders.fulfillment.read 的本企业成员；创建人；所属项目可见；
 *   或无项目时关联客户所在组织的活跃成员（自动生成的单由销售创建，工厂同组织可见）。项目不可见一律不可见。
 */
export async function canViewBlindsOrder(order: { id: string }, user: AuthUser): Promise<boolean> {
  return (await blindsOrderAccess(order.id, user))?.canRead ?? false;
}

/** 读取工艺单访问判定（含品类修改权）；单不存在返回 null */
export async function blindsOrderAccess(orderId: string, user: AuthUser): Promise<OrderAccess | null> {
  const row = await db.blindsOrder.findUnique({ where: { id: orderId }, select: ORDER_ACCESS_SELECT });
  if (!row) return null;
  return resolveOrderAccess(user, row as unknown as OrderAccessRow);
}

/** 工艺单所属组织（经关联客户）；无客户的历史手工单为 null */
export async function orderOrgId(order: { customerId: string | null }): Promise<string | null> {
  if (!order.customerId) return null;
  const c = await db.salesCustomer.findUnique({ where: { id: order.customerId }, select: { orgId: true } });
  return c?.orgId ?? null;
}
