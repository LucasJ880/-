/**
 * 微信主动推送服务
 *
 * 将青砚的通知桥接到微信通道，按角色/业务域细分推送：
 *
 * | 推送类型       | 所属域   | admin | trade | sales | user |
 * |----------------|----------|-------|-------|-------|------|
 * | 每日简报(外贸) | trade    | ✓     | ✓     | ✗     | ✗    |
 * | 跟进提醒       | trade    | ✓     | ✓     | ✗     | ✗    |
 * | 周报(外贸)     | trade    | ✓     | ✓     | ✗     | ✗    |
 * | 销售提醒       | sales    | ✓     | ✗     | ✓     | ✗    |
 * | 项目通知       | project  | ✓     | ✗     | ✗     | ✓    |
 *
 * 推送前检查：
 * 1. pushDomains 是否包含该域（或为 "all"）
 * 2. 具体开关（pushBriefing / pushFollowup / pushReport / pushSales）
 * 3. 静默时段
 */

import { db } from "@/lib/db";
import { pushMessage } from "./gateway";
import type { PushDomain } from "./types";

// ── 每日简报推送（外贸域） ────────────────────────────────────

export async function pushDailyBriefing(
  userId: string,
  briefingSummary: string,
  urgentCount: number,
  warningCount: number,
  totalItems: number,
): Promise<{ sent: number; failed: number }> {
  const eligible = await getEligibleBindings(userId, "pushBriefing", "trade");
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  const header = urgentCount > 0
    ? `🔴 今日有 ${urgentCount} 项紧急事项`
    : warningCount > 0
      ? `🟡 今日有 ${warningCount} 项待关注`
      : `✅ 今日工作一览`;

  const message = formatPushMessage({
    title: `📋 ${header}`,
    body: briefingSummary,
    footer: `共 ${totalItems} 条待办 · 回复"详情"查看完整简报`,
    domain: "外贸",
  });

  return pushToBindings(userId, eligible, message);
}

// ── 跟进提醒推送（外贸域） ────────────────────────────────────

export async function pushFollowupReminder(
  userId: string,
  companyName: string,
  strategy: string,
  reason: string,
  daysSilent: number,
): Promise<{ sent: number; failed: number }> {
  const eligible = await getEligibleBindings(userId, "pushFollowup", "trade");
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  const urgencyLabel = daysSilent >= 10
    ? "🔴 紧急"
    : daysSilent >= 5
      ? "🟡 注意"
      : "🔵 提醒";

  const reasonLabels: Record<string, string> = {
    scheduled_due: "跟进日期到期",
    no_response_first: "首封邮件未回复",
    no_response_second: "二次跟进仍未回复",
    no_response_final: "最后机会跟进",
    reply_unhandled: "客户已回复，待处理",
    negotiation_stalled: "谈判阶段停滞",
  };

  const message = formatPushMessage({
    title: `${urgencyLabel} 跟进提醒`,
    body: [
      `📌 ${companyName}`,
      `原因：${reasonLabels[reason] ?? reason}`,
      `已 ${daysSilent} 天未联系`,
      `建议：${strategy}`,
    ].join("\n"),
    footer: '回复"跟进"查看 AI 草稿',
    domain: "外贸",
  });

  return pushToBindings(userId, eligible, message);
}

// ── 周报推送（外贸域） ───────────────────────────────────────

export async function pushWeeklyReport(
  userId: string,
  weekLabel: string,
  summary: string,
  highlights: string[],
  concerns: string[],
): Promise<{ sent: number; failed: number }> {
  const eligible = await getEligibleBindings(userId, "pushReport", "trade");
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  const parts: string[] = [`📊 周报 ${weekLabel}`, "", summary];

  if (highlights.length > 0) {
    parts.push("", "亮点：");
    highlights.slice(0, 3).forEach((h, i) => parts.push(`${i + 1}. ${h}`));
  }

  if (concerns.length > 0) {
    parts.push("", "需关注：");
    concerns.slice(0, 2).forEach((c, i) => parts.push(`${i + 1}. ${c}`));
  }

  parts.push("", '回复"周报"查看完整报告');

  const message = formatPushMessage({
    title: parts[0],
    body: parts.slice(2).join("\n"),
    domain: "外贸",
  });

  return pushToBindings(userId, eligible, message);
}

// ── 销售提醒推送（销售域） ────────────────────────────────────

export async function pushSalesReminder(
  userId: string,
  title: string,
  content: string,
): Promise<{ sent: number; failed: number }> {
  const eligible = await getEligibleBindings(userId, "pushSales", "sales");
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  const message = formatPushMessage({
    title,
    body: content,
    domain: "销售",
  });

  return pushToBindings(userId, eligible, message);
}

// ── 通用推送（不限域） ───────────────────────────────────────

export async function pushNotification(
  userId: string,
  title: string,
  content: string,
): Promise<{ sent: number; failed: number }> {
  const message = formatPushMessage({ title, body: content });
  return pushMessage(userId, message);
}

// ── 批量推送（Cron 用） ──────────────────────────────────────

