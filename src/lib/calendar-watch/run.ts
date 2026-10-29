/**
 * CAL-1 日历观察执行器：挂在既有 /api/cron/sales-actions（每 15 分钟）里作为第三个受跟踪步骤运行。
 *
 * 只读 Google（读取函数可注入，测试不打真 Google）；对青砚只追加审计账本与站内通知、回写游标。
 * 一个组织或日历出错不影响其它；中断后靠游标与账本幂等续上。
 */

import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import {
  GoogleSyncTokenExpiredError,
  GoogleTokenExpiredError,
  listCalendarChanges,
  type CalendarChangesPage,
} from "@/lib/google-calendar";
import { createNotification } from "@/lib/notifications/create";
import { deriveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { loadTradeMemberSignals } from "@/lib/trade/recipients";
import {
  attributeForChange,
  baselineFromIso,
  bucketOfRole,
  buildNotification,
  classifyKind,
  diffEvent,
  editedViaQingyan,
  emptyCursor,
  fillFromPrevious,
  googleErrorStatus,
  LEDGER_ACTION,
  LEDGER_TARGET_TYPE,
  notificationRecipients,
  notificationSourceKey,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_TYPE,
  PAGE_BUDGET,
  parseLedgerAfterData,
  readCalendarWatch,
  reconnectNotification,
  shouldNotify,
  shouldRecord,
  toLedgerAfterData,
  withCalendarWatch,
} from "./pure";
import type {
  AppointmentRef,
  AttributionContext,
  CalendarBucket,
  CalendarChange,
  CalendarCursor,
  CalendarWatchConfig,
  LedgerAfterData,
} from "./types";

export type ReadCalendarChanges = (
  userId: string,
  opts: { calendarId: string; syncToken?: string | null; pageToken?: string | null },
) => Promise<CalendarChangesPage>;

export interface CalendarWatchDeps {
  readChanges?: ReadCalendarChanges;
  now?: () => Date;
  /** 只处理这些组织（测试用）；缺省为全部开启的组织 */
  orgIds?: string[];
  /** 超过此时刻不再读新页（cron 共 300 秒，与前两个步骤共享） */
  deadline?: Date;
}

export interface CalendarRunResult {
  calendarId: string;
  phase: CalendarCursor["phase"];
  pages: number;
  observed: number;
  recorded: number;
  notified: number;
  error: string | null;
}

export interface OrgRunResult {
  orgId: string;
  calendars: CalendarRunResult[];
  error: string | null;
}

export interface CalendarWatchRunSummary {
  organizations: number;
  failedCount: number;
  recorded: number;
  notified: number;
  results: OrgRunResult[];
}

const DEFAULT_BUDGET_MS = 200_000;

interface OrgContext {
  orgId: string;
  timezone: string;
  config: CalendarWatchConfig;
  attribution: Omit<AttributionContext, "appointmentsByEventId">;
  names: Map<string, string>;
  positionHolderIds: string[];
  fallbackOwnerId: string | null;
  /** 读取账号仍是在职成员 */
  readerActive: boolean;
}

/** 一次准备组织级上下文：成员信号与分桶、成员邮箱映射、姓名、通知岗位持有人 */
async function prepareOrg(orgId: string, settingsJson: unknown, ownerId: string, now: Date): Promise<OrgContext> {
  const config = readCalendarWatch(settingsJson);
  const timezone = resolveOrgTimezone(settingsJson);
  const signals = await loadTradeMemberSignals(orgId);
  const activeMembers = signals.members.filter((m) => m.userStatus === "active");
  const memberIds = activeMembers.map((m) => m.userId);
  const memberSet = new Set(memberIds);

  const bucketByUserId = new Map<string, CalendarBucket>();
  for (const m of activeMembers) {
    bucketByUserId.set(
      m.userId,
      bucketOfRole(deriveEffectivePlatformRole({ platformRole: m.platformRole, positionMode: signals.positionMode, permissionKeys: m.permissionKeys })),
    );
  }

  const [users, providers, bindings] = await Promise.all([
    db.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, email: true, name: true } }),
    db.calendarProvider.findMany({
      where: { userId: { in: memberIds }, type: "google", enabled: true },
      select: { userId: true, accountEmail: true },
    }),
    db.principalRoleBinding.findMany({
      where: {
        orgId,
        principalType: "HUMAN",
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        roleProfile: { status: "active", key: { in: config.notifyPositions } },
      },
      select: { principalId: true },
    }),
  ]);

  const memberByEmail = new Map<string, string>();
  const names = new Map<string, string>();
  for (const u of users) {
    names.set(u.id, u.name || u.email);
    if (u.email) memberByEmail.set(u.email.trim().toLowerCase(), u.id);
  }
  for (const p of providers) {
    const e = p.accountEmail?.trim().toLowerCase();
    if (e && !memberByEmail.has(e)) memberByEmail.set(e, p.userId);
  }
  for (const [email, userId] of Object.entries(config.memberEmailAliases)) {
    if (memberSet.has(userId)) memberByEmail.set(email, userId);
  }

  return {
    orgId,
    timezone,
    config,
    attribution: {
      memberByEmail,
      bucketByUserId,
      websiteBookerEmails: new Set(config.websiteBookerEmails),
      websiteMarkers: config.websiteMarkers.map((m) => m.toLowerCase()),
    },
    names,
    positionHolderIds: [...new Set(bindings.map((b) => b.principalId))].filter((id) => memberSet.has(id)),
    fallbackOwnerId: memberSet.has(ownerId) ? ownerId : null,
    readerActive: Boolean(config.readerUserId && memberSet.has(config.readerUserId)),
  };
}

