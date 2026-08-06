import crypto from "node:crypto";
import { db } from "@/lib/db";

export const CRM_MARKETING_SOURCE_PROVIDERS = [
  "google_ads",
  "meta",
  "xiaohongshu",
] as const;

export type CrmMarketingSourceProvider =
  (typeof CRM_MARKETING_SOURCE_PROVIDERS)[number];

const SOURCE_ALIASES: Record<string, CrmMarketingSourceProvider> = {
  google_ads: "google_ads",
  googleads: "google_ads",
  google_ad: "google_ads",
  google_广告: "google_ads",
  adwords: "google_ads",
  meta: "meta",
  meta_ads: "meta",
  facebook: "meta",
  facebook_ads: "meta",
  fb: "meta",
  instagram: "meta",
  instagram_ads: "meta",
  ig: "meta",
  ins: "meta",
  脸书: "meta",
  xiaohongshu: "xiaohongshu",
  xhs: "xiaohongshu",
  rednote: "xiaohongshu",
  little_red_book: "xiaohongshu",
  小红书: "xiaohongshu",
  小红书广告: "xiaohongshu",
};

const PROVIDER_LABELS: Record<CrmMarketingSourceProvider, string> = {
  google_ads: "Google Ads",
  meta: "Meta（Facebook / Instagram）",
  xiaohongshu: "小红书",
};

const ATTRIBUTION_MODEL = "crm_source_auto";
const MAX_SCAN_ROWS = 5_000;

function sourceKey(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : "";
}

