import { db } from "@/lib/db";

const METRIC_ALIASES: Record<string, string> = {
  qualified_lead: "qualifiedLeads",
  qualified_leads: "qualifiedLeads",
  appointment: "appointments",
  quote: "quotes",
  won_revenue: "revenue",
  win: "wins",
};

function metricField(value: string): string {
  return METRIC_ALIASES[value] || value;
}

function metricValue(row: Record<string, unknown>, field: string): number {
  const value = Number(row[field] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function reviewMarketingExperiments(input: { orgId: string; experimentId?: string | null }) {
  const experiments = await db.marketingExperiment.findMany({
    where: {
      orgId: input.orgId,
      ...(input.experimentId ? { id: input.experimentId } : { status: "running" }),
    },
    include: {
      campaign: {
        include: {
          assets: { select: { id: true, variantKey: true } },
          publications: { select: { id: true, contentAssetId: true, channel: true } },
        },
      },
    },
    take: 50,
  });
  const results = [];
  for (const experiment of experiments) {
    const publicationIds = experiment.campaign.publications.map((row) => row.id);
    const snapshots = publicationIds.length
      ? await db.marketingMetricSnapshot.findMany({ where: { orgId: input.orgId, publicationId: { in: publicationIds } } })
      : [];
    const variantByAsset = new Map(experiment.campaign.assets.map((row) => [row.id, row.variantKey || "unassigned"]));
    const variantByPublication = new Map(experiment.campaign.publications.map((row) => [row.id, variantByAsset.get(row.contentAssetId || "") || "unassigned"]));
    const primaryField = metricField(experiment.primaryMetric);
    const variants = new Map<string, { primary: number; impressions: number; views: number; qualifiedLeads: number; revenue: number; publications: number }>();
    for (const publication of experiment.campaign.publications) {
      const key = variantByPublication.get(publication.id) || "unassigned";
      const current = variants.get(key) ?? { primary: 0, impressions: 0, views: 0, qualifiedLeads: 0, revenue: 0, publications: 0 };
      current.publications += 1;
      variants.set(key, current);
    }
    for (const snapshot of snapshots) {
      const key = variantByPublication.get(snapshot.publicationId || "") || "unassigned";
      const current = variants.get(key) ?? { primary: 0, impressions: 0, views: 0, qualifiedLeads: 0, revenue: 0, publications: 0 };
      const raw = snapshot as unknown as Record<string, unknown>;
      current.primary += metricValue(raw, primaryField);
      current.impressions += snapshot.impressions;
      current.views += snapshot.views;
      current.qualifiedLeads += snapshot.qualifiedLeads;
      current.revenue += snapshot.revenue;
      variants.set(key, current);
    }
    const ranked = [...variants.entries()]
      .map(([variantKey, metrics]) => ({ variantKey, ...metrics }))
      .sort((a, b) => b.primary - a.primary);
    const enoughExposure = ranked.filter((row) => Math.max(row.impressions, row.views) >= 100).length >= 2;
    const enoughOutcome = ranked.reduce((sum, row) => sum + row.primary, 0) >= 5;
    results.push({
      experimentId: experiment.id,
      name: experiment.name,
      primaryMetric: experiment.primaryMetric,
      evidenceStatus: enoughExposure && enoughOutcome ? "directional_signal" : "insufficient_data",
      leadingVariantKey: enoughExposure && enoughOutcome ? ranked[0]?.variantKey ?? null : null,
      variants: ranked,
      warning: "社媒平台流量并非随机分配，领先结果只作为方向性信号；正式胜者仍需人工确认。",
    });
  }
  return { reviewedAt: new Date().toISOString(), experiments: results };
}
