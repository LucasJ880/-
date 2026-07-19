/**
 * GA4 → MarketingMetricSnapshot 字段映射
 * Activepieces / 外部同步回调前调用，统一成 writeMarketingMetricSnapshot 可吃的 values。
 */

import { MARKETING_COUNT_FIELDS } from "../metrics";

export interface Ga4RawMetricRow {
  date?: string;
  propertyId?: string;
  sessions?: number | string;
  screenPageViews?: number | string;
  engagedSessions?: number | string;
  conversions?: number | string;
  totalUsers?: number | string;
  /** 自定义事件：generate_lead 等 */
  eventCount?: number | string;
  eventName?: string;
  /** 广告花费（若从 Ads 联动带来） */
  spend?: number | string;
  revenue?: number | string;
  currency?: string;
  channelAccountId?: string;
  campaignId?: string;
}

function n(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * 将一条 GA4 日汇总映射为青砚指标写入载荷（不含 orgId/userId）。
 */
export function mapGa4RowToMetricValues(row: Ga4RawMetricRow): Record<string, unknown> {
  const date = (row.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const sessions = n(row.sessions);
  const views = n(row.screenPageViews);
  const engagements = n(row.engagedSessions);
  const eventLeads =
    row.eventName && /lead|quote|contact|book/i.test(row.eventName)
      ? n(row.eventCount)
      : 0;
  const conversions = n(row.conversions);
  const leads = Math.max(eventLeads, conversions);

  const values: Record<string, unknown> = {
    capturedAt: date,
    periodStart: date,
    periodEnd: date,
    impressions: sessions,
    views,
    engagements,
    clicks: sessions,
    leads,
    qualifiedLeads: Math.round(leads * 0.4),
    appointments: 0,
    quotes: 0,
    wins: 0,
    spend: n(row.spend),
    revenue: n(row.revenue),
    currency: (row.currency || "CAD").toString().slice(0, 3).toUpperCase(),
    channelAccountId: row.channelAccountId || undefined,
    campaignId: row.campaignId || undefined,
    raw: {
      provider: "ga4",
      propertyId: row.propertyId ?? null,
      eventName: row.eventName ?? null,
      totalUsers: n(row.totalUsers),
    },
  };

  // 保证计数字段齐全
  for (const field of MARKETING_COUNT_FIELDS) {
    if (values[field] === undefined) values[field] = 0;
  }
  return values;
}

/** 生成幂等 ingestionKey：ga4:{property}:{date}:{channelAccountId?} */
export function buildGa4IngestionKey(row: Ga4RawMetricRow): string {
  const date = (row.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const property = (row.propertyId || "unknown").toString().slice(0, 80);
  const account = (row.channelAccountId || "none").toString().slice(0, 40);
  return `ga4:${property}:${date}:${account}`;
}
