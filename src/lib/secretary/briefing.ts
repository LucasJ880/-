/**
 * AI 主动秘书 — 每日简报引擎
 *
 * 1. 收集各域扫描结果
 * 2. 用 AI 汇总为自然语言简报
 * 3. 写入 Notification 推送给用户
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { scanTradeDomain } from "./domains/trade";
import {
  scanFollowups,
  generateFollowupSuggestions,
  saveFollowupNotifications,
  suggestionsToItems,
} from "./followup-engine";
import type { DailyBriefing, DomainScanResult, BriefingItem } from "./types";

export async function generateDailyBriefing(
  userId: string,
  orgId: string,
): Promise<DailyBriefing> {
  const domains: DomainScanResult[] = [];

  // 收集各域扫描（后续加 sales/project 只需加一行）
  try {
    domains.push(await scanTradeDomain(orgId));
  } catch (e) {
    console.error("[secretary] Trade scan failed:", e);
  }

  // 主动跟进引擎：扫描需要跟进的客户 + AI 生成草稿
  try {
    const candidates = await scanFollowups(orgId);
    if (candidates.length > 0) {
      const suggestions = await generateFollowupSuggestions(candidates, { maxDrafts: 3 });
      await saveFollowupNotifications(userId, suggestions);
      const followupItems = suggestionsToItems(suggestions);
      if (followupItems.length > 0) {
        domains.push({
          domain: "trade_followup",
          items: followupItems,
          stats: {
            totalCandidates: candidates.length,
            draftsGenerated: suggestions.filter((s) => s.draft).length,
          },
        });
      }
    }
  } catch (e) {
    console.error("[secretary] Followup engine failed:", e);
  }

  const allItems = domains.flatMap((d) => d.items);
  const totalUrgent = allItems.filter((i) => i.severity === "urgent").length;
  const totalWarning = allItems.filter((i) => i.severity === "warning").length;

  let summary: string;
  if (allItems.length === 0) {
    summary = "今日一切正常，暂无需要处理的事项。";
  } else {
    summary = await generateBriefingSummary(allItems, domains);
  }

  const briefing: DailyBriefing = {
    generatedAt: new Date().toISOString(),
    userId,
    domains,
    summary,
    totalUrgent,
    totalWarning,
    totalItems: allItems.length,
  };

  await saveBriefingNotification(userId, briefing);

  return briefing;
}

async function generateBriefingSummary(
  items: BriefingItem[],
  domains: DomainScanResult[],
): Promise<string> {
  const tradeStats = domains.find((d) => d.domain === "trade")?.stats ?? {};

  const dataBlock = items.slice(0, 15).map((item) => {
    const tag = item.severity === "urgent" ? "[紧急]" : item.severity === "warning" ? "[注意]" : "[信息]";
    return `${tag} ${item.title}`;
  }).join("\n");

  const statsBlock = Object.entries(tradeStats)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  try {
    const result = await createCompletion({
      systemPrompt: `你是「青砚」AI 秘书。根据今日扫描数据，生成一段简洁的中文工作简报（3-5句话）。
要求：
- 先说最紧急的事（几个客户要跟进、几个报价要处理）
- 再说值得关注的（新客户、客户回复）
- 语气像一个高效秘书在早会汇报，简明扼要
- 不要用 markdown，纯文本
- 不超过 150 字`,
      userPrompt: `今日待办事项：\n${dataBlock}\n\n统计：${statsBlock}`,
      mode: "fast",
    });
    return result.trim();
  } catch {
    const urgentCount = items.filter((i) => i.severity === "urgent").length;
    const warningCount = items.filter((i) => i.severity === "warning").length;
    return `今日有 ${urgentCount} 项紧急事项、${warningCount} 项需关注事项，共 ${items.length} 条待办。请查看详情。`;
  }
}

async function saveBriefingNotification(
  userId: string,
  briefing: DailyBriefing,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const sourceKey = `daily_briefing:${userId}:${today}`;

  const existing = await db.notification.findUnique({ where: { sourceKey } });
  if (existing) {
    await db.notification.update({
      where: { sourceKey },
      data: {
        title: buildBriefingTitle(briefing),
        summary: briefing.summary,
        metadata: JSON.stringify({
          type: "daily_briefing",
          domains: briefing.domains.map((d) => ({
            domain: d.domain,
            itemCount: d.items.length,
            stats: d.stats,
          })),
          items: briefing.domains.flatMap((d) => d.items).slice(0, 20),
          totalUrgent: briefing.totalUrgent,
          totalWarning: briefing.totalWarning,
        }),
        status: "unread",
        readAt: null,
      },
    });
    return;
  }

  await db.notification.create({
    data: {
      userId,
      type: "daily_briefing",
      category: "ai_secretary",
      title: buildBriefingTitle(briefing),
      summary: briefing.summary,
      priority: briefing.totalUrgent > 0 ? "high" : briefing.totalWarning > 0 ? "medium" : "low",
      sourceKey,
      metadata: JSON.stringify({
        type: "daily_briefing",
        domains: briefing.domains.map((d) => ({
          domain: d.domain,
          itemCount: d.items.length,
          stats: d.stats,
        })),
        items: briefing.domains.flatMap((d) => d.items).slice(0, 20),
        totalUrgent: briefing.totalUrgent,
        totalWarning: briefing.totalWarning,
      }),
    },
  });
}

function buildBriefingTitle(briefing: DailyBriefing): string {
  const parts: string[] = [];
  if (briefing.totalUrgent > 0) parts.push(`${briefing.totalUrgent} 项紧急`);
  if (briefing.totalWarning > 0) parts.push(`${briefing.totalWarning} 项待关注`);
  if (parts.length === 0) return "今日简报：一切正常";
  return `今日简报：${parts.join("、")}`;
}

/**
 * 为组织内所有活跃用户生成简报（Cron 调用）
 */
export async function generateBriefingsForOrg(orgId: string): Promise<number> {
  const members = await db.organizationMember.findMany({
    where: { orgId, role: { not: "inactive" } },
    select: { userId: true },
  });

  let count = 0;
  for (const m of members) {
    try {
      await generateDailyBriefing(m.userId, orgId);
      count++;
    } catch (e) {
      console.error(`[secretary] Briefing failed for user ${m.userId}:`, e);
    }
  }
  return count;
}
