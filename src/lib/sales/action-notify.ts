/**
 * 销售自动行动 → 站内通知（批次二：提醒闭环，站内版）
 *
 * 此前 sales-actions cron 每 15 分钟生成行动但不通知任何人——销售不打开
 * 页面就永远不知道有事逾期。本模块把新行动接到站内通知：
 * - urgent：实时单发（每条行动一次，sourceKey 幂等）
 * - high/medium：按人按天聚合一条摘要（sourceKey 含 Toronto 日期，天然节流）
 *
 * 微信推送按 Lucas 决策暂缓；本模块只走站内。通知失败绝不影响行动同步。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { torontoDateStr } from "@/lib/time";

export interface CreatedActionForNotify {
  id: string;
  orgId: string;
  customerId: string;
  assignedToId: string | null;
  priority: string;
  title: string;
}

export function buildUrgentActionSourceKey(actionId: string): string {
  return `sales-action-urgent:${actionId}`;
}

export function buildDailyDigestSourceKey(
  orgId: string,
  userId: string,
  torontoDate: string,
): string {
  return `sales-actions-daily:${orgId}:${torontoDate}:${userId}`;
}

/** 摘要文案（纯函数，供测试）；openTotal 含本次新增 */
export function buildDailyDigestSummary(args: {
  newCount: number;
  openTotal: number;
}): string {
  const { newCount, openTotal } = args;
  if (openTotal > newCount) {
    return `数字员工新增 ${newCount} 件客户跟进行动，你目前共有 ${openTotal} 件待处理。打开「客户与商机」的行动面板逐件处理。`;
  }
  return `数字员工新增 ${newCount} 件客户跟进行动。打开「客户与商机」的行动面板逐件处理。`;
}

/**
 * 对本轮新建的自动行动发站内通知。
 * 幂等：urgent 按行动 id 去重；每日摘要按 orgId+userId+Toronto 日期去重，
 * 15 分钟一次的 cron 反复触发也只会各发一条。
 */
export async function notifyNewSalesActions(
  created: CreatedActionForNotify[],
  now: Date = new Date(),
): Promise<{ urgentSent: number; digestSent: number }> {
  let urgentSent = 0;
  let digestSent = 0;
  if (created.length === 0) return { urgentSent, digestSent };

  const dateStr = torontoDateStr(now);

  // ── urgent：实时单发 ──
  const urgentActions = created.filter(
    (a) => a.priority === "urgent" && a.assignedToId,
  );
  for (const action of urgentActions) {
    try {
      await createNotification({
        userId: action.assignedToId!,
        orgId: action.orgId,
        type: "followup",
        title: `紧急跟进 — ${action.title.slice(0, 80)}`,
        summary: "数字员工判定该客户需要立即跟进，点开直达客户详情。",
        priority: "urgent",
        entityType: "sales_customer",
        entityId: action.customerId,
        sourceKey: buildUrgentActionSourceKey(action.id),
      });
      urgentSent += 1;
    } catch (error) {
      console.warn("[action-notify] urgent notify failed:", error);
    }
  }

  // ── high/medium：按人按天聚合 ──
  const byAssignee = new Map<string, { orgId: string; newCount: number }>();
  for (const action of created) {
    if (!action.assignedToId || action.priority === "urgent") continue;
    const current = byAssignee.get(action.assignedToId);
    if (current) current.newCount += 1;
    else byAssignee.set(action.assignedToId, { orgId: action.orgId, newCount: 1 });
  }

  for (const [userId, group] of byAssignee) {
    try {
      const openTotal = await db.salesAction.count({
        where: {
          orgId: group.orgId,
          assignedToId: userId,
          status: { in: ["open", "in_progress"] },
        },
      });
      const result = await createNotification({
        userId,
        orgId: group.orgId,
        type: "followup",
        title: "今日客户跟进提醒",
        summary: buildDailyDigestSummary({
          newCount: group.newCount,
          openTotal,
        }),
        priority: "high",
        entityType: "sales_actions",
        sourceKey: buildDailyDigestSourceKey(group.orgId, userId, dateStr),
      });
      // createNotification 命中 sourceKey 去重时返回已存在行；只有当天首发计数
      if (result.createdAt.getTime() >= now.getTime() - 60_000) {
        digestSent += 1;
      }
    } catch (error) {
      console.warn("[action-notify] digest notify failed:", error);
    }
  }

  return { urgentSent, digestSent };
}
