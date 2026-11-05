/**
 * 协作通知 COLLAB-2：每日未读汇总邮件（design D15，spec notifications/email-reminders）
 *
 * 挂在既有 daily-brief 定时任务的末尾，沿用同一批"当地 7 点"的组织，不新增 cron：
 * 1. 收件人：这些组织里账号在职的 active 成员，跨组织去重（一个人以排在前面的组织为触发组织，本地日期按它的时区）；
 * 2. 内容：名下全部计入汇总的未读（不论通知属于哪个组织；两类简报不计入），按类型分组——
 *    固定六组在前，其他按类型名；组内从新到旧；最多列 50 条，超出加一行"另有 M 条"；
 * 3. 每人每天一封：同一事务里按 收件人 + 本地日期 加锁 → 查当天的审计记录 → 没有才写审计占位；提交后再发送，
 *    发送失败当天不补发。审计不带组织 id，进不了驾驶舱公司日志；
 * 4. 邮件偏好关、地址不可投递的不发；不受免打扰影响。单轮最多 300 封，到截止时刻就停；单封出错不影响其他封。
 * 数据库读写与发送从参数注入，便于测试。
 */

import { writeAuditLog } from "@/lib/audit/logger";
import type { AutomationOutcome } from "@/lib/automation/runner";
import { AUTOMATION_TIMEZONE } from "@/lib/automation/registry";
import { db } from "@/lib/db";
import { notificationTypeLabel } from "@/lib/notifications/constants";
import { effectiveEmailEnabled } from "@/lib/notifications/preferences";
import {
  EMAIL_FOOTER,
  buildMailItem,
  defaultMailDeps,
  deliverMail,
  isDeliverableAddress,
  itemLine,
  notificationsPageLink,
  parseMetadataObject,
  renderMail,
  resolveMailConfig,
  type MailConfig,
  type MailDeps,
  type MailItem,
  type RenderedMail,
} from "./email";
import { defaultEscalationDeps } from "./escalation";
import { formatLocalDate } from "./events";

export const DIGEST_MAX_EMAILS = 300;
export const DIGEST_MAX_LINES = 50;
/** 每人最多取这么多条未读来排版（只列前 50 条；主题里的总数另外计） */
export const DIGEST_FETCH_LIMIT = 1000;
/** 截止时刻：从 daily-brief 请求开始算（maxDuration = 300 秒，留 15 秒余量） */
export const DIGEST_DEADLINE_MS = 285_000;
export const DIGEST_AUDIT_ACTION = "notifications.email_digest";
export const DIGEST_EXCLUDED_TYPES = ["daily_briefing", "sales_daily_briefing"] as const;
/** 排在前面的六组（按这个顺序）；其他类型按类型名排在后面 */
export const DIGEST_GROUP_ORDER = ["mention", "task_assigned", "task_due", "task_comment", "task_status", "order_stage"] as const;

export type DigestSkipReason = "email_off" | "undeliverable";

export function countsTowardDigest(type: string): boolean {
  return !(DIGEST_EXCLUDED_TYPES as readonly string[]).includes(type);
}

export function digestLockKey(userId: string, day: string): string {
  return `notify-email-digest:${userId}:${day}`;
}

/** afterData 是 JSON 字符串，day 是第一个键 */
export function digestExistingWhere(userId: string, day: string) {
  return {
    action: DIGEST_AUDIT_ACTION,
    targetType: "user",
    targetId: userId,
    afterData: { contains: `"day":"${day}"` },
  };
}

// ── 分组与排版（纯函数） ──────────────────────────────────────

export interface DigestItem extends MailItem {
  type: string;
  createdAt: Date;
}

export interface DigestGroup {
  label: string;
  items: DigestItem[];
}

const FIXED_LABELS: readonly string[] = DIGEST_GROUP_ORDER.map((type) => notificationTypeLabel(type));

function compareLabels(a: string, b: string): number {
  const ia = FIXED_LABELS.indexOf(a);
  const ib = FIXED_LABELS.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b, "zh-Hans-CN");
}

/** 汇总的排列顺序：组的顺序，组内从新到旧 */
export function orderForDigest<T extends { typeLabel: string; createdAt: Date }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => compareLabels(a.typeLabel, b.typeLabel) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

