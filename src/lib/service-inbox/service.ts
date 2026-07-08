/**
 * 客服收件箱 — 第一期：客户消息落库 + 未回复队列 + SLA 超时提醒
 *
 * 客户 = 未绑定青砚账号的外部联系人，给机器人微信号发消息。
 * 与内部员工 AI 助理通道（WeChatMessage）分开建模，按 orgId 隔离。
 *
 * SLA 规则（工作时间 09:00–21:00，时区 SERVICE_INBOX_TZ，默认多伦多）：
 *   未回复 ≥ 15 分钟 → 一级提醒（微信推送 + 站内通知）
 *   未回复 ≥ 60 分钟 → 升级提醒（同渠道，⚠️ 标记）
 * 客服在青砚里回复或「标记已处理」即复位；夜间到期的会在次日 9 点首轮扫描时提醒。
 */

import { db } from "@/lib/db";
import { ensureSendAdapter, pushMessage } from "@/lib/messaging/gateway";
import type { ChannelType } from "@/lib/messaging/types";
import { logAudit } from "@/lib/audit/logger";

const SLA_LEVEL1_MINUTES = 15;
const SLA_LEVEL2_MINUTES = 60;
const WORK_HOUR_START = 9;
const WORK_HOUR_END = 21;
const TIMEZONE = process.env.SERVICE_INBOX_TZ || "America/Toronto";

// ── 入站：客户消息落库 ────────────────────────────────────────

export async function recordCustomerMessage(args: {
  orgId: string;
  channel: ChannelType;
  externalUserId: string;
  displayName?: string;
  content: string;
  messageType: string;
  externalMsgId?: string;
  timestamp: Date;
}): Promise<void> {
  const conversation = await db.serviceConversation.upsert({
    where: {
      orgId_channel_externalUserId: {
        orgId: args.orgId,
        channel: args.channel,
        externalUserId: args.externalUserId,
      },
    },
    create: {
      orgId: args.orgId,
      channel: args.channel,
      externalUserId: args.externalUserId,
      displayName: args.displayName,
      status: "open",
      lastCustomerMessageAt: args.timestamp,
      unansweredSince: args.timestamp,
      reminderLevel: 0,
    },
    update: {
      status: "open",
      lastCustomerMessageAt: args.timestamp,
      ...(args.displayName ? { displayName: args.displayName } : {}),
    },
    select: { id: true, unansweredSince: true },
  });

  // 已在未回复状态时保留原起点（等待时长从第一条未回消息算起）
  if (!conversation.unansweredSince) {
    await db.serviceConversation.update({
      where: { id: conversation.id },
      data: { unansweredSince: args.timestamp, reminderLevel: 0 },
    });
  }

  await db.serviceMessage.create({
    data: {
      conversationId: conversation.id,
      orgId: args.orgId,
      direction: "inbound",
      content: args.content,
      messageType: args.messageType,
      externalMsgId: args.externalMsgId,
    },
  });
}

// ── 出站：青砚里回复客户 ──────────────────────────────────────

export async function replyToConversation(args: {
  orgId: string;
  conversationId: string;
  userId: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const conversation = await db.serviceConversation.findFirst({
    where: { id: args.conversationId, orgId: args.orgId },
  });
  if (!conversation) return { ok: false, error: "会话不存在" };

  const adapter = await ensureSendAdapter(
    conversation.channel as ChannelType,
    args.orgId,
  );
  if (!adapter) {
    return { ok: false, error: "微信通道未连接，无法发送（请检查网关登录状态）" };
  }

  try {
    await adapter.sendText(conversation.externalUserId, args.text);
  } catch (e) {
    console.error("[ServiceInbox] reply send failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "发送失败，请稍后重试",
    };
  }

  const now = new Date();
  await db.serviceMessage.create({
    data: {
      conversationId: conversation.id,
      orgId: args.orgId,
      direction: "outbound",
      content: args.text,
      messageType: "text",
      sentByUserId: args.userId,
    },
  });
  await db.serviceConversation.update({
    where: { id: conversation.id },
    data: { lastReplyAt: now, unansweredSince: null, reminderLevel: 0 },
  });

  await logAudit({
    userId: args.userId,
    orgId: args.orgId,
    action: "service_inbox.reply",
    targetType: "service_conversation",
    targetId: conversation.id,
  }).catch(() => {});

  return { ok: true };
}

/** 标记已处理（客服在微信里直接回过、或无需回复时手动清除未回状态） */
export async function markConversationHandled(args: {
  orgId: string;
  conversationId: string;
  userId: string;
}): Promise<boolean> {
  const updated = await db.serviceConversation.updateMany({
    where: { id: args.conversationId, orgId: args.orgId },
    data: { status: "handled", unansweredSince: null, reminderLevel: 0 },
  });
  if (updated.count === 0) return false;

  await logAudit({
    userId: args.userId,
    orgId: args.orgId,
    action: "service_inbox.mark_handled",
    targetType: "service_conversation",
    targetId: args.conversationId,
  }).catch(() => {});
  return true;
}

// ── SLA 扫描（cron 每 10 分钟）──────────────────────────────

function hourInTimezone(date: Date): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number(formatted) % 24;
}

function waitedLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export interface SlaScanResult {
  scanned: number;
  level1Sent: number;
  level2Sent: number;
  skippedOffHours: boolean;
}

export async function runServiceInboxSla(
  now = new Date(),
): Promise<SlaScanResult> {
  const hour = hourInTimezone(now);
  if (hour < WORK_HOUR_START || hour >= WORK_HOUR_END) {
    return { scanned: 0, level1Sent: 0, level2Sent: 0, skippedOffHours: true };
  }

  const overdue = await db.serviceConversation.findMany({
    where: {
      status: "open",
      unansweredSince: {
        lte: new Date(now.getTime() - SLA_LEVEL1_MINUTES * 60_000),
      },
      reminderLevel: { lt: 2 },
    },
    orderBy: { unansweredSince: "asc" },
    take: 50,
  });

  let level1Sent = 0;
  let level2Sent = 0;

  for (const conv of overdue) {
    if (!conv.unansweredSince) continue;
    const unansweredSince = conv.unansweredSince;
    const waitedMinutes = Math.floor(
      (now.getTime() - unansweredSince.getTime()) / 60_000,
    );
    const targetLevel =
      waitedMinutes >= SLA_LEVEL2_MINUTES ? 2 : 1;
    if (targetLevel <= conv.reminderLevel) continue;

    const customerLabel = conv.displayName || conv.externalUserId;
    const text =
      targetLevel === 2
        ? `⚠️ 客服升级提醒\n客户「${customerLabel}」的微信消息已 ${waitedLabel(waitedMinutes)} 无人回复，请立即处理。\n（在青砚「客服收件箱」回复或标记已处理后停止提醒）`
        : `📨 客服提醒\n客户「${customerLabel}」的微信消息已等待 ${waitedLabel(waitedMinutes)}，请尽快回复。\n（在青砚「客服收件箱」处理）`;

    const recipients = await db.weChatBinding.findMany({
      where: { orgId: conv.orgId, status: "active" },
      select: { userId: true },
      distinct: ["userId"],
    });

    for (const r of recipients) {
      await pushMessage(r.userId, text).catch(() => {});
    }

    // 站内通知（sourceKey 幂等，避免 cron 重复创建）
    if (recipients.length > 0) {
      await db.notification
        .createMany({
          data: recipients.map((r) => ({
            userId: r.userId,
            orgId: conv.orgId,
            type: "service_sla",
            category: "reminder",
            title:
              targetLevel === 2
                ? `客服升级提醒：${customerLabel} 已 ${waitedLabel(waitedMinutes)} 未回复`
                : `客服提醒：${customerLabel} 等待回复 ${waitedLabel(waitedMinutes)}`,
            entityType: "service_conversation",
            entityId: conv.id,
            priority: targetLevel === 2 ? "urgent" : "high",
            sourceKey: `service-sla:${conv.id}:${targetLevel}:${unansweredSince.toISOString()}:${r.userId}`,
          })),
          skipDuplicates: true,
        })
        .catch(() => {});
    }

    await db.serviceConversation.update({
      where: { id: conv.id },
      data: { reminderLevel: targetLevel },
    });

    if (targetLevel === 2) level2Sent++;
    else level1Sent++;
  }

  return {
    scanned: overdue.length,
    level1Sent,
    level2Sent,
    skippedOffHours: false,
  };
}
