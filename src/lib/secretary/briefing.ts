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
import { scanSalesDomain } from "./domains/sales";
import {
  scanFollowups,
  generateFollowupSuggestions,
  saveFollowupNotifications,
  suggestionsToItems,
} from "./followup-engine";
import type { DailyBriefing, DomainScanResult, BriefingItem } from "./types";

/**
 * 根据用户角色决定扫描哪些域
 */
async function getUserDomains(userId: string): Promise<string[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = user?.role ?? "user";

  switch (role) {
    case "admin":
    case "super_admin":
      return ["trade", "sales"];
    case "trade":
      return ["trade"];
    case "sales":
      return ["sales"];
    default:
      return [];
  }
}

export async function generateDailyBriefing(
  userId: string,
  orgId: string,
): Promise<DailyBriefing> {
  const domains: DomainScanResult[] = [];
  const userDomains = await getUserDomains(userId);
  const isAdmin = userDomains.includes("trade") && userDomains.includes("sales");

  // ── 外贸域扫描 ──
  if (userDomains.includes("trade")) {
    try {
      domains.push(await scanTradeDomain(orgId));
    } catch (e) {
      console.error("[secretary] Trade scan failed:", e);
    }

    // 外贸主动跟进引擎
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
  }

  // ── 销售域扫描 ──
  if (userDomains.includes("sales")) {
    try {
      domains.push(await scanSalesDomain(userId, { isAdmin }));
    } catch (e) {
      console.error("[secretary] Sales scan failed:", e);
    }
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

  // 异步推送到微信（不阻塞简报生成）
  pushBriefingToWeChat(userId, briefing).catch((e) =>
    console.error("[secretary] WeChat push failed:", e),
  );

  return briefing;
}

async function generateBriefingSummary(
  items: BriefingItem[],
  domains: DomainScanResult[],
): Promise<string> {
  const DOMAIN_LABELS: Record<string, string> = {
    trade: "外贸",
    trade_followup: "外贸跟进",
    sales: "销售",
  };

  const dataBlock = items.slice(0, 20).map((item) => {
    const tag = item.severity === "urgent" ? "[紧急]" : item.severity === "warning" ? "[注意]" : "[信息]";
    const domainTag = DOMAIN_LABELS[item.domain] ?? item.domain;
    return `[${domainTag}] ${tag} ${item.title}`;
  }).join("\n");

  const statsLines = domains.map((d) => {
    const label = DOMAIN_LABELS[d.domain] ?? d.domain;
    const kvs = Object.entries(d.stats).map(([k, v]) => `${k}: ${v}`).join(", ");
    return `${label}: ${kvs}`;
  }).join("\n");

  try {
    const result = await createCompletion({
      systemPrompt: `你是「青砚」AI 秘书。根据今日多业务域扫描数据，生成一段简洁的中文工作简报（3-6句话）。
要求：
- 如果有多个业务域（外贸、销售），按域简要汇报
- 先说最紧急的事（客户跟进、报价处理、量房安装等）
- 再说值得关注的（新询盘、客户回复）
- 语气像一个高效秘书在早会汇报，简明扼要
- 不要用 markdown，纯文本
- 不超过 200 字`,
      userPrompt: `今日待办事项：\n${dataBlock}\n\n各域统计：\n${statsLines}`,
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

async function pushBriefingToWeChat(userId: string, briefing: DailyBriefing): Promise<void> {
  const { pushDailyBriefing } = await import("@/lib/messaging/push-service");
  await pushDailyBriefing(
    userId,
    briefing.summary,
    briefing.totalUrgent,
    briefing.totalWarning,
    briefing.totalItems,
  );
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
