import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const MARKETING_COUNT_FIELDS = [
  "impressions",
  "views",
  "engagements",
  "clicks",
  "leads",
  "qualifiedLeads",
  "appointments",
  "quotes",
  "wins",
] as const;

function nonNegativeCount(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function nonNegativeMoney(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function optionalString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function parseDate(value: unknown, fallback?: Date): Date | null {
  if (!value && fallback) return fallback;
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function validateMarketingMetricReferences(input: {
  orgId: string;
  channelAccountId?: string | null;
  campaignId?: string | null;
  publicationId?: string | null;
}) {
  const [account, campaign, publication] = await Promise.all([
    input.channelAccountId
      ? db.marketingChannelAccount.findFirst({ where: { id: input.channelAccountId, orgId: input.orgId }, select: { id: true } })
      : null,
    input.campaignId
      ? db.marketingCampaign.findFirst({ where: { id: input.campaignId, orgId: input.orgId }, select: { id: true } })
      : null,
    input.publicationId
      ? db.marketingPublication.findFirst({ where: { id: input.publicationId, orgId: input.orgId }, select: { id: true, campaignId: true } })
      : null,
  ]);
  if (input.channelAccountId && !account) throw new Error("渠道账号不存在或跨组织");
  if (input.campaignId && !campaign) throw new Error("营销活动不存在或跨组织");
  if (input.publicationId && !publication) throw new Error("发布记录不存在或跨组织");
  if (input.campaignId && publication && publication.campaignId !== input.campaignId) {
    throw new Error("发布记录与营销活动不匹配");
  }
}

export async function writeMarketingMetricSnapshot(input: {
  orgId: string;
  userId: string;
  source: string;
  ingestionKey?: string | null;
  externalEventId?: string | null;
  values: Record<string, unknown>;
}) {
  const channelAccountId = optionalString(input.values.channelAccountId);
  const campaignId = optionalString(input.values.campaignId);
  const publicationId = optionalString(input.values.publicationId);
  await validateMarketingMetricReferences({
    orgId: input.orgId,
    channelAccountId,
    campaignId,
    publicationId,
  });

  const capturedAt = parseDate(input.values.capturedAt, new Date());
  if (!capturedAt) throw new Error("capturedAt 无效");
  const periodStart = parseDate(input.values.periodStart);
  const periodEnd = parseDate(input.values.periodEnd);
  if (input.values.periodStart && !periodStart) throw new Error("periodStart 无效");
  if (input.values.periodEnd && !periodEnd) throw new Error("periodEnd 无效");
  if (periodStart && periodEnd && periodEnd < periodStart) throw new Error("periodEnd 不能早于 periodStart");

  const counts = Object.fromEntries(
    MARKETING_COUNT_FIELDS.map((field) => [field, nonNegativeCount(input.values[field])]),
  ) as Record<(typeof MARKETING_COUNT_FIELDS)[number], number>;
  const currency = (optionalString(input.values.currency, 3) || "CAD").toUpperCase();
  const baseCurrency = (optionalString(input.values.baseCurrency, 3) || currency).toUpperCase();
  const source = input.source.trim().slice(0, 100) || "manual";
  const ingestionKey = optionalString(input.ingestionKey, 300);
  const data = {
    orgId: input.orgId,
    source,
    channelAccountId,
    campaignId,
    publicationId,
    capturedAt,
    periodStart,
    periodEnd,
    granularity: optionalString(input.values.granularity, 30) || "snapshot",
    geography: optionalString(input.values.geography),
    productCategory: optionalString(input.values.productCategory),
    objective: optionalString(input.values.objective),
    ...counts,
    spend: nonNegativeMoney(input.values.spend),
    revenue: nonNegativeMoney(input.values.revenue),
    currency,
    baseCurrency,
    ingestionKey,
    externalEventId: optionalString(input.externalEventId, 300),
    dataQualityStatus: optionalString(input.values.dataQualityStatus, 30) || (source === "manual" ? "unverified" : "valid"),
    rawJson: jsonValue(input.values.raw),
    createdById: input.userId,
  };

  if (!ingestionKey) return db.marketingMetricSnapshot.create({ data });
  return db.marketingMetricSnapshot.upsert({
    where: { orgId_source_ingestionKey: { orgId: input.orgId, source, ingestionKey } },
    create: data,
    update: {
      ...data,
      orgId: undefined,
      source: undefined,
      ingestionKey: undefined,
      createdById: undefined,
    },
  });
}
