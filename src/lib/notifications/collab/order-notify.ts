/**
 * 协作通知 COLLAB-2：工艺单阶段接线（design D6、D7）
 *
 * `POST /api/blinds-orders/[id]/transition` 与 `PUT /api/blinds-orders/[id]` 在事务提交之后 await 这里：
 * 状态变为已确认 / 开始生产 / 备货完成 / 已排期之一且与原状态不同时，
 * 通知创建人、关联商机的负责人与下一阶段负责角色。不向外抛错：任何一步出错只记 console.error。
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { AUTOMATION_TIMEZONE, loadOrgTimezone } from "@/lib/automation/registry";
import { blindsOrderAccess } from "@/lib/sunny-process/server";
import { deliverCollabNotification } from "./deliver";
import { isOrderStage, orderStageEvent, type OrderEventOrder } from "./events";
import { orderStageRecipients } from "./recipients";

export async function notifyOrderStageChanged(input: {
  beforeStatus: string;
  /** 写入后的工艺单（事务里重读的那一条） */
  order: (OrderEventOrder & { creatorId: string; opportunityId: string | null }) | null;
  actor: AuthUser;
}): Promise<void> {
  const { beforeStatus, order, actor } = input;
  try {
    if (!order || beforeStatus === order.status || !isOrderStage(order.status)) return;

    // 所属组织与品类取自该单的访问判断，按写入之后的行与参数重算（PUT 可能同时改了行）
    const access = await blindsOrderAccess(order.id, actor);
    const orgId = access?.orgId ?? null;
    const opportunity = order.opportunityId
      ? await db.salesOpportunity.findUnique({
          where: { id: order.opportunityId },
          select: { assignedToId: true },
        })
      : null;

    const recipientIds = await orderStageRecipients({
      toStatus: order.status,
      creatorId: order.creatorId,
      opportunityOwnerId: opportunity?.assignedToId ?? null,
      orgId,
      categories: access?.categories ?? [],
    });
    const timeZone =
      order.status === "scheduled" && orgId ? await loadOrgTimezone(orgId) : AUTOMATION_TIMEZONE;
    const event = orderStageEvent({
      beforeStatus,
      order,
      recipientIds,
      ctx: { actorId: actor.id, actorName: actor.name, orgId },
      timeZone,
    });
    if (event) await deliverCollabNotification(event);
  } catch (err) {
    console.error(`[collab-notify] 工艺单阶段通知失败 order=${order?.id ?? "?"}`, err);
  }
}
