/**
 * 询盘响应时限（SLA）提醒
 *
 * 规则：进线后 5 分钟未回复 → 提醒外贸成员；24 小时未回复 → 升级通知企业管理员/老板。
 * 每条「最后一次进线」只提醒一次（幂等键含 lastInboundAt），买家再次来信会重新计时。
 * Cron 每 10 分钟扫一次，因此 5 分钟档实际在 5–15 分钟内触发。
 */

import { db } from "@/lib/db";
import { createNotificationsForUsers } from "@/lib/notifications/create";
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
}

export async function runInquirySla(): Promise<InquirySlaOutcome> {
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

  const outcome: InquirySlaOutcome = { orgsScanned: orgIds.length, pendingThreads: 0, remindersSent: 0, escalationsSent: 0 };

  for (const orgId of orgIds) {
    const threads = await loadInquiryThreads(orgId, { sinceDays: 7 });
    const pending = threads.filter((t) => !t.replied);
    outcome.pendingThreads += pending.length;
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
