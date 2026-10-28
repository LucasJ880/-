/**
 * Muse Bridge — 跟进（TASKFLOW S3）：纯函数，零 DB / 零 LLM
 *
 * 跟进 = SalesAction（source=muse_followup，signalKey=activeKey=muse_followup:<requestId>）。
 * activeKey 唯一挡并发重复；结束后它被置空，所以重放按 signalKey 查。
 * 提醒扫描只算"给谁发哪条"，IO 在 reminder-scan.ts。
 */

import {
  canTransitionSalesAction,
  isSalesActionStatus,
  validateSalesActionResolution,
} from "@/lib/sales/action-loop";
import type { MuseFollowupUpdateStatus } from "./contract";
import { clip, eventSummary, oneLine, type Advisory } from "./advisory";
import type { EmitMuseEventInput } from "./events-pure";
import type { SalesScope } from "./sales-pure";

export const FOLLOWUP_SOURCE = "muse_followup" as const;
/** 不用 contact / record_followup：网页 PATCH 对那两类要求先设下次跟进时间，那是数字员工提醒的规则 */
export const FOLLOWUP_CATEGORY = "muse_followup" as const;
export const OPEN_FOLLOWUP_STATUSES = ["open", "in_progress"] as const;
export const DEFAULT_FOLLOWUP_HOURS = 72;
export const DUE_SOON_HOURS = 24;
/** 提醒扫描只看期限在这个窗口内的对象，避免翻出陈年旧账 */
export const REMINDER_LOOKBACK_DAYS = 30;
export const REMINDER_SCAN_LIMIT = 500;

const HOUR = 3_600_000;

export const followupSignalKey = (requestId: string) => `muse_followup:${requestId}`;

export const FOLLOWUP_PERMISSION_MESSAGE = "销售只能给自己负责的商机、给自己建跟进。";
export const FOLLOWUP_UNASSIGNED_MESSAGE = "这个商机没有可用的跟进负责人（未分配或已离开组织）。";
export const FOLLOWUP_ASSIGNEE_INVALID_MESSAGE = "指定的负责人不是本组织的有效成员。";
export const FOLLOWUP_DUE_PAST_MESSAGE = "跟进期限必须晚于现在。";
export const FOLLOWUP_INQUIRY_MESSAGE = "没找到这条询问，或它不属于这个商机。";
export const FOLLOWUP_NOT_FOUND_MESSAGE = "没找到这条跟进，或你不是它的负责人或创建人。";
export const FOLLOWUP_CLOSED_MESSAGE = "这条跟进已经结束，不能再更新。";

/** 负责人：管理角色可指定（缺省为商机负责人）；销售只能是自己负责的商机、自己 */
export function resolveFollowupAssignee(input: {
  scope: SalesScope;
  callerId: string;
  opportunityAssigneeId: string | null;
  requested?: string;
}):
  | { ok: true; assigneeId: string }
  | { ok: false; errorCode: "PERMISSION_DENIED" | "OPPORTUNITY_UNASSIGNED"; message: string } {
  if (input.scope.kind === "own") {
    if (input.opportunityAssigneeId !== input.callerId || (input.requested && input.requested !== input.callerId)) {
      return { ok: false, errorCode: "PERMISSION_DENIED", message: FOLLOWUP_PERMISSION_MESSAGE };
    }
    return { ok: true, assigneeId: input.callerId };
  }
  const assigneeId = input.requested ?? input.opportunityAssigneeId;
  return assigneeId
    ? { ok: true, assigneeId }
    : { ok: false, errorCode: "OPPORTUNITY_UNASSIGNED", message: FOLLOWUP_UNASSIGNED_MESSAGE };
}

export type FollowupUpdatePlan =
  | { ok: true; changed: boolean; status: MuseFollowupUpdateStatus; evidence: string | null; reason: string | null }
  | { ok: false; errorCode: "FOLLOWUP_CLOSED" | "VALIDATION_FAILED"; message: string };