/** 本页事件的最近一条账本（按 targetId） */
async function loadPrevLedger(orgId: string, calendarId: string, eventIds: string[]): Promise<Map<string, LedgerAfterData>> {
  const out = new Map<string, LedgerAfterData>();
  if (!eventIds.length) return out;
  const rows = await db.auditLog.findMany({
    where: {
      orgId,
      action: LEDGER_ACTION,
      targetType: LEDGER_TARGET_TYPE,
      targetId: { in: eventIds.map((id) => `${calendarId}/${id}`) },
    },
    orderBy: { createdAt: "desc" },
    select: { afterData: true },
  });
  for (const r of rows) {
    const a = parseLedgerAfterData(r.afterData);
    if (!a || out.has(a.eventId)) continue;
    out.set(a.eventId, a);
  }
  return out;
}

/** 本页事件对应的本企业预约 */
async function loadAppointments(orgId: string, eventIds: string[]): Promise<Map<string, AppointmentRef>> {
  const out = new Map<string, AppointmentRef>();
  if (!eventIds.length) return out;
  const rows = await db.appointment.findMany({
    where: { googleEventId: { in: eventIds }, customer: { orgId } },
    select: { id: true, googleEventId: true, createdById: true, assignedToId: true, googleSyncedAt: true },
  });
  for (const r of rows) {
    if (!r.googleEventId) continue;
    out.set(r.googleEventId, { appointmentId: r.id, createdById: r.createdById, assignedToId: r.assignedToId, googleSyncedAt: r.googleSyncedAt });
  }
  return out;
}

