/**
 * Muse Bridge — 跟进与询问提醒扫描（TASKFLOW S3）
 *
 * 挂在既有 sales-actions cron 上，不新建 cron / 队列。只算缺的提醒并发出；
 * 幂等键带期限与收件人（见 followup-pure.reminderEventId），重复运行不会重复发。
 */

import { db } from "@/lib/db";
import { emitMuseEvent } from "./events";
import {
  DUE_SOON_HOURS,
  FOLLOWUP_SOURCE,
  OPEN_FOLLOWUP_STATUSES,
  REMINDER_LOOKBACK_DAYS,
  REMINDER_SCAN_LIMIT,
  planReminders,
} from "./followup-pure";
import { isMuseBridgeEnabled, isMuseOrgAllowed } from "./flags";
import { CLOSED_TASK_STATUSES, INQUIRY_SOURCE_TYPE } from "./inquiry-pure";

export type ReminderScanResult = {
  skipped: boolean;
  followups: number;
  inquiries: number;
  planned: number;
  emitted: number;
  failed: number;
};

const HOUR = 3_600_000;

export async function scanMuseReminders(now: Date = new Date()): Promise<ReminderScanResult> {
  const empty = { followups: 0, inquiries: 0, planned: 0, emitted: 0, failed: 0 };
  if (!isMuseBridgeEnabled()) return { skipped: true, ...empty };

  const since = new Date(now.getTime() - REMINDER_LOOKBACK_DAYS * 24 * HOUR);
  const soon = new Date(now.getTime() + DUE_SOON_HOURS * HOUR);

  const followupSelect = {
    id: true,
    orgId: true,
    title: true,
    dueAt: true,
    assignedToId: true,
    createdById: true,
    opportunity: { select: { id: true, title: true } },
  } as const;
  const openFollowup = {
    source: FOLLOWUP_SOURCE,
    status: { in: [...OPEN_FOLLOWUP_STATUSES] },
    assignedToId: { not: null },
    opportunityId: { not: null },
  };
  // 分两段各取上限：已提醒过的逾期项每次都会被扫到，混在一起排序会把临近到期的挤出窗口。
  // 逾期段按期限倒序，刚逾期（含改过期限）的先处理。
  const [dueSoonRows, overdueRows, inquiryRows] = await Promise.all([
    db.salesAction.findMany({
      where: { ...openFollowup, dueAt: { gt: now, lte: soon } },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: REMINDER_SCAN_LIMIT,
      select: followupSelect,
    }),
    db.salesAction.findMany({
      where: { ...openFollowup, dueAt: { gte: since, lte: now } },
      orderBy: [{ dueAt: "desc" }, { id: "asc" }],
      take: REMINDER_SCAN_LIMIT,
      select: followupSelect,
    }),
    db.task.findMany({
      where: {
        sourceType: INQUIRY_SOURCE_TYPE,
        status: { notIn: [...CLOSED_TASK_STATUSES] },
        dueDate: { gte: since, lte: now },
        assigneeId: { not: null },
        sourceId: { not: null },
      },
      orderBy: [{ dueDate: "desc" }, { id: "asc" }],
      take: REMINDER_SCAN_LIMIT,
      select: { id: true, dueDate: true, assigneeId: true, creatorId: true, sourceId: true },
    }),
  ]);

  const opportunities = new Map(
    (
      await db.salesOpportunity.findMany({
        where: { id: { in: inquiryRows.map((t) => t.sourceId as string) } },
        select: { id: true, orgId: true, title: true },
      })
    ).map((o) => [o.id, o]),
  );

  const followups = [...dueSoonRows, ...overdueRows].flatMap((f) =>
    f.dueAt && f.assignedToId && f.opportunity && isMuseOrgAllowed(f.orgId)
      ? [
          {
            orgId: f.orgId,
            followupId: f.id,
            opportunityId: f.opportunity.id,
            opportunityTitle: f.opportunity.title,
            title: f.title,
            dueAt: f.dueAt,
            assigneeId: f.assignedToId,
            creatorId: f.createdById,
          },
        ]
      : [],
  );
  const inquiries = inquiryRows.flatMap((t) => {
    const opp = t.sourceId ? opportunities.get(t.sourceId) : undefined;
    return t.dueDate && t.assigneeId && opp && isMuseOrgAllowed(opp.orgId)
      ? [
          {
            orgId: opp.orgId,
            inquiryId: t.id,
            opportunityId: opp.id,
            opportunityTitle: opp.title,
            dueAt: t.dueDate,
            assigneeId: t.assigneeId,
            creatorId: t.creatorId,
          },
        ]
      : [];
  });

  const plan = planReminders({ followups, inquiries, now });
  const sent = new Set(
    (
      await db.notification.findMany({
        where: { sourceKey: { in: plan.map((e) => `muse:${e.eventId}`) } },
        select: { sourceKey: true },
      })
    ).map((n) => n.sourceKey),
  );

  let emitted = 0;
  let failed = 0;
  for (const event of plan) {
    if (sent.has(`muse:${event.eventId}`)) continue;
    const r = await emitMuseEvent(event);
    if (r.emitted) emitted += 1;
    else if (r.reason !== "duplicate") failed += 1;
  }

  return { skipped: false, followups: followups.length, inquiries: inquiries.length, planned: plan.length, emitted, failed };
}