/** 状态迁移沿用 SalesAction 规则：完成要证据，搁置要原因，结束后不能再动 */
export function planFollowupUpdate(input: {
  current: string;
  next: MuseFollowupUpdateStatus;
  evidence?: string;
  reason?: string;
}): FollowupUpdatePlan {
  if (!isSalesActionStatus(input.current) || !canTransitionSalesAction(input.current, input.next)) {
    return { ok: false, errorCode: "FOLLOWUP_CLOSED", message: FOLLOWUP_CLOSED_MESSAGE };
  }
  const evidence = input.evidence ? oneLine(input.evidence) || null : null;
  const reason = input.reason ? oneLine(input.reason) || null : null;
  const problem = validateSalesActionResolution({ status: input.next, resolutionNote: evidence, dismissedReason: reason });
  if (problem) return { ok: false, errorCode: "VALIDATION_FAILED", message: problem };
  return { ok: true, changed: input.current !== input.next, status: input.next, evidence, reason };
}

export function defaultFollowupDueAt(now: Date): Date {
  return new Date(now.getTime() + DEFAULT_FOLLOWUP_HOURS * HOUR);
}

const STATUS_LABELS: Record<string, string> = {
  open: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  dismissed: "已搁置",
  auto_resolved: "已自动收口",
};

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")}（UTC）`;

const statusStep = (opportunityId: string) => ({
  label: "看商机详情",
  command: { intent: "opportunity_status" as const, opportunityId },
});

export type FollowupEventFacts = {
  orgId: string;
  followupId: string;
  opportunityId: string;
  opportunityTitle: string;
  title: string;
  dueAt: Date;
};

export function followupAssignedEventInput(
  f: FollowupEventFacts & { assigneeUserId: string; creatorName: string },
): EmitMuseEventInput {
  return {
    eventId: `followup.assigned:${f.followupId}`,
    type: "followup.assigned",
    orgId: f.orgId,
    userId: f.assigneeUserId,
    opportunityId: f.opportunityId,
    followupId: f.followupId,
    summary: eventSummary(
      `${clip(oneLine(f.creatorName), 12)} 给你布置了「${clip(oneLine(f.opportunityTitle), 20)}」的跟进`,
      `${clip(oneLine(f.title), 40)}，${when(f.dueAt)} 前`,
    ),
    action: {
      label: "开始跟进",
      command: { intent: "update_followup", followupId: f.followupId, status: "in_progress" },
    },
  };
}

export function followupUpdatedEventInput(
  f: FollowupEventFacts & { creatorUserId: string; updaterName: string; status: string; note: string | null },
): EmitMuseEventInput {
  return {
    // 状态只前进（open → in_progress → 结束），所以按状态去重即"每次变化一条"
    eventId: `followup.updated:${f.followupId}:${f.status}`,
    type: "followup.updated",
    orgId: f.orgId,
    userId: f.creatorUserId,
    opportunityId: f.opportunityId,
    followupId: f.followupId,
    summary: eventSummary(
      `${clip(oneLine(f.updaterName), 12)} 把「${clip(oneLine(f.title), 20)}」标为${STATUS_LABELS[f.status] ?? f.status}`,
      f.note ? clip(oneLine(f.note), 80) : null,
    ),
    action: statusStep(f.opportunityId),
  };
}

// ── 提醒扫描 ────────────────────────────────────────────────────

export type ReminderFollowup = FollowupEventFacts & { assigneeId: string; creatorId: string };
export type ReminderInquiry = {
  orgId: string;
  inquiryId: string;
  opportunityId: string;
  opportunityTitle: string;
  dueAt: Date;
  assigneeId: string;
  creatorId: string;
};

/** 幂等键带期限与收件人：两个收件人各一条，改期限后再提醒一次 */
export const reminderEventId = (type: string, objectId: string, dueAt: Date, userId: string) =>
  `${type}:${objectId}:${dueAt.getTime()}:${userId}`;

const recipients = (...ids: string[]) => [...new Set(ids)];