/** 按类型名分组（没有登记名称的类型都归「其他通知」） */
export function digestGroups(items: readonly DigestItem[]): DigestGroup[] {
  const groups: DigestGroup[] = [];
  for (const item of orderForDigest(items)) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.typeLabel) last.items.push(item);
    else groups.push({ label: item.typeLabel, items: [item] });
  }
  return groups;
}

/** 主题 `【青砚】今日未读 {N} 条`；每组以【类型名】开头，每条一行；最多 50 条，超出加一行"另有 M 条" */
export function digestMail(input: { total: number; items: readonly DigestItem[]; origin: string }): RenderedMail & { listed: number } {
  const paragraphs: string[] = [];
  let listed = 0;
  for (const group of digestGroups(input.items)) {
    const room = DIGEST_MAX_LINES - listed;
    if (room <= 0) break;
    const lines = group.items.slice(0, room).map(itemLine);
    listed += lines.length;
    paragraphs.push([`【${group.label}】`, ...lines].join("\n"));
  }
  const total = Math.max(input.total, listed);
  if (total > listed) paragraphs.push(`另有 ${total - listed} 条未读，请在青砚查看：${notificationsPageLink(input.origin)}`);
  paragraphs.push(EMAIL_FOOTER);
  return { ...renderMail(`【青砚】今日未读 ${total} 条`, paragraphs), listed };
}

// ── 执行 ──────────────────────────────────────────────────────

export interface DigestOrg {
  id: string;
  timezone: string;
}

export interface DigestMember {
  orgId: string;
  userId: string;
  email: string;
  memberStatus: string;
  userStatus: string;
}

export interface DigestNotificationRow {
  id: string;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  type: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  activityId: string | null;
  metadata: string | null;
  createdAt: Date;
}

/** 写进 AuditLog.afterData 的内容（day 必须是第一个键） */
export interface DigestAudit {
  day: string;
  timezone: string;
  count: number;
  listed: number;
  dryRun: boolean;
}

export interface DigestDeps extends MailDeps {
  now(): Date;
  loadMembers(orgIds: string[]): Promise<DigestMember[]>;
  loadPreferences(userIds: string[]): Promise<Array<{ userId: string; emailEnabled: boolean; metadata: string | null }>>;
  /** 每人计入汇总的未读数（只算未读，排除 excludedTypes） */
  countUnread(userIds: string[], excludedTypes: readonly string[]): Promise<Map<string, number>>;
  /** 一个人计入汇总的未读，从新到旧，最多 take 条 */
  listUnread(userId: string, excludedTypes: readonly string[], take: number): Promise<DigestNotificationRow[]>;
  loadOrgTimezones(orgIds: string[]): Promise<Map<string, string>>;
  loadTaskDueDates(taskIds: string[]): Promise<Map<string, Date | null>>;
  /** 按收件人与本地日期串行化：当天已有审计记录 → false；否则写审计占位 → true */
  claimDigest(input: { userId: string; day: string; audit: DigestAudit }): Promise<boolean>;
  logError(message: string, err: unknown): void;
}

export interface DigestResult {
  realSend: boolean;
  missingEnv: string[];
  orgs: number;
  recipients: number;
  noUnread: number;
  sent: number;
  dryRun: number;
  failed: number;
  /** 当天已经发过（审计记录已有） */
  alreadySent: number;
  skippedByReason: Record<DigestSkipReason, number>;
  capped: boolean;
  deadlineHit: boolean;
}

interface DigestRecipient {
  userId: string;
  email: string;
  timezone: string;
}

const unique = <T>(values: Iterable<T>) => [...new Set(values)];

/** 到点组织里在职的 active 成员，按组织顺序去重 */
function digestRecipients(orgs: ReadonlyArray<DigestOrg>, members: readonly DigestMember[]): DigestRecipient[] {
  const timezoneByOrg = new Map(orgs.map((o) => [o.id, o.timezone]));
  const rank = new Map(orgs.map((o, i) => [o.id, i]));
  const seen = new Set<string>();
  const out: DigestRecipient[] = [];
  const ordered = [...members].sort((a, b) => (rank.get(a.orgId) ?? orgs.length) - (rank.get(b.orgId) ?? orgs.length));
  for (const m of ordered) {
    const timezone = timezoneByOrg.get(m.orgId);
    if (!timezone || m.memberStatus !== "active" || m.userStatus !== "active" || seen.has(m.userId)) continue;
    seen.add(m.userId);
    out.push({ userId: m.userId, email: m.email, timezone });
  }
  return out;
}