function sourceCampaignId(
  orgId: string,
  provider: CrmMarketingSourceProvider,
): string {
  return `mkt-crm-${crypto
    .createHash("sha256")
    .update(`${orgId}:${provider}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function normalizeCrmMarketingSource(
  opportunitySource: unknown,
  customerSource?: unknown,
): CrmMarketingSourceProvider | null {
  return (
    SOURCE_ALIASES[sourceKey(opportunitySource)] ||
    SOURCE_ALIASES[sourceKey(customerSource)] ||
    null
  );
}

export function isConfirmedMarketingWin(input: {
  stage: string;
  wonAt: Date | null;
}): boolean {
  return Boolean(
    input.wonAt ||
      ["signed", "producing", "installing", "completed"].includes(
        input.stage,
      ),
  );
}

export interface CrmSourceAttributionSyncResult {
  scannedCount: number;
  matchedCount: number;
  createdCount: number;
  refreshedCount: number;
  skippedManualCount: number;
  truncated: boolean;
  dryRun: boolean;
  byProvider: Array<{
    provider: CrmMarketingSourceProvider;
    label: string;
    matched: number;
    created: number;
    refreshed: number;
    attributedRevenue: number;
  }>;
}

export async function syncCrmSourceAttributions(input: {
  orgId: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  dryRun?: boolean;
}): Promise<CrmSourceAttributionSyncResult> {
  const [opportunities, economics] = await Promise.all([
    db.salesOpportunity.findMany({
      where: {
        orgId: input.orgId,
        createdAt: { gte: input.periodStart, lte: input.periodEnd },
        customer: { archivedAt: null },
      },
      select: {
        id: true,
        source: true,
        stage: true,
        estimatedValue: true,
        wonAt: true,
        customer: { select: { source: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_SCAN_ROWS + 1,
    }),
    db.marketingEconomicsSetting.findUnique({
      where: { orgId: input.orgId },
      select: { currency: true },
    }),
  ]);
  const currency = (economics?.currency || "CAD").slice(0, 3).toUpperCase();
  const truncated = opportunities.length > MAX_SCAN_ROWS;
  const scanned = opportunities.slice(0, MAX_SCAN_ROWS);
  const matched = scanned.flatMap((opportunity) => {
    const provider = normalizeCrmMarketingSource(
      opportunity.source,
      opportunity.customer.source,
    );
    return provider ? [{ ...opportunity, provider }] : [];
  });
  const opportunityIds = matched.map((row) => row.id);
  const existing = opportunityIds.length
    ? await db.marketingLeadAttribution.findMany({
        where: {
          orgId: input.orgId,
          salesOpportunityId: { in: opportunityIds },
        },
        select: {
          id: true,
          salesOpportunityId: true,
          attributionModel: true,
          campaignId: true,
        },
      })
    : [];
  const existingByOpportunity = new Map<
    string,
    (typeof existing)[number]
  >();
  for (const row of existing) {
    const current = existingByOpportunity.get(row.salesOpportunityId);
    if (
      !current ||
      (current.attributionModel === ATTRIBUTION_MODEL &&
        row.attributionModel !== ATTRIBUTION_MODEL)
    ) {
      existingByOpportunity.set(row.salesOpportunityId, row);
    }
  }

  const stats = new Map(
    CRM_MARKETING_SOURCE_PROVIDERS.map((provider) => [
      provider,
      {
        provider,
        label: PROVIDER_LABELS[provider],
        matched: 0,
        created: 0,
        refreshed: 0,
        attributedRevenue: 0,
      },
    ]),
  );
  let skippedManualCount = 0;
  for (const row of matched) {
    const providerStats = stats.get(row.provider)!;
    providerStats.matched += 1;
    if (isConfirmedMarketingWin(row)) {
      providerStats.attributedRevenue += Math.max(0, row.estimatedValue ?? 0);
    }
    const prior = existingByOpportunity.get(row.id);
    if (prior?.attributionModel === ATTRIBUTION_MODEL) {
      providerStats.refreshed += 1;
    } else if (prior) {
      skippedManualCount += 1;
    } else {
      providerStats.created += 1;
    }
  }

  if (!input.dryRun && matched.length > 0) {
    const campaigns = new Map<CrmMarketingSourceProvider, string>();
    for (const provider of CRM_MARKETING_SOURCE_PROVIDERS) {
      if (!matched.some((row) => row.provider === provider)) continue;
      const name = `[自动归总] ${PROVIDER_LABELS[provider]}`;
      const campaign = await db.marketingCampaign.upsert({
        where: { id: sourceCampaignId(input.orgId, provider) },
        create: {
          id: sourceCampaignId(input.orgId, provider),
          orgId: input.orgId,
          name,
          objective: "crm_source_attribution",
          primaryConversion: "closed_sale",
          // 这是归因账本桶，不是正在投放的活动；避免污染“活跃活动”决策。
          status: "completed",
          createdById: input.userId,
        },
        update: {
          name,
          status: "completed",
        },
        select: { id: true },
      });
      campaigns.set(provider, campaign.id);
    }

    for (const row of matched) {
      const prior = existingByOpportunity.get(row.id);
      const campaignId = campaigns.get(row.provider)!;
      const attributedRevenue = isConfirmedMarketingWin(row)
        ? Math.max(0, row.estimatedValue ?? 0)
        : null;
      if (prior?.attributionModel === ATTRIBUTION_MODEL) {
        await db.marketingLeadAttribution.update({
          where: { id: prior.id },
          data: {
            // CRM 来源被人工修正时，同步移动系统归因桶；人工归因仍不会被改写。
            campaignId,
            attributedRevenue,
            currency,
            confidence: 70,
            notes:
              "系统根据 CRM 客户/商机来源自动归总；如有更精确的 UTM 或人工归因，请以人工确认结果替代。",
          },
        });
        continue;
      }
      if (prior) continue;
      await db.marketingLeadAttribution.upsert({
        where: {
          orgId_campaignId_salesOpportunityId: {
            orgId: input.orgId,
            campaignId,
            salesOpportunityId: row.id,
          },
        },
        create: {
          orgId: input.orgId,
          campaignId,
          salesOpportunityId: row.id,
          attributionModel: ATTRIBUTION_MODEL,
          confidence: 70,
          attributedRevenue,
          currency,
          notes:
            "系统根据 CRM 客户/商机来源自动归总；如有更精确的 UTM 或人工归因，请以人工确认结果替代。",
          createdById: input.userId,
        },
        update: {
          attributedRevenue,
          currency,
          confidence: 70,
          notes:
            "系统根据 CRM 客户/商机来源自动归总；如有更精确的 UTM 或人工归因，请以人工确认结果替代。",
        },
      });
    }
  }

  return {
    scannedCount: scanned.length,
    matchedCount: matched.length,
    createdCount: [...stats.values()].reduce(
      (sum, row) => sum + row.created,
      0,
    ),
    refreshedCount: [...stats.values()].reduce(
      (sum, row) => sum + row.refreshed,
      0,
    ),
    skippedManualCount,
    truncated,
    dryRun: Boolean(input.dryRun),
    byProvider: [...stats.values()].filter((row) => row.matched > 0),
  };
}

export const CRM_SOURCE_ATTRIBUTION_MODEL = ATTRIBUTION_MODEL;
export const CRM_SOURCE_ATTRIBUTION_SCAN_LIMIT = MAX_SCAN_ROWS;
