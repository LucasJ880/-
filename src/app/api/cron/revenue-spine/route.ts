/**
 * GET /api/cron/revenue-spine — Revenue Spine 定时任务（每 15 分钟）
 *   1. 兜底执行来信 FDE（先跑，与改动前一致——来信回复最要紧）：queued / run_blocked / failed / 认领过期的 running
 *      （failed、过期 running 与非配额 run_blocked 有次数上限），全部经 runQueuedInboundFde 原子认领
 *      （与 webhook 的 after() 回调、站点重发、人工入口互斥），按组织轮转、按墙钟截止（不再按组织固定条数）。
 *   2. 自动搁置（B-5，policy.autonomy.autoStale 开启的组织才做，默认关闭）：超过 followUp.staleAfterDays 天无互动、
 *      买家未来信、无在途审批的开放商机转 stale（source = system，审计带 policy 键名），按负责人汇总站内通知。
 *      放在 next action 之前，被搁置的商机本轮不再生成到期跟进行动。未开启的组织仍只在 /revenue 的 Stale 队列展示。
 *   3. 重算所有开放商机的 Next Action；到期的生成/刷新 SalesAction 跟进行动 + 通知
 *   4. 首封回复后买家没回信：第 3 / 7 / 14 天起草跟进邮件进审批（不发送）
 */
import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { runAutoStale } from "@/lib/revenue-spine/autonomy";
import { createFdeAction } from "@/lib/revenue-spine/fde/actions";
import { drainInboundFdeQueue } from "@/lib/revenue-spine/fde/inbound-queue";
import { draftNoReplyFollowUps } from "@/lib/revenue-spine/fde/no-reply-followup";
import { NEXT_ACTION_LABELS, applyNextAction, type NextActionType } from "@/lib/revenue-spine/next-action";
import { OPEN_STAGES } from "@/lib/revenue-spine/opportunity-stage";
import { loadRevenueSpinePolicy } from "@/lib/revenue-spine/policy";
import { settleReceiptsForSalesAction } from "@/lib/trade/website-inquiry";

export const maxDuration = 300;

/**
 * 时间预算（从本次 cron 开始计，maxDuration 300 s）：
 *   - FDE_START_DEADLINE_MS 之后不再启动新的 FDE，已启动的跑完。单个 FDE ≈ 90 s（RFQ 抽取 LLM ≤25 s +
 *     草稿润色 LLM ≤20 s + DB + 收据回填），最后一个最晚 120 s 起跑、约 215 s 前结束。
 *   - MAINTENANCE_DEADLINE_MS 之后步骤 2–4 不再开始新的组织 / 商机（都是幂等的，下一轮接着做），给 300 s 留余量。
 *     没有 FDE 积压时（after() 正常执行）步骤 2–4 几乎拿到整个预算。
 */
const FDE_START_DEADLINE_MS = 120_000;
const MAINTENANCE_DEADLINE_MS = 270_000;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("revenue-spine-sync", async () => {
    const startedAt = Date.now();
    const now = new Date();
    const orgRows = await db.salesOpportunity.groupBy({ by: ["orgId"], where: { stage: { in: [...OPEN_STAGES] } } });
    const rows = new Map<string, Record<string, unknown>>(orgRows.map(({ orgId }) => [orgId, { orgId }]));
    const failedOrgs = new Set<string>();

    // 1. 来信 FDE 兜底（每个组织的查询与认领都按 orgId 限定）
    const drained = await drainInboundFdeQueue({
      orgIds: orgRows.map((r) => r.orgId),
      deadlineAt: startedAt + FDE_START_DEADLINE_MS,
      now,
      afterRun: async (orgId, salesActionId) => {
        await settleReceiptsForSalesAction(orgId, salesActionId);
      },
    });
    for (const d of drained.results) {
      Object.assign(rows.get(d.orgId) ?? {}, {
        fdeQueued: d.fdeQueued,
        fdeExecuted: d.fdeExecuted,
        fdeRan: d.fdeRan,
        fdeSkipped: d.fdeSkipped,
        ...(d.quotaBlocked ? { fdeQuotaBlocked: true } : {}),
        ...(d.error ? { fdeError: d.error } : {}),
      });
      if (d.error) failedOrgs.add(d.orgId);
    }

    // 2–4. 自动搁置 / Next action / 无回复跟进（过了 MAINTENANCE_DEADLINE_MS 不再开始新的组织或商机）
    let maintenanceDeadlineReached = false;
    const pastMaintenanceDeadline = () => {
      if (Date.now() - startedAt < MAINTENANCE_DEADLINE_MS) return false;
      maintenanceDeadlineReached = true;
      return true;
    };
    for (const { orgId } of orgRows) {
      const row = rows.get(orgId)!;
      if (pastMaintenanceDeadline()) {
        row.maintenanceSkipped = true;
        continue;
      }
      try {
        const policy = await loadRevenueSpinePolicy(orgId);
        // 2. 自动搁置（开关关闭时不查询、不流转）
        if (policy.autonomy.autoStale) {
          const autoStale = await runAutoStale(orgId, { policy, now, shouldStop: pastMaintenanceDeadline });
          row.autoStale = autoStale;
          if (autoStale.truncated) row.maintenanceTruncated = true;
        }
        // 3. Next action 重算 + 到期行动
        const open = await db.salesOpportunity.findMany({
          where: { orgId, stage: { in: [...OPEN_STAGES] }, customer: { archivedAt: null } },
          select: { id: true, customerId: true, title: true, assignedToId: true, createdById: true },
          take: 1000,
        });
        let dueActions = 0;
        let truncated = false;
        for (const o of open) {
          if (pastMaintenanceDeadline()) {
            truncated = true;
            break;
          }
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
        // 4. 无回复跟进草稿
        const followUps = truncated || pastMaintenanceDeadline() ? null : await draftNoReplyFollowUps(orgId, { policy, now });
        Object.assign(row, {
          openOpportunities: open.length,
          dueActions,
          followUpDrafts: followUps?.drafted ?? 0,
          ...(followUps ? {} : { maintenanceTruncated: true }),
        });
      } catch (error) {
        failedOrgs.add(orgId);
        row.error = error instanceof Error ? error.message : String(error);
      }
    }

    // 组织级失败只计一次（FDE 与 next action 都失败的组织不重复计）
    const results = [...rows.values()];
    const failedCount = failedOrgs.size;
    return {
      data: { organizations: results.length, failedCount, fdeDeadlineReached: drained.deadlineReached, maintenanceDeadlineReached, results },
      status: failedCount > 0 ? "partial" : "succeeded",
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
      metadata: { organizations: results.length, failedCount },
    };
  });
  return NextResponse.json({ syncedAt: new Date().toISOString(), ...data });
}
