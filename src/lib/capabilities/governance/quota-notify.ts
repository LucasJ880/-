/**
 * Phase 3A-5：配额 Warning / Soft limit 站内通知（去重）
 * 去重键：orgId + workspaceId? + metric + periodStart + level
 */

import { db } from "@/lib/db";
import {
  createNotification,
  createNotificationsForUsers,
} from "@/lib/notifications/create";
import type { QuotaLevel, QuotaMetric } from "./types";

function startOfMonthUtc(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function startOfDayUtc(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function buildQuotaNotifyDedupeKey(opts: {
  orgId: string;
  workspaceId?: string | null;
  metric: QuotaMetric;
  level: Exclude<QuotaLevel, "OK">;
  at?: Date;
}): string {
  const at = opts.at ?? new Date();
  const periodStart =
    opts.metric === "MONTHLY_AI_COST"
      ? startOfMonthUtc(at)
      : startOfDayUtc(at);
  const ws = opts.workspaceId?.trim() || "_";
  return `quota:${opts.orgId}:${ws}:${opts.metric}:${periodStart}:${opts.level}`;
}

function metricLabel(metric: QuotaMetric): string {
  switch (metric) {
    case "MONTHLY_AI_COST":
      return "本月 AI 费用";
    case "DAILY_AGENT_RUNS":
      return "今日 Agent 运行";
    case "DAILY_HIGH_RISK_TOOL_CALLS":
      return "今日高风险工具";
    case "DAILY_IMAGE_GENERATIONS":
      return "今日图片生成";
    case "MAX_CONCURRENT_RUNS":
      return "并发运行";
    case "SINGLE_RUN_ESTIMATED_COST":
      return "单次运行预估费用";
    default:
      return metric;
  }
}

/**
 * Warning：提示当前用户（轻量）
 * Soft limit：提示当前用户 + org_admin（可进中台「需要处理」）
 * Hard limit：不在此通知（调用已被阻断；审计已写）
 */
export async function notifyQuotaThreshold(opts: {
  orgId: string;
  workspaceId?: string | null;
  userId: string;
  metric: QuotaMetric;
  level: "WARNING" | "SOFT_LIMIT";
  currentUsage: number;
  projectedUsage: number;
  softLimit?: number | null;
  warningLimit?: number | null;
  hardLimit?: number | null;
}): Promise<{ notified: number; deduped: boolean }> {
  const baseKey = buildQuotaNotifyDedupeKey(opts);
  const label = metricLabel(opts.metric);
  const isSoft = opts.level === "SOFT_LIMIT";
  const title = isSoft
    ? `${label}已达软限额`
    : `${label}接近限额`;
  const summary = isSoft
    ? `当前用量 ${opts.projectedUsage.toFixed(4)}，已超过软限额 ${opts.softLimit ?? "—"}。调用仍可继续，请关注治理中心。`
    : `当前用量 ${opts.projectedUsage.toFixed(4)}，已超过预警线 ${opts.warningLimit ?? "—"}。`;

  // 当前用户轻量提示
  const userKey = `${baseKey}:user:${opts.userId}`;
  const existingUser = await db.notification.findUnique({
    where: { sourceKey: userKey },
    select: { id: true },
  });
  let notified = 0;
  if (!existingUser) {
    await createNotification({
      userId: opts.userId,
      orgId: opts.orgId,
      type: isSoft ? "quota_soft_limit" : "quota_warning",
      category: "alert",
      title,
      summary,
      priority: isSoft ? "high" : "medium",
      entityType: "quota",
      entityId: opts.metric,
      sourceKey: userKey,
      metadata: {
        orgId: opts.orgId,
        workspaceId: opts.workspaceId ?? null,
        metric: opts.metric,
        level: opts.level,
        actionHref: "/capabilities/governance",
      },
    });
    notified += 1;
  }

  if (!isSoft) {
    return { notified, deduped: notified === 0 };
  }

  // Soft：通知企业管理员（去重）
  const admins = await db.organizationMember.findMany({
    where: {
      orgId: opts.orgId,
      status: "active",
      role: "org_admin",
    },
    select: { userId: true },
  });
  const adminIds = [
    ...new Set(
      admins.map((a) => a.userId).filter((id) => id && id !== opts.userId),
    ),
  ];
  if (adminIds.length === 0) {
    return { notified, deduped: notified === 0 };
  }

  const created = await createNotificationsForUsers(adminIds, {
    orgId: opts.orgId,
    type: "quota_soft_limit",
    category: "alert",
    title: `【需处理】${title}`,
    summary,
    priority: "high",
    entityType: "quota",
    entityId: opts.metric,
    sourceKeyPrefix: `${baseKey}:admin`,
    metadata: {
      orgId: opts.orgId,
      workspaceId: opts.workspaceId ?? null,
      metric: opts.metric,
      level: opts.level,
      actionHref: "/capabilities",
    },
  });
  notified += created;
  return { notified, deduped: notified === 0 };
}
