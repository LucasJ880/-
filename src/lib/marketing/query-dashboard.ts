import { db } from "@/lib/db";
import {
  buildMarketingDecisionQueue,
  buildMarketingFunnel,
  calculateGrowthExecution,
  calculateMarketPresence,
} from "./dashboard";

export async function getMarketingDashboard(orgId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const latestAudit = await db.marketingAuditRun.findFirst({
    where: { orgId, status: "completed" },
    include: { scores: true },
    orderBy: { completedAt: "desc" },
  });

  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const [profile, economicsSetting, findings, campaigns, runningExperiments, pendingContent, publications, metrics, unverifiedSnapshots, channelAccounts, attributions, plans, pendingTeamApprovals, pendingIntelTopics] = await Promise.all([
    db.marketingBrandProfile.findUnique({ where: { orgId }, select: { id: true, brandName: true, validationStatus: true, validationScore: true, validationIssues: true, updatedAt: true } }),
    db.marketingEconomicsSetting.findUnique({ where: { orgId } }),
    db.marketingFinding.findMany({ where: { orgId, status: { in: ["open", "tasked"] } }, orderBy: [{ createdAt: "desc" }], take: 100 }),
    db.marketingCampaign.findMany({ where: { orgId, status: { in: ["awaiting_approval", "active"] } }, select: { id: true, name: true, status: true, objective: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.marketingExperiment.count({ where: { orgId, status: "running" } }),
    db.marketingContentAsset.count({ where: { orgId, approvalStatus: { in: ["draft", "review"] } } }),
    db.marketingPublication.count({ where: { orgId, status: "published", publishedAt: { gte: monthStart } } }),
    db.marketingMetricSnapshot.aggregate({
      where: { orgId, capturedAt: { gte: monthStart } },
      _sum: {
        impressions: true,
        clicks: true,
        leads: true,
        qualifiedLeads: true,
        appointments: true,
        quotes: true,
        wins: true,
        revenue: true,
        spend: true,
        otherMarketingCost: true,
      },
      _max: { capturedAt: true },
      _count: true,
    }),
    db.marketingMetricSnapshot.count({
      where: {
        orgId,
        capturedAt: { gte: monthStart },
        dataQualityStatus: { not: "valid" },
      },
    }),
    db.marketingChannelAccount.findMany({
      where: { orgId },
      select: { status: true, lastSyncedAt: true },
    }),
    db.marketingLeadAttribution.findMany({ where: { orgId, createdAt: { gte: monthStart } }, select: { attributedRevenue: true, salesOpportunityId: true } }),
    db.marketingPlan.findMany({ where: { orgId, status: { in: ["awaiting_approval", "draft", "active"] } }, include: { items: { where: { status: { notIn: ["done", "completed", "canceled"] } }, orderBy: { dueDate: "asc" }, take: 8 } }, orderBy: { createdAt: "desc" }, take: 1 }),
    db.pendingAction.findMany({
      where: { orgId, type: "marketing.approve_research_plan", status: "pending", expiresAt: { gt: now } },
      select: {
        id: true,
        title: true,
        preview: true,
        createdAt: true,
        expiresAt: true,
        projectId: true,
        createdBy: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    db.contentPlanItem.count({
      where: {
        orgId,
        source: "intelligence",
        status: "proposed",
        createdAt: { gte: weekAgo },
      },
    }),
  ]);

  const attributedOpportunityIds = attributions.map((row) => row.salesOpportunityId);
  const crmOpportunities = attributedOpportunityIds.length > 0
    ? await db.salesOpportunity.findMany({
        where: {
          orgId,
          id: { in: attributedOpportunityIds },
          customer: { archivedAt: null },
        },
        select: { id: true, stage: true, estimatedValue: true, wonAt: true },
      })
    : [];
  const qualifiedStages = new Set(["needs_confirmed", "measure_booked", "quoted", "negotiation", "signed", "producing", "installing", "completed"]);
  const appointmentStages = new Set(["measure_booked", "quoted", "negotiation", "signed", "producing", "installing", "completed"]);
  const quoteStages = new Set(["quoted", "negotiation", "signed", "producing", "installing", "completed"]);
  const crmQualified = crmOpportunities.filter((row) => qualifiedStages.has(row.stage)).length;
  const crmAppointments = crmOpportunities.filter((row) => appointmentStages.has(row.stage)).length;
  const crmQuotes = crmOpportunities.filter((row) => quoteStages.has(row.stage)).length;
  const crmWins = crmOpportunities.filter((row) => row.wonAt || ["signed", "producing", "installing", "completed"].includes(row.stage)).length;
  const wonOpportunityIds = new Set(
    crmOpportunities
      .filter((row) => row.wonAt || ["signed", "producing", "installing", "completed"].includes(row.stage))
      .map((row) => row.id),
  );
  const attributedRevenue = attributions
    .filter((row) => wonOpportunityIds.has(row.salesOpportunityId))
    .reduce((sum, row) => sum + (row.attributedRevenue ?? 0), 0);
  const effectiveLeads = Math.max(metrics._sum.qualifiedLeads ?? 0, crmQualified);
  const wins = Math.max(metrics._sum.wins ?? 0, crmWins);
  const revenue = Math.max(metrics._sum.revenue ?? 0, attributedRevenue);
  const marketPresence = calculateMarketPresence(latestAudit?.scores ?? []);
  const highPriority = findings.filter((row) => row.severity === "critical" || row.severity === "high");
  const growthExecution = calculateGrowthExecution({ published: publications, experiments: runningExperiments, qualifiedLeads: effectiveLeads, wins, pendingReview: pendingContent });
  const funnel = buildMarketingFunnel({
    impressions: metrics._sum.impressions ?? 0,
    clicks: metrics._sum.clicks ?? 0,
    leads: Math.max(metrics._sum.leads ?? 0, crmOpportunities.length),
    qualifiedLeads: effectiveLeads,
    appointments: Math.max(metrics._sum.appointments ?? 0, crmAppointments),
    quotes: Math.max(metrics._sum.quotes ?? 0, crmQuotes),
    wins,
    spend: metrics._sum.spend ?? 0,
    otherMarketingCost: metrics._sum.otherMarketingCost ?? 0,
    revenue,
    grossMarginRate: economicsSetting?.defaultGrossMarginRate ?? null,
    targetRoas: economicsSetting?.targetRoas ?? null,
    targetRoi: economicsSetting?.targetRoi ?? null,
  });
  const activeCampaigns = campaigns.filter((row) => row.status === "active").length;
  const campaignsAwaitingApproval = campaigns.filter(
    (row) => row.status === "awaiting_approval",
  ).length;
  const recommendations = buildMarketingDecisionQueue({
    hasValidProfile: profile?.validationStatus === "valid",
    metricSnapshotCount: metrics._count,
    unverifiedSnapshotCount: unverifiedSnapshots,
    activeCampaigns,
    campaignsAwaitingApproval,
    runningExperiments,
    pendingApprovals: pendingTeamApprovals.length,
    funnel,
  });
  const syncedAt = channelAccounts
    .map((row) => row.lastSyncedAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    profile,
    summary: {
      marketPresence,
      growthExecution,
      effectiveLeads,
      revenue,
      currency: "CAD",
      runningExperiments,
      pendingContent,
      pendingIntelTopics,
      pendingTeamApprovals: pendingTeamApprovals.length,
      highPriorityIssues: highPriority.length,
      spend: metrics._sum.spend ?? 0,
    },
    funnel,
    measurement: {
      snapshotCount: metrics._count,
      unverifiedSnapshotCount: unverifiedSnapshots,
      channelAccountCount: channelAccounts.length,
      connectedChannelAccountCount: channelAccounts.filter((row) => row.status === "connected").length,
      latestDataAt: metrics._max.capturedAt,
      latestSyncAt: syncedAt,
      platformReportedLeads: metrics._sum.leads ?? 0,
      platformReportedRevenue: metrics._sum.revenue ?? 0,
      crmAttributedLeads: crmOpportunities.length,
      crmAttributedRevenue: attributedRevenue,
    },
    recommendations,
    latestAudit: latestAudit ? { id: latestAudit.id, totalScore: latestAudit.totalScore, confidence: latestAudit.confidence, completedAt: latestAudit.completedAt, dimensions: latestAudit.scores } : null,
    highPriorityFindings: highPriority.slice(0, 8),
    campaigns,
    pendingTeamApprovals: pendingTeamApprovals.map((row) => ({
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      projectId: row.projectId,
      requester: { id: row.createdBy.id, name: row.createdBy.name || row.createdBy.email },
      approver: row.approver ? { id: row.approver.id, name: row.approver.name || row.approver.email } : null,
    })),
    plan: plans[0] ?? null,
  };
}
