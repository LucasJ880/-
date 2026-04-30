/**
 * 外贸域扫描器 — AI 秘书
 *
 * 扫描外贸模块的所有待办事项：
 * 1. 跟进逾期的客户
 * 2. 即将过期的报价
 * 3. 发出开发信后无回复的客户
 * 4. 新发现的高分客户待审核
 * 5. 活跃活动的管道概况
 */

import { db } from "@/lib/db";
import { TRADE_DB_STAGES_NO_REPLY_TOUCH, TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE } from "@/lib/trade/stage";
import type { DomainScanResult, BriefingItem } from "../types";

const DAY_MS = 86_400_000;

export async function scanTradeDomain(orgId: string): Promise<DomainScanResult> {
  const now = new Date();
  const items: BriefingItem[] = [];
  const stats: Record<string, number> = {};

  // ── 1. 跟进逾期客户 ──
  const overdueProspects = await db.tradeProspect.findMany({
    where: {
      orgId,
      nextFollowUpAt: { lt: now },
      stage: { notIn: [...TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE] },
    },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      contactEmail: true,
      country: true,
      stage: true,
      nextFollowUpAt: true,
      campaignId: true,
    },
    take: 20,
    orderBy: { nextFollowUpAt: "asc" },
  });
  stats.overdueFollowUps = overdueProspects.length;

  for (const p of overdueProspects) {
    const daysOverdue = Math.floor((now.getTime() - (p.nextFollowUpAt?.getTime() ?? now.getTime())) / DAY_MS);
    items.push({
      id: `trade_overdue_${p.id}`,
      domain: "trade",
      severity: daysOverdue >= 3 ? "urgent" : "warning",
      category: "followup_overdue",
      title: `${p.companyName} 跟进已逾期 ${daysOverdue} 天`,
      description: p.contactName
        ? `联系人 ${p.contactName}${p.country ? `（${p.country}）` : ""}，建议尽快跟进。`
        : `${p.country ? `${p.country}客户，` : ""}建议尽快跟进。`,
      action: {
        type: "followup_draft",
        label: "查看 AI 跟进草稿",
        payload: { prospectId: p.id, companyName: p.companyName },
      },
      entityType: "trade_prospect",
      entityId: p.id,
      dedupeKey: `trade_overdue:${p.id}`,
    });
  }

  // ── 2. 即将过期的报价（3天内） ──
  const threeDaysLater = new Date(now.getTime() + 3 * DAY_MS);
  const expiringQuotes = await db.tradeQuote.findMany({
    where: {
      orgId,
      status: { in: ["sent", "negotiating"] },
      expiresAt: { gt: now, lt: threeDaysLater },
    },
    select: { id: true, quoteNumber: true, companyName: true, totalAmount: true, currency: true, expiresAt: true },
    take: 10,
  });
  stats.expiringQuotes = expiringQuotes.length;

  for (const q of expiringQuotes) {
    const daysLeft = Math.max(0, Math.ceil(((q.expiresAt?.getTime() ?? 0) - now.getTime()) / DAY_MS));
    items.push({
      id: `trade_quote_exp_${q.id}`,
      domain: "trade",
      severity: daysLeft <= 1 ? "urgent" : "warning",
      category: "quote_expiring",
      title: `报价 ${q.quoteNumber} ${daysLeft <= 0 ? "今天到期" : `还有 ${daysLeft} 天到期`}`,
      description: `${q.companyName}，金额 ${q.currency} ${q.totalAmount.toLocaleString()}`,
      action: {
        type: "quote_extend",
        label: "延期报价",
        payload: { quoteId: q.id },
      },
      entityType: "trade_quote",
      entityId: q.id,
      dedupeKey: `trade_quote_exp:${q.id}`,
    });
  }

  // ── 3. 开发信发出后无回复（5-14天） ──
  const fiveDaysAgo = new Date(now.getTime() - 5 * DAY_MS);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);
  const noResponse = await db.tradeProspect.findMany({
    where: {
      orgId,
      stage: { in: [...TRADE_DB_STAGES_NO_REPLY_TOUCH] },
      outreachSentAt: { gt: fourteenDaysAgo, lt: fiveDaysAgo },
    },
    select: { id: true, companyName: true, country: true, outreachSentAt: true },
    take: 10,
  });
  stats.noResponse = noResponse.length;

  for (const p of noResponse) {
    const daysSince = Math.floor((now.getTime() - (p.outreachSentAt?.getTime() ?? now.getTime())) / DAY_MS);
    items.push({
      id: `trade_noreply_${p.id}`,
      domain: "trade",
      severity: daysSince >= 10 ? "warning" : "info",
      category: "no_response",
      title: `${p.companyName} 开发信已发 ${daysSince} 天未回复`,
      description: `建议发送二次触达邮件${p.country ? `（${p.country}）` : ""}。`,
      action: {
        type: "followup_draft",
        label: "生成二次触达",
        payload: { prospectId: p.id, companyName: p.companyName, isSecondTouch: true },
      },
      entityType: "trade_prospect",
      entityId: p.id,
      dedupeKey: `trade_noreply:${p.id}`,
    });
  }

  // ── 4. 新发现的高分客户待审核 ──
  const pendingReview = await db.tradeProspect.findMany({
    where: {
      orgId,
      stage: "qualified",
      outreachBody: null,
      score: { gte: 7 },
    },
    select: { id: true, companyName: true, score: true, country: true },
    take: 5,
    orderBy: { score: "desc" },
  });
  stats.pendingReview = pendingReview.length;

  for (const p of pendingReview) {
    items.push({
      id: `trade_review_${p.id}`,
      domain: "trade",
      severity: "info",
      category: "prospect_review",
      title: `新客户 ${p.companyName} 评分 ${p.score?.toFixed(1) ?? "N/A"}`,
      description: `${p.country ? `${p.country}，` : ""}AI 评估为高潜力客户，待审核是否跟进。`,
      action: {
        type: "prospect_review",
        label: "查看并决定",
        payload: { prospectId: p.id },
      },
      entityType: "trade_prospect",
      entityId: p.id,
      dedupeKey: `trade_review:${p.id}`,
    });
  }

  // ── 5. 活动概况统计 ──
  const [activeCampaigns, totalProspects, recentReplies] = await Promise.all([
    db.tradeCampaign.count({ where: { orgId, status: "active" } }),
    db.tradeProspect.count({ where: { orgId } }),
    db.tradeMessage.count({
      where: {
        prospect: { orgId },
        direction: "inbound",
        createdAt: { gt: new Date(now.getTime() - DAY_MS) },
      },
    }),
  ]);
  stats.activeCampaigns = activeCampaigns;
  stats.totalProspects = totalProspects;
  stats.recentReplies = recentReplies;

  if (recentReplies > 0) {
    items.unshift({
      id: `trade_replies_${now.toISOString().slice(0, 10)}`,
      domain: "trade",
      severity: "info",
      category: "new_replies",
      title: `昨日收到 ${recentReplies} 条客户回复`,
      description: "建议查看并及时回复。",
      action: { type: "view_replies", label: "查看回复" },
      dedupeKey: `trade_replies:${now.toISOString().slice(0, 10)}`,
    });
  }

  // 按严重度排序
  const order: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
  items.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));

  return { domain: "trade", items, stats };
}
