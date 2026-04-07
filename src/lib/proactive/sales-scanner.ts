/**
 * 销售跟进扫描器
 *
 * 扫描当前用户的活跃销售机会，生成跟进提醒：
 * 1. 设定了 nextFollowupAt 且到期的机会
 * 2. 已报价但超过 3 天未跟进的机会
 * 3. 超过 7 天无任何互动的活跃机会
 */

import { db } from '@/lib/db';
import type { ProactiveSuggestion, TriggerSeverity } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeId(): string {
  return `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const ACTIVE_STAGES = [
  'new_inquiry',
  'consultation_booked',
  'measured',
  'quoted',
  'negotiation',
];

const STALE_DAYS_BY_STAGE: Record<string, number> = {
  new_inquiry: 3,
  consultation_booked: 5,
  measured: 5,
  quoted: 3,
  negotiation: 7,
};

export async function scanSalesForUser(userId: string): Promise<ProactiveSuggestion[]> {
  const now = new Date();
  const suggestions: ProactiveSuggestion[] = [];
  const seenKeys = new Set<string>();

  const opportunities = await db.salesOpportunity.findMany({
    where: {
      stage: { in: ACTIVE_STAGES },
      OR: [
        { assignedToId: userId },
        { createdById: userId },
      ],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      interactions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, status: true },
      },
    },
  });

  for (const opp of opportunities) {
    // 1. Scheduled follow-up is due
    if (opp.nextFollowupAt) {
      const msUntil = opp.nextFollowupAt.getTime() - now.getTime();
      if (msUntil <= DAY_MS) {
        const isOverdue = msUntil < 0;
        const severity: TriggerSeverity = isOverdue ? 'urgent' : 'warning';
        const dedupeKey = `sales_followup:${opp.id}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          suggestions.push({
            id: makeId(),
            customerId: opp.customer.id,
            customerName: opp.customer.name,
            opportunityId: opp.id,
            kind: 'sales_followup_due',
            severity,
            title: isOverdue
              ? `跟进逾期：${opp.customer.name} — ${opp.title}`
              : `今日跟进：${opp.customer.name} — ${opp.title}`,
            description: `计划跟进日期 ${opp.nextFollowupAt.toISOString().slice(0, 10)}`,
            suggestedAction: opp.customer.phone
              ? { type: 'call_customer', label: `拨打 ${opp.customer.phone}`, params: { customerId: opp.customer.id } }
              : { type: 'view_customer', label: '查看客户', params: { customerId: opp.customer.id } },
            dedupeKey,
            createdAt: now.toISOString(),
          });
        }
      }
    }

    // 2. Quoted but no follow-up for 3+ days
    const lastQuote = opp.quotes[0];
    if (lastQuote && opp.stage === 'quoted') {
      const daysSinceQuote = (now.getTime() - new Date(lastQuote.createdAt).getTime()) / DAY_MS;
      if (daysSinceQuote >= 3 && lastQuote.status === 'sent') {
        const dedupeKey = `sales_quote_pending:${opp.id}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          suggestions.push({
            id: makeId(),
            customerId: opp.customer.id,
            customerName: opp.customer.name,
            opportunityId: opp.id,
            kind: 'sales_quote_pending',
            severity: daysSinceQuote >= 7 ? 'urgent' : 'warning',
            title: `报价未回复 ${Math.floor(daysSinceQuote)} 天：${opp.customer.name}`,
            description: `报价已发送 ${Math.floor(daysSinceQuote)} 天，建议跟进客户确认意向。`,
            suggestedAction: {
              type: 'send_followup_email',
              label: '发送跟进邮件',
              params: { customerId: opp.customer.id, opportunityId: opp.id },
            },
            dedupeKey,
            createdAt: now.toISOString(),
          });
        }
      }
    }

    // 3. No interaction for too long
    const lastInteraction = opp.interactions[0];
    const staleDays = STALE_DAYS_BY_STAGE[opp.stage] ?? 7;
    const lastActivityDate = lastInteraction
      ? new Date(lastInteraction.createdAt)
      : new Date(opp.createdAt);
    const daysSilent = (now.getTime() - lastActivityDate.getTime()) / DAY_MS;

    if (daysSilent >= staleDays) {
      const dedupeKey = `sales_stale:${opp.id}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        suggestions.push({
          id: makeId(),
          customerId: opp.customer.id,
          customerName: opp.customer.name,
          opportunityId: opp.id,
          kind: 'sales_stale_opportunity',
          severity: daysSilent >= staleDays * 2 ? 'urgent' : 'warning',
          title: `${Math.floor(daysSilent)} 天未联系：${opp.customer.name}`,
          description: `"${opp.title}" 处于「${opp.stage}」阶段已 ${Math.floor(daysSilent)} 天未有互动。`,
          suggestedAction: {
            type: 'view_customer',
            label: '查看客户详情',
            params: { customerId: opp.customer.id },
          },
          dedupeKey,
          createdAt: now.toISOString(),
        });
      }
    }
  }

  const severityOrder: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
  suggestions.sort(
    (a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2),
  );

  return suggestions;
}
