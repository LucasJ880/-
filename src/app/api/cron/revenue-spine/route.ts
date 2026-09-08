/**
 * GET /api/cron/revenue-spine — Revenue Spine 定时任务（每 15 分钟）
 *   1. 补跑排队/失败的 Inbound FDE（inputContext.fdeStatus = queued）
 *   2. 重算所有开放商机的 Next Action；到期的生成/刷新 SalesAction 跟进行动 + 通知
 *   3. 长期无动作商机标记进入 stale 队列（不自动流转，只提示）
 */
import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { createFdeAction } from "@/lib/revenue-spine/fde/actions";
import { runInboundSalesFde } from "@/lib/revenue-spine/fde/inbound-sales";
import { NEXT_ACTION_LABELS, applyNextAction, type NextActionType } from "@/lib/revenue-spine/next-action";
import { OPEN_STAGES } from "@/lib/revenue-spine/opportunity-stage";
import { loadRevenueSpinePolicy } from "@/lib/revenue-spine/policy";

export const maxDuration = 300;

const MAX_FDE_PER_ORG = 5;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("revenue-spine-sync", async () => {
    const now = new Date();
    const orgRows = await db.salesOpportunity.groupBy({ by: ["orgId"], where: { stage: { in: [...OPEN_STAGES] } } });
    const results: Array<Record<string, unknown>> = [];
    let failedCount = 0;
    for (const { orgId } of orgRows) {
      try {
        const policy = await loadRevenueSpinePolicy(orgId);
        // 1. 补跑排队的 FDE
        const queued = await db.salesAction.findMany({
          where: { orgId, employeeKey: "inbound_sales_fde", status: { in: ["open", "in_progress"] }, agentRunId: null, opportunityId: { not: null } },
          orderBy: { createdAt: "asc" },
          take: MAX_FDE_PER_ORG,
          select: { id: true, opportunityId: true },
        });
        let fdeRan = 0;
        for (const a of queued) {
          if (!a.opportunityId) continue;
          const r = await runInboundSalesFde({ orgId, opportunityId: a.opportunityId, salesActionId: a.id, trigger: "cron", policy });
          if (r.ok) fdeRan += 1;
          if (r.errorCode === "QUOTA") break;
        }
        // 2. Next action 重算 + 到期行动
        const open = await db.salesOpportunity.findMany({
          where: { orgId, stage: { in: [...OPEN_STAGES] }, customer: { archivedAt: null } },
          select: { id: true, customerId: true, title: true, assignedToId: true, createdById: true },
          take: 1000,
        });
        let dueActions = 0;
        for (const o of open) {
          const next = await applyNextAction(orgId, o.id, { policy, now });
          if (!next || next.at.getTime() > now.getTime() || next.type === "reply_inquiry") continue;
          const label = NEXT_ACTION_LABELS[next.type as NextActionType];
          const action = await createFdeAction({
            orgId,
            customerId: o.customerId,
            opportunityId: o.id,
            actionType: next.type,
            category: "record_followup",
            title: `${label.zh}：${o.title}`.slice(0, 160),
            description: next.reason,
            priority: next.type === "reply_customer" ? "urgent" : "high",
            dueAt: next.at,
            signalKey: `next_action:${next.type}:${next.at.toISOString().slice(0, 10)}`,
            assignedToId: o.assignedToId,
            createdById: o.assignedToId ?? o.createdById,
            inputContext: { nextAction: next, generatedBy: "cron" },
          });
          if (action.createdAt.getTime() >= now.getTime() - 60_000 && o.assignedToId) {
            dueActions += 1;
            await createNotificationsForUsers([o.assignedToId], {
              type: "followup",
              title: `${label.zh}：${o.title}`.slice(0, 120),
              summary: next.reason.slice(0, 140),
              orgId,
              entityType: "revenue_opportunity",
              entityId: o.id,
              priority: next.type === "reply_customer" ? "urgent" : "high",
              metadata: { opportunityId: o.id, salesActionId: action.id, nextActionType: next.type },
              sourceKeyPrefix: `revenue-next-action:${action.id}`,
            }).catch(() => undefined);
          }
        }
        results.push({ orgId, fdeQueued: queued.length, fdeRan, openOpportunities: open.length, dueActions });
      } catch (error) {
        failedCount += 1;
        results.push({ orgId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      data: { organizations: results.length, failedCount, results },
      status: failedCount > 0 ? "partial" : "succeeded",
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
      metadata: { organizations: results.length, failedCount },
    };
  });
  return NextResponse.json({ syncedAt: new Date().toISOString(), ...data });
}