/** 处理一页变更：先发通知（sourceKey 幂等）再写账本，中断重跑不重复也不漏 */
async function processPage(
  org: OrgContext,
  calendarId: string,
  phase: CalendarCursor["phase"],
  baselineFromMs: number,
  changes: CalendarChange[],
  now: Date,
): Promise<{ recorded: number; notified: number }> {
  const ids = [...new Set(changes.map((c) => c.id))];
  // 重复系列的单次例外：缺的字段与归因沿用系列的账本
  const seriesIds = [...new Set(changes.map((c) => c.recurringEventId).filter((id): id is string => Boolean(id)))];
  const [prevMap, seriesMap, appointments] = await Promise.all([
    loadPrevLedger(org.orgId, calendarId, ids),
    loadPrevLedger(org.orgId, calendarId, seriesIds),
    loadAppointments(org.orgId, ids),
  ]);
  const ctx: AttributionContext = { ...org.attribution, appointmentsByEventId: appointments };
  const readerUserId = org.config.readerUserId!;
  let recorded = 0;
  let notified = 0;

  for (const raw of changes) {
    const prev = prevMap.get(raw.id) ?? null;
    if (!shouldRecord(prev, raw)) continue;
    const series = raw.recurringEventId ? seriesMap.get(raw.recurringEventId) ?? null : null;
    // 系列账本的起止是第一次发生的时间，不能当成这一次的时间
    const basis = prev ?? (series ? { ...series, start: null, end: null } : null);
    const change = fillFromPrevious(raw, basis);
    const kind = classifyKind({ change, prev, baselineFromMs, phase });
    if (!kind) continue;
    const appointment = appointments.get(change.id) ?? null;
    const attribution = attributeForChange({ change, kind, prev: basis, ctx });
    const editedVia = editedViaQingyan({ kind, attribution, appointment, updated: change.updated, prev: basis }) ? "qingyan" : null;
    const entry = toLedgerAfterData({
      calendarId,
      change,
      kind,
      baseline: phase === "full",
      attribution,
      editedVia,
      diff: kind === "updated" ? diffEvent(prev, change) : null,
      observedAt: now,
      firstObserved: kind !== "created" && !prev,
    });

    if (shouldNotify(entry)) {
      const draft = buildNotification(entry, org.timezone, attribution.userId ? org.names.get(attribution.userId) ?? null : null);
      const recipients = notificationRecipients({
        positionHolderIds: org.positionHolderIds,
        fallbackOwnerId: org.fallbackOwnerId,
        appointmentAssigneeId: appointment?.assignedToId ?? null,
        entry,
      });
      for (const userId of recipients) {
        const sourceKey = notificationSourceKey(org.orgId, entry, userId, raw.updated ?? "cancelled");
        // 已存在（同一事件在另一个观察日历、或重放）：不重发、不计数
        if (await db.notification.findUnique({ where: { sourceKey }, select: { id: true } })) continue;
        await createNotification({
          userId,
          orgId: org.orgId,
          type: NOTIFICATION_TYPE,
          category: NOTIFICATION_CATEGORY,
          title: draft.title,
          summary: draft.summary,
          entityType: LEDGER_TARGET_TYPE,
          entityId: `${calendarId}/${change.id}`,
          sourceKey,
          metadata: { kind, calendarId, eventId: change.id, attribution, htmlLink: entry.htmlLink },
        });
        notified += 1;
      }
    }

    await writeAuditLog(db, {
      userId: readerUserId,
      orgId: org.orgId,
      action: LEDGER_ACTION,
      targetType: LEDGER_TARGET_TYPE,
      targetId: `${calendarId}/${change.id}`,
      afterData: entry,
    });
    prevMap.set(change.id, entry);
    recorded += 1;
  }
  return { recorded, notified };
}

/** 回写单个日历的游标：重新读最新配置，只在该日历仍在观察、读取账号未变时写 */
async function saveCursor(orgId: string, readerUserId: string, calendarId: string, cursor: CalendarCursor): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  const current = readCalendarWatch(org?.settingsJson ?? null);
  if (current.readerUserId !== readerUserId || !current.calendarIds.includes(calendarId)) return;
  const next = withCalendarWatch(org?.settingsJson ?? null, { ...current, cursor: { ...current.cursor, [calendarId]: cursor } });
  await db.organization.update({ where: { id: orgId }, data: { settingsJson: next as object } });
}

function errorText(err: unknown): string {
  if (err instanceof GoogleTokenExpiredError) return "token_expired";
  const status = googleErrorStatus(err);
  if (status) return `api_error_${status}`;
  const msg = err instanceof Error ? err.message : String(err);
  return `error: ${msg.slice(0, 200)}`;
}