export async function runEmailDigest(
  opts: { orgs: ReadonlyArray<DigestOrg>; deadline: Date; config?: MailConfig },
  deps: DigestDeps = defaultDigestDeps,
): Promise<DigestResult> {
  const config = opts.config ?? resolveMailConfig();
  const result: DigestResult = {
    realSend: config.realSend,
    missingEnv: [...config.missingEnv],
    orgs: opts.orgs.length,
    recipients: 0,
    noUnread: 0,
    sent: 0,
    dryRun: 0,
    failed: 0,
    alreadySent: 0,
    skippedByReason: { email_off: 0, undeliverable: 0 },
    capped: false,
    deadlineHit: false,
  };
  // 真发环境缺发信配置：不查、不写审计、不发
  if (config.missingEnv.length > 0 || opts.orgs.length === 0) return result;

  const now = deps.now();
  const recipients = digestRecipients(opts.orgs, await deps.loadMembers(opts.orgs.map((o) => o.id)));
  result.recipients = recipients.length;
  if (recipients.length === 0) return result;

  const userIds = recipients.map((r) => r.userId);
  const [counts, preferences] = await Promise.all([
    deps.countUnread(userIds, DIGEST_EXCLUDED_TYPES),
    deps.loadPreferences(userIds),
  ]);
  const preferenceByUser = new Map(preferences.map((p) => [p.userId, p]));
  const timezones = new Map(opts.orgs.map((o) => [o.id, o.timezone]));

  for (const recipient of recipients) {
    const count = counts.get(recipient.userId) ?? 0;
    if (count <= 0) {
      result.noUnread += 1;
      continue;
    }
    if (result.sent + result.dryRun + result.failed >= DIGEST_MAX_EMAILS) {
      result.capped = true;
      break;
    }
    if (deps.now().getTime() >= opts.deadline.getTime()) {
      result.deadlineHit = true;
      break;
    }
    try {
      const preference = preferenceByUser.get(recipient.userId);
      // 没有偏好行：邮件默认开
      if (preference && !effectiveEmailEnabled(preference)) {
        result.skippedByReason.email_off += 1;
        continue;
      }
      if (!isDeliverableAddress(recipient.email)) {
        result.skippedByReason.undeliverable += 1;
        continue;
      }

      const rows = (await deps.listUnread(recipient.userId, DIGEST_EXCLUDED_TYPES, DIGEST_FETCH_LIMIT)).filter((row) =>
        countsTowardDigest(row.type),
      );
      if (rows.length === 0) {
        result.noUnread += 1;
        continue;
      }
      const listed = orderForDigest(rows.map((row) => ({ row, typeLabel: notificationTypeLabel(row.type), createdAt: row.createdAt })))
        .slice(0, DIGEST_MAX_LINES)
        .map((x) => ({ ...x.row, metadata: parseMetadataObject(x.row.metadata) ?? {} }));

      const unknownOrgs = unique(listed.flatMap((n) => (n.orgId && !timezones.has(n.orgId) ? [n.orgId] : [])));
      if (unknownOrgs.length > 0) for (const [id, tz] of await deps.loadOrgTimezones(unknownOrgs)) timezones.set(id, tz);
      const taskIds = unique(listed.flatMap((n) => (n.entityType === "task" && n.entityId ? [n.entityId] : [])));
      const taskDueDates = taskIds.length > 0 ? await deps.loadTaskDueDates(taskIds) : new Map<string, Date | null>();

      const items: DigestItem[] = listed.map((n) => ({
        ...buildMailItem(n, {
          origin: config.origin,
          timeZone: (n.orgId && timezones.get(n.orgId)) || AUTOMATION_TIMEZONE,
          taskDueDates,
        }),
        type: n.type,
        createdAt: n.createdAt,
      }));
      const mail = digestMail({ total: Math.max(count, rows.length), items, origin: config.origin });

      const day = formatLocalDate(now, recipient.timezone);
      const audit: DigestAudit = {
        day,
        timezone: recipient.timezone,
        count: Math.max(count, rows.length),
        listed: mail.listed,
        dryRun: !config.realSend,
      };
      if (!(await deps.claimDigest({ userId: recipient.userId, day, audit }))) {
        result.alreadySent += 1;
        continue;
      }

      // 审计占位已提交：此后发送失败当天也不补发
      const outcome = await deliverMail({ subject: mail.subject, text: mail.text, html: mail.html, userId: recipient.userId, to: recipient.email }, config.realSend, deps);
      if (outcome.status === "sent") result.sent += 1;
      else if (outcome.status === "dry_run") result.dryRun += 1;
      else {
        result.failed += 1;
        deps.logError(`[collab-email] 每日汇总发送失败 ${recipient.userId}：${outcome.error}`, null);
      }
    } catch (err) {
      result.failed += 1;
      deps.logError(`[collab-email] 处理每日汇总失败 ${recipient.userId}`, err);
    }
  }
  return result;
}

