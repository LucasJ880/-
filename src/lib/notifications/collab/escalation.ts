/**
 * 协作通知 COLLAB-2：未读升级邮件（design D14，spec notifications/email-reminders）
 *
 * 挂在既有 sales-actions 定时任务的最后一步（每 15 分钟），不新增 cron 或队列：
 * 1. 候选：mention / task_assigned、仍未读、创建于 [now − 24h, now − 15min]，按创建时间升序取前 500 条；
 *    再按 metadata 在内存里去掉已发、已跳过、尝试满 3 次、10 分钟内正在发送的；
 * 2. 跳过（记下原因，之后不再试）：账号停用、不是 active 成员、邮件偏好关、免打扰（不论优先级）、地址不可投递；
 * 3. 认领：对这一条通知做条件更新（metadata 仍是读到的原文、仍未读），写入 emailSendingAt 与 emailAttempts + 1，
 *    更新到 1 行才发送——两轮重叠时只有一轮能认领；
 * 4. 发送后以认领时写下的 metadata 为条件写入 emailedAt（只记日志时加 emailDryRun）或 emailError。
 * 所有记录都与原有 metadata 合并，不改通知状态。单轮最多 100 封，到截止时刻就停；单封出错不影响其他封。
 * 数据库读写与发送从参数注入，便于测试。
 */

import type { AutomationOutcome } from "@/lib/automation/runner";
import { AUTOMATION_TIMEZONE, resolveOrgTimezone } from "@/lib/automation/registry";
import { db } from "@/lib/db";
import { effectiveEmailEnabled } from "@/lib/notifications/preferences";
import { isInQuietHoursToronto } from "@/lib/time/quiet-hours";
import {
  buildMailItem,
  defaultMailDeps,
  deliverMail,
  escalationMail,
  isDeliverableAddress,
  parseMetadataObject,
  resolveMailConfig,
  type MailConfig,
  type MailDeps,
} from "./email";

export const ESCALATION_TYPES = ["mention", "task_assigned"] as const;
export const ESCALATION_MIN_AGE_MS = 15 * 60_000;
export const ESCALATION_WINDOW_MS = 24 * 60 * 60_000;
export const ESCALATION_CANDIDATE_LIMIT = 500;
export const ESCALATION_MAX_EMAILS = 100;
export const ESCALATION_MAX_ATTEMPTS = 3;
/** emailSendingAt 在这段时间内、还没有结果的通知视为正在发送 */
export const ESCALATION_IN_FLIGHT_MS = 10 * 60_000;
/** 截止时刻：从 sales-actions 请求开始算（maxDuration = 300 秒，留 15 秒余量） */
export const ESCALATION_DEADLINE_MS = 285_000;

export type EscalationSkipReason = "account_inactive" | "not_member" | "email_off" | "quiet_hours" | "undeliverable";
const SKIP_REASONS: readonly EscalationSkipReason[] = ["account_inactive", "not_member", "email_off", "quiet_hours", "undeliverable"];

export type EscalationEligibility =
  | "eligible"
  | "wrong_type"
  | "not_unread"
  | "too_new"
  | "too_old"
  | "unreadable_metadata"
  | "emailed"
  | "skipped_before"
  | "attempts_exhausted"
  | "in_flight";