export async function pushBriefingToAllUsers(orgId: string): Promise<{
  totalUsers: number;
  totalSent: number;
  totalFailed: number;
}> {
  const members = await db.organizationMember.findMany({
    where: { orgId, role: { not: "inactive" } },
    select: { userId: true },
  });

  let totalSent = 0;
  let totalFailed = 0;

  for (const m of members) {
    const today = new Date().toISOString().slice(0, 10);
    const sourceKey = `daily_briefing:${m.userId}:${today}`;

    const notification = await db.notification.findUnique({
      where: { sourceKey },
    });

    if (!notification) continue;

    let meta: Record<string, unknown> = {};
    try {
      meta = notification.metadata
        ? JSON.parse(typeof notification.metadata === "string" ? notification.metadata : JSON.stringify(notification.metadata))
        : {};
    } catch { /* ignore */ }

    const result = await pushDailyBriefing(
      m.userId,
      notification.summary ?? "今日暂无待办",
      (meta.totalUrgent as number) ?? 0,
      (meta.totalWarning as number) ?? 0,
      ((meta.items as unknown[])?.length as number) ?? 0,
    );

    totalSent += result.sent;
    totalFailed += result.failed;
  }

  return { totalUsers: members.length, totalSent, totalFailed };
}

export async function pushFollowupsToAllUsers(orgId: string): Promise<{
  totalSent: number;
  totalFailed: number;
}> {
  const members = await db.organizationMember.findMany({
    where: { orgId, role: { not: "inactive" } },
    select: { userId: true },
  });

  let totalSent = 0;
  let totalFailed = 0;

  for (const m of members) {
    const today = new Date().toISOString().slice(0, 10);
    const notifications = await db.notification.findMany({
      where: {
        userId: m.userId,
        type: "followup_reminder",
        sourceKey: { startsWith: `followup:` },
        createdAt: { gte: new Date(`${today}T00:00:00Z`) },
        status: "unread",
      },
      take: 5,
    });

    for (const n of notifications) {
      let meta: Record<string, unknown> = {};
      try {
        meta = n.metadata
          ? JSON.parse(typeof n.metadata === "string" ? n.metadata : JSON.stringify(n.metadata))
          : {};
      } catch { /* ignore */ }

      const result = await pushFollowupReminder(
        m.userId,
        n.title?.replace("跟进提醒：", "") ?? "客户",
        n.summary ?? "建议跟进",
        (meta.reason as string) ?? "scheduled_due",
        (meta.daysSilent as number) ?? 0,
      );

      totalSent += result.sent;
      totalFailed += result.failed;
    }
  }

  return { totalSent, totalFailed };
}

// ── 辅助函数 ──────────────────────────────────────────────────

interface EligibleBinding {
  id: string;
  channel: string;
  externalId: string;
  silentStart: string | null;
  silentEnd: string | null;
}

/**
 * 查找符合条件的绑定 —— 同时检查推送开关 + 域权限
 */
async function getEligibleBindings(
  userId: string,
  pushField: "pushBriefing" | "pushFollowup" | "pushReport" | "pushSales",
  domain: PushDomain,
): Promise<EligibleBinding[]> {
  const bindings = await db.weChatBinding.findMany({
    where: {
      userId,
      status: "active",
      [pushField]: true,
    },
    select: {
      id: true,
      channel: true,
      externalId: true,
      pushDomains: true,
      silentStart: true,
      silentEnd: true,
    },
  });

  return bindings.filter((b) => {
    // 域权限检查
    const domains = b.pushDomains.split(",").map((d) => d.trim());
    if (!domains.includes("all") && !domains.includes(domain)) {
      return false;
    }
    // 静默时段检查
    if (isInSilentPeriod(b.silentStart, b.silentEnd)) {
      return false;
    }
    return true;
  });
}

/**
 * 向符合条件的绑定发送消息
 */
async function pushToBindings(
  userId: string,
  bindings: EligibleBinding[],
  content: string,
): Promise<{ sent: number; failed: number }> {
  const { getAdapter } = await import("./gateway");
  let sent = 0;
  let failed = 0;

  for (const binding of bindings) {
    const adapter = getAdapter(binding.channel as "personal_wechat" | "wecom");
    if (!adapter) continue;

    try {
      await adapter.sendText(binding.externalId, content);
      await db.weChatMessage.create({
        data: {
          bindingId: binding.id,
          userId,
          direction: "outbound",
          channel: binding.channel,
          externalUserId: binding.externalId,
          content,
          messageType: "text",
        },
      });
      sent++;
    } catch {
      failed++;
    }
  }

  return { sent, failed };
}

function isInSilentPeriod(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function formatPushMessage(params: {
  title: string;
  body: string;
  footer?: string;
  domain?: string;
}): string {
  const parts: string[] = [];
  if (params.domain) {
    parts.push(`[${params.domain}] ${params.title}`);
  } else {
    parts.push(params.title);
  }
  parts.push("", params.body);
  if (params.footer) {
    parts.push("", "─".repeat(16), params.footer);
  }
  return parts.join("\n");
}