/** 运行记录：处理数 = 发出（含只记日志）+ 失败 + 跳过 + 当天已发；没有发出也没有失败时记为跳过 */
export function digestOutcome(result: DigestResult): AutomationOutcome<DigestResult> {
  const attempted = result.sent + result.dryRun + result.failed;
  const skipped = result.skippedByReason.email_off + result.skippedByReason.undeliverable;
  const missing = result.missingEnv.length > 0;
  return {
    data: result,
    status: missing || attempted === 0 ? "skipped" : result.failed > 0 ? "partial" : "succeeded",
    processedCount: attempted + skipped + result.alreadySent,
    succeededCount: result.sent + result.dryRun,
    failedCount: result.failed,
    metadata: {
      ...(missing ? { reason: `缺少发信配置：${result.missingEnv.join("、")}`, missingEnv: result.missingEnv } : {}),
      realSend: result.realSend,
      orgs: result.orgs,
      recipients: result.recipients,
      noUnread: result.noUnread,
      sent: result.sent,
      dryRun: result.dryRun,
      failed: result.failed,
      alreadySent: result.alreadySent,
      skipped: { ...result.skippedByReason },
      capped: result.capped,
      deadlineHit: result.deadlineHit,
    },
  };
}

const DIGEST_NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  orgId: true,
  projectId: true,
  type: true,
  title: true,
  summary: true,
  entityType: true,
  entityId: true,
  activityId: true,
  metadata: true,
  createdAt: true,
} as const;

export const defaultDigestDeps: DigestDeps = {
  ...defaultMailDeps,
  now: () => new Date(),
  async loadMembers(orgIds) {
    const rows = await db.organizationMember.findMany({
      where: { orgId: { in: orgIds }, status: "active", user: { status: "active" } },
      select: { orgId: true, userId: true, status: true, user: { select: { email: true, status: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return rows.map((r) => ({ orgId: r.orgId, userId: r.userId, email: r.user.email, memberStatus: r.status, userStatus: r.user.status }));
  },
  loadPreferences: (userIds) => defaultEscalationDeps.loadPreferences(userIds),
  async countUnread(userIds, excludedTypes) {
    const rows = await db.notification.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, status: "unread", type: { notIn: [...excludedTypes] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.userId, r._count._all]));
  },
  listUnread: (userId, excludedTypes, take) =>
    db.notification.findMany({
      where: { userId, status: "unread", type: { notIn: [...excludedTypes] } },
      orderBy: { createdAt: "desc" },
      take,
      select: DIGEST_NOTIFICATION_SELECT,
    }),
  loadOrgTimezones: (orgIds) => defaultEscalationDeps.loadOrgTimezones(orgIds),
  loadTaskDueDates: (taskIds) => defaultEscalationDeps.loadTaskDueDates(taskIds),
  claimDigest: ({ userId, day, audit }) =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${digestLockKey(userId, day)}))) AS l`;
      const existing = await tx.auditLog.findFirst({ where: digestExistingWhere(userId, day), select: { id: true } });
      if (existing) return false;
      await writeAuditLog(tx, { userId, action: DIGEST_AUDIT_ACTION, targetType: "user", targetId: userId, afterData: audit });
      return true;
    }),
  logError(message, err) {
    console.error(message, err ?? "");
  },
};
