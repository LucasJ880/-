/**
 * 增长中心渠道账号 provider 枚举（与 MarketingChannelAccount.provider 对齐）
 */

export const MARKETING_CHANNEL_PROVIDERS = [
  "manual",
  "gsc",
  "ga4",
  "gbp",
  "meta",
  "tiktok",
  "google_ads",
  "xiaohongshu",
] as const;

export type MarketingChannelProvider =
  (typeof MARKETING_CHANNEL_PROVIDERS)[number];

/** 可触发 Activepieces sync-metrics 的付费/分析源 */
export const SYNCABLE_METRIC_PROVIDERS = [
  "ga4",
  "google_ads",
  "meta",
  "xiaohongshu",
  "tiktok",
  "gsc",
] as const;

export type SyncableMetricProvider =
  (typeof SYNCABLE_METRIC_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<MarketingChannelProvider, string> = {
  manual: "手动",
  gsc: "Google Search Console",
  ga4: "GA4",
  gbp: "Google 商家",
  meta: "Meta（Facebook/Instagram）",
  tiktok: "TikTok",
  google_ads: "Google Ads",
  xiaohongshu: "小红书",
};

export function isMarketingChannelProvider(
  value: unknown,
): value is MarketingChannelProvider {
  return (
    typeof value === "string" &&
    (MARKETING_CHANNEL_PROVIDERS as readonly string[]).includes(value)
  );
}

export function isSyncableMetricProvider(
  value: unknown,
): value is SyncableMetricProvider {
  return (
    typeof value === "string" &&
    (SYNCABLE_METRIC_PROVIDERS as readonly string[]).includes(value)
  );
}

/** 把常见别名归一成青砚 provider */
export function normalizeProviderHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const aliases: Record<string, string> = {
    facebook: "meta",
    fb: "meta",
    instagram: "meta",
    ig: "meta",
    "meta_ads": "meta",
    google: "google_ads",
    "google-ads": "google_ads",
    adwords: "google_ads",
    xhs: "xiaohongshu",
    rednote: "xiaohongshu",
    "little_red_book": "xiaohongshu",
    "ga4_raw": "ga4",
  };
  return aliases[raw] || raw;
}
