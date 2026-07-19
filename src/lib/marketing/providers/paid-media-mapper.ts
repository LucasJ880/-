/**
 * Google Ads / Meta / 小红书等付费渠道 → MarketingMetricSnapshot
 * Activepieces、批量 API、数字员工灌数共用。
 */

import { MARKETING_COUNT_FIELDS } from "../metrics";
import { normalizeProviderHint } from "../channel-providers";

export const PAID_MEDIA_PROVIDERS = [
  "google_ads",
  "meta",
  "xiaohongshu",
  "tiktok",
] as const;

export type PaidMediaProvider = (typeof PAID_MEDIA_PROVIDERS)[number];

export interface PaidMediaRawRow {
  date?: string;
  weekStart?: string;
  week_start?: string;
  periodStart?: string;
  periodEnd?: string;
  period_start?: string;
  period_end?: string;
  provider?: string;
  source?: string;
  channelAccountId?: string;
  externalAccountId?: string;
  external_account_id?: string;
  accountId?: string;
  spend?: number | string;
  cost?: number | string;
  amount?: number | string;
  impressions?: number | string;
  views?: number | string;
  engagements?: number | string;
  clicks?: number | string;
  leads?: number | string;
  conversions?: number | string;
  results?: number | string;
  qualifiedLeads?: number | string;
  qualified_leads?: number | string;
  appointments?: number | string;
  quotes?: number | string;
  wins?: number | string;
  revenue?: number | string;
  purchase_value?: number | string;
  currency?: string;
  ingestionKey?: string;
  campaignId?: string;
  granularity?: string;
}

function n(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function count(value: unknown): number {
  return Math.round(n(value));
}

function pickDate(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}/.test(candidate)) {
      return candidate.slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

/** weekStart + 6 天（含起止共 7 天） */
export function weekEndFromStart(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

export function isPaidMediaProvider(value: unknown): value is PaidMediaProvider {
  const normalized = normalizeProviderHint(value);
  return (
    typeof normalized === "string" &&
    (PAID_MEDIA_PROVIDERS as readonly string[]).includes(normalized)
  );
}

/**
 * 将付费渠道一行映射为 writeMarketingMetricSnapshot 可吃的 values。
 */
export function mapPaidMediaRowToMetricValues(
  row: PaidMediaRawRow,
  provider: PaidMediaProvider,
): Record<string, unknown> {
  const weekStart = pickDate(
    row.weekStart,
    row.week_start,
    row.periodStart,
    row.period_start,
    row.date,
  );
  const periodEnd = pickDate(
    row.periodEnd,
    row.period_end,
    weekEndFromStart(weekStart),
  );
  const spend = n(row.spend ?? row.cost ?? row.amount);
  const leads = count(row.leads ?? row.conversions ?? row.results);
  const qualifiedLeads = count(
    row.qualifiedLeads ?? row.qualified_leads ?? Math.round(leads * 0.4),
  );
  const channelAccountId =
    row.channelAccountId ||
    undefined;
  const externalAccountId =
    row.externalAccountId ||
    row.external_account_id ||
    row.accountId ||
    undefined;

  const values: Record<string, unknown> = {
    capturedAt: weekStart,
    periodStart: weekStart,
    periodEnd,
    granularity: row.granularity || "weekly",
    impressions: count(row.impressions),
    views: count(row.views),
    engagements: count(row.engagements),
    clicks: count(row.clicks),
    leads,
    qualifiedLeads,
    appointments: count(row.appointments),
    quotes: count(row.quotes),
    wins: count(row.wins),
    spend,
    revenue: n(row.revenue ?? row.purchase_value),
    currency: (row.currency || "CAD").toString().slice(0, 3).toUpperCase(),
    channelAccountId,
    campaignId: row.campaignId || undefined,
    externalAccountId,
    raw: {
      provider,
      externalAccountId: externalAccountId ?? null,
    },
  };

  for (const field of MARKETING_COUNT_FIELDS) {
    if (values[field] === undefined) values[field] = 0;
  }
  return values;
}

export function buildPaidMediaIngestionKey(input: {
  provider: PaidMediaProvider;
  weekStart: string;
  channelAccountId?: string | null;
  externalAccountId?: string | null;
}): string {
  const account =
    (input.channelAccountId || input.externalAccountId || "none")
      .toString()
      .slice(0, 80);
  return `${input.provider}:${account}:${input.weekStart}`;
}

/** 从回调行推断是否应按付费渠道映射 */
export function detectPaidMediaProvider(
  sourceHint: string | null,
  raw: Record<string, unknown>,
): PaidMediaProvider | null {
  const fromHint = normalizeProviderHint(sourceHint || raw.provider || raw.source);
  if (isPaidMediaProvider(fromHint)) return fromHint;
  // 有 spend/cost 且无 GA4 特征时，不盲目推断 provider
  return null;
}
