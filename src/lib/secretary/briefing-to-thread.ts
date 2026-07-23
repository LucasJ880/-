/**
 * 每日简报 → AI 对话线程
 *
 * 简报生成后主动写进用户的「每日简报」置顶对话，
 * 手机端打开青砚（默认进对话页）即可看到当天简报，无需翻通知。
 */

import { db } from "@/lib/db";
import type { DailyBriefing } from "./types";

const BRIEF_THREAD_TITLE = "📋 每日简报";

const SEVERITY_ICONS: Record<string, string> = {
  urgent: "🔴",
  warning: "🟡",
  info: "🔵",
};

function formatBriefingMarkdown(briefing: DailyBriefing): string {
  const date = new Date().toLocaleDateString("zh-CN", {
    timeZone: "America/Toronto",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const lines: string[] = [`**${date} 工作简报**`, "", briefing.summary];

  const items = briefing.domains.flatMap((d) => d.items);
  if (items.length > 0) {
    lines.push("", "---", "");
    const ordered = [...items].sort((a, b) => {
      const rank = { urgent: 0, warning: 1, info: 2 } as Record<string, number>;
      return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    });
    for (const item of ordered.slice(0, 10)) {
      lines.push(`${SEVERITY_ICONS[item.severity] ?? "•"} ${item.title}`);
    }
    if (items.length > 10) {
      lines.push(`…另有 ${items.length - 10} 项，可以直接问我详情`);
    }
  }

  lines.push("", "有想跟进的直接回复我，比如「帮我看第一条」。");
  return lines.join("\n");
}

/**
 * 把简报写入用户的置顶「每日简报」线程（无则创建）。
 * 每天最多写一条：若当天已有简报消息则更新为最新内容。
 * Phase 3B-A：必须带 orgId，禁止创建无组织线程。
 */
export async function writeBriefingToThread(
  userId: string,
  briefing: DailyBriefing,
  orgId: string,
): Promise<void> {
  if (!orgId) {
    throw new Error("writeBriefingToThread requires orgId");
  }

  let thread = await db.aiThread.findFirst({
    where: {
      userId,
      orgId,
      title: BRIEF_THREAD_TITLE,
      archived: false,
    },
    select: { id: true },
  });

  if (!thread) {
    thread = await db.aiThread.create({
      data: {
        userId,
        orgId,
        title: BRIEF_THREAD_TITLE,
        pinned: true,
      },
      select: { id: true },
    });
  }

  const content = formatBriefingMarkdown(briefing);

  // 当天已写过 → 更新（cron 兜底重跑时不刷屏）
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const existing = await db.aiMessage.findFirst({
    where: {
      threadId: thread.id,
      role: "assistant",
      createdAt: { gte: todayStart },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    await db.aiMessage.update({
      where: { id: existing.id },
      data: { content },
    });
  } else {
    await db.aiMessage.create({
      data: { threadId: thread.id, role: "assistant", content },
    });
  }

  await db.aiThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: new Date() },
  });
}
