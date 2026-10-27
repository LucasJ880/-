/**
 * 工艺单服务端接线：真实 db / 通知门控 / 可见性。路由只调这里。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { shouldDeliverInApp } from "@/lib/notifications/delivery-gate";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
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
 * 工艺单可见性（导出 / 工艺参数 / 状态转换）：
 *   平台管理员；创建人；所属项目可见；或关联客户所在组织的活跃成员（自动生成的单由销售创建，工厂同组织可见）。
 */
export async function canViewBlindsOrder(
  order: { projectId: string | null; creatorId: string; customerId: string | null },
  user: { id: string; role: string },
): Promise<boolean> {
  const visible = await getVisibleProjectIds(user.id, user.role);
  if (visible === null) return true;
  if (order.creatorId === user.id) return true;
  if (order.projectId) return visible.includes(order.projectId);
  if (order.customerId) {
    const customer = await db.salesCustomer.findUnique({ where: { id: order.customerId }, select: { orgId: true } });
    if (!customer?.orgId) return false;
    const member = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: customer.orgId, userId: user.id } },
      select: { status: true },
    });
    return member?.status === "active";
  }
  return false;
}

/** 工艺单所属组织（经关联客户）；无客户的历史手工单为 null */
export async function orderOrgId(order: { customerId: string | null }): Promise<string | null> {
  if (!order.customerId) return null;
  const c = await db.salesCustomer.findUnique({ where: { id: order.customerId }, select: { orgId: true } });
  return c?.orgId ?? null;
}