export function planReminders(input: {
  followups: ReminderFollowup[];
  inquiries: ReminderInquiry[];
  now: Date;
}): EmitMuseEventInput[] {
  const now = input.now.getTime();
  const out: EmitMuseEventInput[] = [];

  for (const f of input.followups) {
    const due = f.dueAt.getTime();
    const base = { orgId: f.orgId, opportunityId: f.opportunityId, followupId: f.followupId, action: statusStep(f.opportunityId) };
    const what = `「${clip(oneLine(f.title), 30)}」（${clip(oneLine(f.opportunityTitle), 20)}）`;
    if (due <= now) {
      const days = Math.max(1, Math.ceil((now - due) / (24 * HOUR)));
      for (const userId of recipients(f.assigneeId, f.creatorId)) {
        out.push({
          ...base,
          eventId: reminderEventId("followup.overdue", f.followupId, f.dueAt, userId),
          type: "followup.overdue",
          userId,
          summary: eventSummary(`跟进${what}已逾期`, `期限 ${when(f.dueAt)}，已过约 ${days} 天`),
        });
      }
    } else if (due - now <= DUE_SOON_HOURS * HOUR) {
      out.push({
        ...base,
        eventId: reminderEventId("followup.due", f.followupId, f.dueAt, f.assigneeId),
        type: "followup.due",
        userId: f.assigneeId,
        summary: eventSummary(`跟进${what}即将到期`, `期限 ${when(f.dueAt)}`),
      });
    }
  }

  for (const q of input.inquiries) {
    if (q.dueAt.getTime() > now) continue;
    for (const userId of recipients(q.creatorId, q.assigneeId)) {
      out.push({
        eventId: reminderEventId("inquiry.overdue", q.inquiryId, q.dueAt, userId),
        type: "inquiry.overdue",
        orgId: q.orgId,
        userId,
        opportunityId: q.opportunityId,
        inquiryId: q.inquiryId,
        summary: eventSummary(
          `「${clip(oneLine(q.opportunityTitle), 20)}」的询问过了期望回复时间`,
          userId === q.assigneeId ? "仍可回复" : `期望 ${when(q.dueAt)} 前回复，尚未收到`,
        ),
        action: statusStep(q.opportunityId),
      });
    }
  }

  return out;
}

// ── 视图与回复文案 ──────────────────────────────────────────────

export type FollowupRecord = {
  id: string;
  title: string;
  status: string;
  dueAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  dismissedAt: Date | null;
  resolutionNote: string | null;
  dismissedReason: string | null;
  assignedTo: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  inputContext: unknown;
};

export function workflowIdOf(inputContext: unknown): string | null {
  const v = (inputContext as { workflowId?: unknown } | null)?.workflowId;
  return typeof v === "string" ? v : null;
}

const isOpen = (status: string) => (OPEN_FOLLOWUP_STATUSES as readonly string[]).includes(status);

/** 未结束的在前（按期限），结束的在后（按结束时间倒序） */
export function followupsView(records: FollowupRecord[], now: Date) {
  const endedAt = (r: FollowupRecord) => (r.completedAt ?? r.dismissedAt ?? r.createdAt).getTime();
  return [...records]
    .sort((a, b) => {
      if (isOpen(a.status) !== isOpen(b.status)) return isOpen(a.status) ? -1 : 1;
      if (isOpen(a.status)) return (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
      return endedAt(b) - endedAt(a);
    })
    .map((r) => ({
      followupId: r.id,
      title: r.title,
      status: r.status,
      assignee: r.assignedTo,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      overdue: isOpen(r.status) && !!r.dueAt && r.dueAt.getTime() < now.getTime(),
      evidence: r.status === "completed" ? r.resolutionNote : null,
      reason: r.status === "dismissed" ? r.dismissedReason : null,
      workflowId: workflowIdOf(r.inputContext),
    }));
}

export function createFollowupAdvisory(input: {
  title: string;
  assigneeName: string;
  dueAt: Date;
  opportunityId: string;
}): Advisory {
  return {
    conclusion: `已给 ${clip(oneLine(input.assigneeName), 10)} 布置跟进「${clip(oneLine(input.title), 16)}」`,
    reasons: [`期限 ${when(input.dueAt)}`, "到期前 24 小时提醒负责人；逾期会同时通知你"],
    nextStep: statusStep(input.opportunityId),
  };
}

export function updateFollowupAdvisory(input: { title: string; status: string; opportunityId: string }): Advisory {
  return {
    conclusion: `已把跟进「${clip(oneLine(input.title), 20)}」标为${STATUS_LABELS[input.status] ?? input.status}`,
    reasons: ["布置这条跟进的人会收到更新"],
    nextStep: statusStep(input.opportunityId),
  };
}
