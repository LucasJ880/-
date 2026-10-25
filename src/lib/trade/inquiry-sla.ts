/**
 * 询盘响应时限（SLA）提醒
 *
 * 旧规则（未启用分级的组织，行为不变）：进线后 5 分钟未回复 → 提醒外贸成员；24 小时未回复 → 升级通知企业管理员/老板。
 * 每条「最后一次进线」只提醒一次（幂等键含 lastInboundAt），买家再次来信会重新计时。
 * Cron 每 5 分钟扫一次，因此 5 分钟档实际在 5–10 分钟内触发。
 *
 * 分级提醒（revenue-spine/sla-tiers，组织策略 salesSla 配了任一档即启用）：先跑分级；被分级跟踪的 Revenue Spine 询盘，
 * 旧提醒跳过它关联的外贸线索（同一条询盘只有一个提醒来源），其余线程旧提醒照常。
 */

import { db } from "@/lib/db";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import type { PushFn } from "@/lib/revenue-spine/owner-brief";
import { runRevenueSlaTiers, type RevenueSlaTierOutcome, type SlaTier } from "@/lib/revenue-spine/sla-tiers";
import { loadInquiryThreads, type InquiryThread } from "@/lib/trade/inbox-service";

export const SLA_FIRST_RESPONSE_MINUTES = 5;
export const SLA_ESCALATION_MINUTES = 24 * 60;

export type ReminderLevel = "first_response" | "escalation";

export interface InquiryReminder {
  prospectId: string;
  companyName: string;
  channel: string;
  waitingMinutes: number;
  level: ReminderLevel;
  /** 幂等键：同一次进线同一档只发一次 */
  sourceKey: string;
}

/** 纯函数：从待回复线程算出该发的提醒 */
export function decideInquiryReminders(
  threads: Pick<InquiryThread, "prospectId" | "companyName" | "channel" | "replied" | "waitingMinutes" | "lastInboundAt">[],
): InquiryReminder[] {
  const out: InquiryReminder[] = [];
  for (const t of threads) {
    if (t.replied || t.waitingMinutes === null) continue;
    const stamp = new Date(t.lastInboundAt).getTime();
    if (t.waitingMinutes >= SLA_ESCALATION_MINUTES) {
      out.push({
        prospectId: t.prospectId,
        companyName: t.companyName,
        channel: t.channel,
        waitingMinutes: t.waitingMinutes,
        level: "escalation",
        sourceKey: `inquiry-sla:24h:${t.prospectId}:${stamp}`,
      });
    }
    if (t.waitingMinutes >= SLA_FIRST_RESPONSE_MINUTES) {
      out.push({
        prospectId: t.prospectId,
        companyName: t.companyName,
        channel: t.channel,
        waitingMinutes: t.waitingMinutes,
        level: "first_response",
        sourceKey: `inquiry-sla:5m:${t.prospectId}:${stamp}`,
      });
    }
  }
  return out;
}