export interface EscalationCandidateRow {
  id: string;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  type: string;
  status: string;
  priority: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  activityId: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface EscalationUser {
  id: string;
  email: string;
  status: string;
}

export interface EscalationPreference {
  emailEnabled: boolean;
  metadata: string | null;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

/** 收件人的 active 成员身份；orgActive = 该组织在用 */
export interface EscalationMembership {
  orgId: string;
  orgActive: boolean;
}

export interface EscalationDeps extends MailDeps {
  now(): Date;
  /**
   * 时间窗内这两类未读通知，按创建时间从新到旧取前 take 条：发过邮件、一直没读的旧通知留在窗口里，
   * 只会占掉更早的名额，挤不掉新到的；处理顺序由调用方再排成从旧到新
   */
  findCandidates(args: { types: readonly string[]; createdFrom: Date; createdTo: Date; take: number }): Promise<EscalationCandidateRow[]>;
  loadUsers(ids: string[]): Promise<EscalationUser[]>;
  loadPreferences(userIds: string[]): Promise<Array<EscalationPreference & { userId: string }>>;
  /** 只返回 active 的成员身份 */
  loadMemberships(userIds: string[]): Promise<Array<EscalationMembership & { userId: string }>>;
  loadOrgTimezones(orgIds: string[]): Promise<Map<string, string>>;
  loadTaskDueDates(taskIds: string[]): Promise<Map<string, Date | null>>;
  /** 条件更新 metadata：仍是 expected（requireUnread 时还须仍未读）才写入；返回是否更新到 1 行 */
  updateMetadata(id: string, expected: string | null, next: string, opts: { requireUnread: boolean }): Promise<boolean>;
  logError(message: string, err: unknown): void;
}

export interface EscalationResult {
  realSend: boolean;
  /** 真发环境缺少的配置；非空时整轮跳过 */
  missingEnv: string[];
  candidates: number;
  /** 候选取满上限：窗口里还有更早的未读通知这一轮没看到 */
  candidatesTruncated: boolean;
  eligible: number;
  sent: number;
  dryRun: number;
  failed: number;
  skippedByReason: Record<EscalationSkipReason, number>;
  /** 认领或记跳过的条件更新没命中（另一轮已处理、或已被读） */
  claimMissed: number;
  capped: boolean;
  deadlineHit: boolean;
}

const attemptsOf = (meta: Record<string, unknown>) =>
  typeof meta.emailAttempts === "number" && Number.isFinite(meta.emailAttempts) ? meta.emailAttempts : 0;

function timeOf(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 纯函数：这条通知这一轮该不该处理 */
export function escalationEligibility(
  n: { type: string; status: string; createdAt: Date; metadata: string | null },
  now: Date,
): EscalationEligibility {
  if (!(ESCALATION_TYPES as readonly string[]).includes(n.type)) return "wrong_type";
  if (n.status !== "unread") return "not_unread";
  const age = now.getTime() - n.createdAt.getTime();
  if (age < ESCALATION_MIN_AGE_MS) return "too_new";
  if (age > ESCALATION_WINDOW_MS) return "too_old";
  const meta = parseMetadataObject(n.metadata);
  if (!meta) return "unreadable_metadata";
  if (meta.emailedAt) return "emailed";
  if (meta.emailSkipped) return "skipped_before";
  if (attemptsOf(meta) >= ESCALATION_MAX_ATTEMPTS) return "attempts_exhausted";
  const sendingAt = timeOf(meta.emailSendingAt);
  if (sendingAt !== null && !meta.emailError && now.getTime() - sendingAt < ESCALATION_IN_FLIGHT_MS) return "in_flight";
  return "eligible";
}

/** 纯函数：跳过原因；null = 发 */
export function escalationSkipReason(input: {
  user: EscalationUser | undefined;
  memberships: ReadonlyArray<EscalationMembership>;
  orgId: string | null;
  preference: EscalationPreference | undefined;
  now: Date;
}): EscalationSkipReason | null {
  const { user, preference } = input;
  if (!user || user.status !== "active") return "account_inactive";
  const member = input.orgId
    ? input.memberships.some((m) => m.orgId === input.orgId)
    : input.memberships.some((m) => m.orgActive);
  if (!member) return "not_member";
  // 没有偏好行：邮件默认开、没有免打扰
  if (preference && !effectiveEmailEnabled(preference)) return "email_off";
  if (preference && isInQuietHoursToronto(preference.quietHoursStart, preference.quietHoursEnd, preference.quietHoursEnabled, input.now)) {
    return "quiet_hours";
  }
  if (!isDeliverableAddress(user.email)) return "undeliverable";
  return null;
}

function emptyResult(config: MailConfig): EscalationResult {
  return {
    realSend: config.realSend,
    missingEnv: [...config.missingEnv],
    candidates: 0,
    candidatesTruncated: false,
    eligible: 0,
    sent: 0,
    dryRun: 0,
    failed: 0,
    skippedByReason: Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<EscalationSkipReason, number>,
    claimMissed: 0,
    capped: false,
    deadlineHit: false,
  };
}

const unique = <T>(values: Iterable<T>) => [...new Set(values)];

export async function runEmailEscalation(
  opts: { deadline: Date; config?: MailConfig },
  deps: EscalationDeps = defaultEscalationDeps,
): Promise<EscalationResult> {
  const config = opts.config ?? resolveMailConfig();
  const result = emptyResult(config);
  // 真发环境缺发信配置：不查、不发、不动任何通知
  if (config.missingEnv.length > 0) return result;

  const now = deps.now();
  const rows = await deps.findCandidates({
    types: ESCALATION_TYPES,
    createdFrom: new Date(now.getTime() - ESCALATION_WINDOW_MS),
    createdTo: new Date(now.getTime() - ESCALATION_MIN_AGE_MS),
    take: ESCALATION_CANDIDATE_LIMIT,
  });
  result.candidates = rows.length;
  result.candidatesTruncated = rows.length >= ESCALATION_CANDIDATE_LIMIT;
  const eligible = rows
    .filter((row) => escalationEligibility(row, now) === "eligible")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  result.eligible = eligible.length;
  if (eligible.length === 0) return result;

  const userIds = unique(eligible.map((r) => r.userId));
  const orgIds = unique(eligible.flatMap((r) => (r.orgId ? [r.orgId] : [])));
  const taskIds = unique(eligible.flatMap((r) => (r.entityType === "task" && r.entityId ? [r.entityId] : [])));
  const [users, preferences, memberships, timezones, taskDueDates] = await Promise.all([
    deps.loadUsers(userIds),
    deps.loadPreferences(userIds),
    deps.loadMemberships(userIds),
    orgIds.length ? deps.loadOrgTimezones(orgIds) : Promise.resolve(new Map<string, string>()),
    taskIds.length ? deps.loadTaskDueDates(taskIds) : Promise.resolve(new Map<string, Date | null>()),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const preferenceByUser = new Map(preferences.map((p) => [p.userId, p]));
  const membershipsByUser = new Map<string, EscalationMembership[]>();
  for (const m of memberships) {
    const list = membershipsByUser.get(m.userId) ?? [];
    list.push({ orgId: m.orgId, orgActive: m.orgActive });
    membershipsByUser.set(m.userId, list);
  }

  for (const row of eligible) {
    if (result.sent + result.dryRun + result.failed >= ESCALATION_MAX_EMAILS) {
      result.capped = true;
      break;
    }
    if (deps.now().getTime() >= opts.deadline.getTime()) {
      result.deadlineHit = true;
      break;
    }
    try {
      const meta = parseMetadataObject(row.metadata) ?? {};
      const user = userById.get(row.userId);
      const reason = escalationSkipReason({
        user,
        memberships: membershipsByUser.get(row.userId) ?? [],
        orgId: row.orgId,
        preference: preferenceByUser.get(row.userId),
        now,
      });
      if (reason || !user) {
        const skipped = reason ?? "account_inactive";
        const written = await deps.updateMetadata(row.id, row.metadata, JSON.stringify({ ...meta, emailSkipped: skipped }), { requireUnread: true });
        if (written) result.skippedByReason[skipped] += 1;
        else result.claimMissed += 1;
        continue;
      }

      const item = buildMailItem(
        { ...row, metadata: meta },
        {
          origin: config.origin,
          timeZone: (row.orgId && timezones.get(row.orgId)) || AUTOMATION_TIMEZONE,
          taskDueDates,
        },
      );
      const mail = escalationMail(row, item);

      // 认领：上一次的错误随认领清掉，"正在发送"只看这一次
      const claimedMeta: Record<string, unknown> = { ...meta, emailSendingAt: deps.now().toISOString(), emailAttempts: attemptsOf(meta) + 1 };
      delete claimedMeta.emailError;
      const claimed = JSON.stringify(claimedMeta);
      if (!(await deps.updateMetadata(row.id, row.metadata, claimed, { requireUnread: true }))) {
        result.claimMissed += 1;
        continue;
      }

      const outcome = await deliverMail({ ...mail, userId: user.id, to: user.email }, config.realSend, deps);
      if (outcome.status === "sent") result.sent += 1;
      else if (outcome.status === "dry_run") result.dryRun += 1;
      else result.failed += 1;

      const finalMeta =
        outcome.status === "failed"
          ? { ...claimedMeta, emailError: outcome.error }
          : { ...claimedMeta, emailedAt: deps.now().toISOString(), ...(outcome.status === "dry_run" ? { emailDryRun: true } : {}) };
      try {
        // 只以认领时写下的 metadata 为条件：收件人恰在发送途中读了通知，结果也照样记下
        if (!(await deps.updateMetadata(row.id, claimed, JSON.stringify(finalMeta), { requireUnread: false }))) {
          deps.logError(`[collab-email] 升级邮件结果没能记到通知 ${row.id}（metadata 已被改动）`, null);
        }
      } catch (err) {
        deps.logError(`[collab-email] 记录升级邮件结果失败 ${row.id}`, err);
      }
    } catch (err) {
      result.failed += 1;
      deps.logError(`[collab-email] 处理升级邮件失败 ${row.id}`, err);
    }
  }
  return result;
}

/** 运行记录：处理数 = 发出（含只记日志）+ 失败 + 跳过；没有发出也没有失败时记为跳过 */
export function escalationOutcome(result: EscalationResult): AutomationOutcome<EscalationResult> {
  const attempted = result.sent + result.dryRun + result.failed;
  const skipped = Object.values(result.skippedByReason).reduce((sum, n) => sum + n, 0);
  const missing = result.missingEnv.length > 0;
  return {
    data: result,
    status: missing || attempted === 0 ? "skipped" : result.failed > 0 ? "partial" : "succeeded",
    processedCount: attempted + skipped,
    succeededCount: result.sent + result.dryRun,
    failedCount: result.failed,
    metadata: {
      ...(missing ? { reason: `缺少发信配置：${result.missingEnv.join("、")}`, missingEnv: result.missingEnv } : {}),
      realSend: result.realSend,
      candidates: result.candidates,
      candidatesTruncated: result.candidatesTruncated,
      eligible: result.eligible,
      sent: result.sent,
      dryRun: result.dryRun,
      failed: result.failed,
      skipped: { ...result.skippedByReason },
      claimMissed: result.claimMissed,
      capped: result.capped,
      deadlineHit: result.deadlineHit,
    },
  };
}

export const defaultEscalationDeps: EscalationDeps = {
  ...defaultMailDeps,
  now: () => new Date(),
  findCandidates: ({ types, createdFrom, createdTo, take }) =>
    db.notification.findMany({
      where: { type: { in: [...types] }, status: "unread", createdAt: { gte: createdFrom, lte: createdTo } },
      // 从新到旧取（见 EscalationDeps.findCandidates 的说明）
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        userId: true,
        orgId: true,
        projectId: true,
        type: true,
        status: true,
        priority: true,
        title: true,
        summary: true,
        entityType: true,
        entityId: true,
        activityId: true,
        metadata: true,
        createdAt: true,
      },
    }),
  loadUsers: (ids) => db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, status: true } }),
  loadPreferences: (userIds) =>
    db.userNotificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, emailEnabled: true, metadata: true, quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true },
    }),
  async loadMemberships(userIds) {
    const rows = await db.organizationMember.findMany({
      where: { userId: { in: userIds }, status: "active" },
      select: { userId: true, orgId: true, org: { select: { status: true } } },
    });
    return rows.map((r) => ({ userId: r.userId, orgId: r.orgId, orgActive: r.org.status === "active" }));
  },
  async loadOrgTimezones(orgIds) {
    const rows = await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, settingsJson: true } });
    return new Map(rows.map((r) => [r.id, resolveOrgTimezone(r.settingsJson)]));
  },
  async loadTaskDueDates(taskIds) {
    const rows = await db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, dueDate: true } });
    return new Map(rows.map((r) => [r.id, r.dueDate]));
  },
  async updateMetadata(id, expected, next, { requireUnread }) {
    const { count } = await db.notification.updateMany({
      where: { id, metadata: expected, ...(requireUnread ? { status: "unread" } : {}) },
      data: { metadata: next },
    });
    return count === 1;
  },
  logError(message, err) {
    console.error(message, err ?? "");
  },
};
