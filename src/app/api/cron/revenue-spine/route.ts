/**
 * GET /api/cron/revenue-spine — Revenue Spine 定时任务（每 15 分钟）
 *   1. 重算所有开放商机的 Next Action；到期的生成/刷新 SalesAction 跟进行动 + 通知
 *   2. 长期无动作商机标记进入 stale 队列（不自动流转，只提示）
 *   3. 首封回复后买家没回信：第 3 / 7 / 14 天起草跟进邮件进审批（不发送）
 *   4. 兜底执行来信 FDE：queued / run_blocked / failed / 认领过期的 running（failed 与过期 running 有次数上限），
 *      全部经 runQueuedInboundFde 原子认领（与 webhook 的 after() 回调、站点重发互斥），
 *      按组织轮转、按墙钟截止（不再按组织固定条数）。放在最后：前几步只有 DB 往返、耗时有界，
 *      FDE 每个约 90 s，用剩余预算跑。
 */
import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { createFdeAction } from "@/lib/revenue-spine/fde/actions";
import { drainInboundFdeQueue } from "@/lib/revenue-spine/fde/inbound-claim";
import { draftNoReplyFollowUps } from "@/lib/revenue-spine/fde/no-reply-followup";
import { NEXT_ACTION_LABELS, applyNextAction, type NextActionType } from "@/lib/revenue-spine/next-action";
import { OPEN_STAGES } from "@/lib/revenue-spine/opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "@/lib/revenue-spine/policy";
import { settleReceiptsForSalesAction } from "@/lib/trade/website-inquiry";

export const maxDuration = 300;

/**
 * 从本次 cron 开始超过此时长就不再启动新的 FDE（已启动的跑完）。单个 FDE ≈ 90 s
 * （RFQ 抽取 LLM ≤25 s + 草稿润色 LLM ≤20 s + DB），200 s 时起跑的最后一个仍在 maxDuration 300 s 内结束。
 */
const FDE_START_DEADLINE_MS = 200_000;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("revenue-spine-sync", async () => {
    const startedAt = Date.now();
    const now = new Date();
    const orgRows = await db.salesOpportunity.groupBy({ by: ["orgId"], where: { stage: { in: [...OPEN_STAGES] } } });
    const results: Array<Record<string, unknown>> = [];
    const policies = new Map<string, RevenueSpinePolicy>();
    let failedCount = 0;
    for (const { orgId } of orgRows) {
      try {
        const policy = await loadRevenueSpinePolicy(orgId);
        policies.set(orgId, policy);
        // 1. Next action 重算 + 到期行动
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
          // 无回复跟进已经起草成审批草稿（步骤 4，另有「待审批」通知）：这里只留行动记录，不再重复通知
          const draftsHandleIt = next.type === "follow_up" && policy.followUp.noReplyFollowUpDays.length > 0;
          if (action.createdAt.getTime() >= now.getTime() - 60_000 && o.assignedToId && !draftsHandleIt) {
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
        // 3. 无回复跟进草稿
        const followUps = await draftNoReplyFollowUps(orgId, { policy, now });
        results.push({ orgId, openOpportunities: open.length, dueActions, followUpDrafts: followUps.drafted });
      } catch (error) {
        failedCount += 1;
        results.push({ orgId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    // 4. 来信 FDE 兜底（每个组织的查询与认领都按 orgId 限定；上面失败的组织照样处理）
    const drained = await drainInboundFdeQueue({
      orgIds: orgRows.map((r) => r.orgId),
      deadlineAt: startedAt + FDE_START_DEADLINE_MS,
      now,
      policies,
      afterRun: async (orgId, salesActionId) => {
        await settleReceiptsForSalesAction(orgId, salesActionId);
      },
    });
    for (const d of drained.results) {
      const row = results.find((r) => r.orgId === d.orgId);
      const fdeFields = { fdeQueued: d.fdeQueued, fdeRan: d.fdeRan, fdeSucceeded: d.fdeSucceeded, fdeSkipped: d.fdeSkipped, ...(d.quotaBlocked ? { fdeQuotaBlocked: true } : {}), ...(d.error ? { fdeError: d.error } : {}) };
      if (row) Object.assign(row, fdeFields);
      // 组织级失败只计一次（next action 已失败的组织不重复计）
      if (d.error && !row?.error) failedCount += 1;
    }
    return {
      data: { organizations: results.length, failedCount, fdeDeadlineReached: drained.deadlineReached, results },
      status: failedCount > 0 ? "partial" : "succeeded",
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
      metadata: { organizations: results.length, failedCount },
    };
  });
  return NextResponse.json({ syncedAt: new Date().toISOString(), ...data });
}