async function runCalendar(
  org: OrgContext,
  calendarId: string,
  readChanges: ReadCalendarChanges,
  now: Date,
  deadline: Date,
): Promise<CalendarRunResult> {
  const readerUserId = org.config.readerUserId!;
  let cursor: CalendarCursor = org.config.cursor[calendarId] ?? emptyCursor();
  if (cursor.phase === "full" && !cursor.baselineFrom) {
    cursor = { ...cursor, baselineFrom: baselineFromIso(now, org.timezone, org.config.baselineFromDays) };
  }
  const result: CalendarRunResult = { calendarId, phase: cursor.phase, pages: 0, observed: 0, recorded: 0, notified: 0, error: null };

  for (let page = 0; page < PAGE_BUDGET; page++) {
    if (Date.now() > deadline.getTime()) break;
    let res: CalendarChangesPage;
    try {
      res = await readChanges(readerUserId, {
        calendarId,
        syncToken: cursor.phase === "incremental" ? cursor.syncToken : null,
        pageToken: cursor.pageToken,
      });
    } catch (err) {
      if (err instanceof GoogleSyncTokenExpiredError) {
        // 410：清空游标，下一轮从头全量
        cursor = { ...emptyCursor(), lastRunAt: now.toISOString(), lastError: "sync_token_expired" };
      } else {
        cursor = { ...cursor, lastRunAt: now.toISOString(), lastError: errorText(err) };
        if (err instanceof GoogleTokenExpiredError) {
          const n = reconnectNotification(org.orgId, readerUserId, getLocalTimeParts(now, org.timezone).date);
          await createNotification({
            userId: readerUserId,
            orgId: org.orgId,
            type: NOTIFICATION_TYPE,
            category: NOTIFICATION_CATEGORY,
            title: n.title,
            summary: n.summary,
            priority: "high",
            sourceKey: n.sourceKey,
          });
        }
      }
      result.error = cursor.lastError;
      break;
    }

    result.pages += 1;
    result.observed += res.changes.length;
    const baselineFromMs = Date.parse(cursor.baselineFrom ?? "") || 0;
    const r = await processPage(org, calendarId, cursor.phase, baselineFromMs, res.changes, now);
    result.recorded += r.recorded;
    result.notified += r.notified;

    if (res.nextPageToken) {
      cursor = { ...cursor, pageToken: res.nextPageToken, lastRunAt: now.toISOString(), lastError: null };
      await saveCursor(org.orgId, readerUserId, calendarId, cursor);
      continue;
    }
    cursor = {
      ...cursor,
      phase: res.nextSyncToken ? "incremental" : cursor.phase,
      syncToken: res.nextSyncToken ?? cursor.syncToken,
      pageToken: null,
      lastRunAt: now.toISOString(),
      lastError: null,
    };
    break;
  }

  await saveCursor(org.orgId, readerUserId, calendarId, cursor);
  result.phase = cursor.phase;
  return result;
}

/** 遍历开启观察的组织与日历，跑一轮 */
export async function runCalendarWatch(deps: CalendarWatchDeps = {}): Promise<CalendarWatchRunSummary> {
  const readChanges = deps.readChanges ?? listCalendarChanges;
  const now = deps.now?.() ?? new Date();
  const deadline = deps.deadline ?? new Date(Date.now() + DEFAULT_BUDGET_MS);

  const orgs = await db.organization.findMany({
    where: {
      ...(deps.orgIds ? { id: { in: deps.orgIds } } : {}),
      settingsJson: { path: ["calendarWatch", "enabled"], equals: true },
    },
    select: { id: true, ownerId: true, settingsJson: true },
    orderBy: { createdAt: "asc" },
  });

  const results: OrgRunResult[] = [];
  for (const o of orgs) {
    const out: OrgRunResult = { orgId: o.id, calendars: [], error: null };
    try {
      const org = await prepareOrg(o.id, o.settingsJson, o.ownerId, now);
      if (!org.config.enabled || !org.config.readerUserId || !org.config.calendarIds.length) continue;
      if (!org.readerActive) {
        // 读取账号已离开企业：不再用其 Google 授权读取，等管理者换读取账号
        out.error = "reader_not_member";
        results.push(out);
        continue;
      }
      for (const calendarId of org.config.calendarIds) {
        try {
          out.calendars.push(await runCalendar(org, calendarId, readChanges, now, deadline));
        } catch (err) {
          out.calendars.push({ calendarId, phase: org.config.cursor[calendarId]?.phase ?? "full", pages: 0, observed: 0, recorded: 0, notified: 0, error: errorText(err) });
        }
      }
    } catch (err) {
      out.error = errorText(err);
    }
    results.push(out);
  }

  const failed = results.filter((r) => r.error || r.calendars.some((c) => c.error));
  return {
    organizations: results.length,
    failedCount: failed.length,
    recorded: results.reduce((s, r) => s + r.calendars.reduce((t, c) => t + c.recorded, 0), 0),
    notified: results.reduce((s, r) => s + r.calendars.reduce((t, c) => t + c.notified, 0), 0),
    results,
  };
}