export function formatWaiting(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.round(minutes / 1440)} 天`;
}

export interface InquirySlaOutcome {
  orgsScanned: number;
  pendingThreads: number;
  remindersSent: number;
  escalationsSent: number;
  /** 分级提醒（只统计启用分级的组织） */
  tiers: {
    orgsEnabled: number;
    tracked: number;
    fired: Record<SlaTier, number>;
    notifications: number;
    wechatDelivered: number;
    failedOrgs: number;
    /** 旧提醒因已被分级跟踪而跳过的线程数 */
    legacyThreadsSkipped: number;
  };
}

/**
 * 纯函数：启用分级的组织里，旧线程提醒要跳过的线索 = 链接到被分级跟踪商机的线索。
 * trackedOpportunityIds 为 undefined（组织未启用分级 / 分级失败）时不跳过任何线程。
 */
export function threadsOwnedByTiers(
  prospects: Array<{ id: string; convertedToSalesOpportunityId: string | null }>,
  trackedOpportunityIds: ReadonlySet<string> | undefined,
): Set<string> {
  const owned = new Set<string>();
  if (!trackedOpportunityIds?.size) return owned;
  for (const p of prospects) {
    if (p.convertedToSalesOpportunityId && trackedOpportunityIds.has(p.convertedToSalesOpportunityId)) owned.add(p.id);
  }
  return owned;
}

export async function runInquirySla(opts?: { now?: Date; push?: PushFn }): Promise<InquirySlaOutcome> {
  // ── 分级提醒（Revenue Spine 新询盘；只对启用分级的组织生效）──
  // 分级整体失败时不影响旧提醒：trackedByOrg 为空 → 旧提醒对所有线程照常兜底
  const tierOutcome: RevenueSlaTierOutcome = await runRevenueSlaTiers({ now: opts?.now, push: opts?.push }).catch((err) => {
    console.error("[inquiry-sla] SLA 分级提醒失败，本轮由旧提醒兜底：", err instanceof Error ? err.message : err);
    return {
      orgsScanned: 0,
      orgsEnabled: 0,
      tracked: 0,
      fired: { unclaimed: 0, escalation: 0, overdue_draft: 0 },
      notifications: 0,
      wechatDelivered: 0,
      failedOrgs: 1,
      trackedByOrg: new Map<string, Set<string>>(),
    };
  });

  const since = new Date();
  since.setDate(since.getDate() - 7);
  // 近 7 天有进线的组织
  const recent = await db.tradeMessage.findMany({
    where: { direction: "inbound", createdAt: { gte: since } },
    select: { prospectId: true, prospect: { select: { orgId: true } } },
    distinct: ["prospectId"],
    take: 5000,
  });
  const orgIds = [...new Set(recent.map((r) => r.prospect.orgId))];

  const outcome: InquirySlaOutcome = {
    orgsScanned: orgIds.length,
    pendingThreads: 0,
    remindersSent: 0,
    escalationsSent: 0,
    tiers: {
      orgsEnabled: tierOutcome.orgsEnabled,
      tracked: tierOutcome.tracked,
      fired: tierOutcome.fired,
      notifications: tierOutcome.notifications,
      wechatDelivered: tierOutcome.wechatDelivered,
      failedOrgs: tierOutcome.failedOrgs,
      legacyThreadsSkipped: 0,
    },
  };

  for (const orgId of orgIds) {
    const threads = await loadInquiryThreads(orgId, { sinceDays: 7 });
    let pending = threads.filter((t) => !t.replied);
    outcome.pendingThreads += pending.length;
    // 启用分级的组织：被分级跟踪的询盘由分级提醒，旧线程提醒跳过（未启用的组织不多查一次库）
    const tracked = tierOutcome.trackedByOrg.get(orgId);
    if (tracked?.size && pending.length) {
      const linked = await db.tradeProspect.findMany({
        where: { orgId, id: { in: pending.map((t) => t.prospectId) }, convertedToSalesOpportunityId: { not: null } },
        select: { id: true, convertedToSalesOpportunityId: true },
      });
      const owned = threadsOwnedByTiers(linked, tracked);
      if (owned.size) {
        outcome.tiers.legacyThreadsSkipped += pending.filter((t) => owned.has(t.prospectId)).length;
        pending = pending.filter((t) => !owned.has(t.prospectId));
      }
    }
    const reminders = decideInquiryReminders(pending);
    if (reminders.length === 0) continue;

    const members = await db.organizationMember.findMany({
      where: { orgId, status: "active" },
      select: { userId: true, role: true, user: { select: { role: true } } },
    });
    const tradeUsers = members
      .filter((m) => ["trade", "boss", "manager", "admin", "super_admin"].includes(m.user.role))
      .map((m) => m.userId);
    const leaders = members
      .filter((m) => ["org_owner", "org_admin"].includes(m.role) || ["boss", "manager", "admin", "super_admin"].includes(m.user.role))
      .map((m) => m.userId);

    for (const r of reminders) {
      const targets = r.level === "escalation" ? leaders : tradeUsers;
      if (targets.length === 0) continue;
      const sent = await createNotificationsForUsers(targets, {
        type: "followup",
        title:
          r.level === "escalation"
            ? `询盘超 24 小时未回复：${r.companyName}`
            : `询盘待回复 ${formatWaiting(r.waitingMinutes)}：${r.companyName}`,
        summary:
          r.level === "escalation"
            ? "已超过一天没人回复这条买家来信，请安排人跟进。"
            : "买家刚发来询盘，5 分钟内回复成交率最高。",
        orgId,
        entityType: "trade_prospect",
        entityId: r.prospectId,
        priority: r.level === "escalation" ? "high" : "normal",
        metadata: { prospectId: r.prospectId, channel: r.channel, sla: r.level },
        sourceKeyPrefix: r.sourceKey,
      });
      if (r.level === "escalation") outcome.escalationsSent += sent;
      else outcome.remindersSent += sent;
    }
  }
  return outcome;
}
