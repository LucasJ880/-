import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { getActivepiecesReadiness, type MarketingFlowKey } from "@/lib/marketing/activepieces";
import {
  scheduledMarketingFlows,
  scheduledMarketingRequestId,
  isCrmAttributionSyncDue,
} from "@/lib/marketing/automation-schedule";
import { dispatchMarketingWorkflow } from "@/lib/marketing/workflows";
import type { AutomationKey } from "@/lib/automation/registry";
import { syncCrmSourceAttributions } from "@/lib/marketing/crm-source-attribution";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AUTOMATION_KEY: Record<Exclude<MarketingFlowKey, "mmm-run">, AutomationKey> = {
  "sync-metrics": "marketing-channel-sync",
  "health-scan": "marketing-health",
  "daily-brief": "marketing-daily-brief",
  "experiment-review": "marketing-experiment-review",
};

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const now = new Date();
  const dueFlows = scheduledMarketingFlows(now);
  const crmAttributionDue = isCrmAttributionSyncDue(now);
  if (dueFlows.length === 0 && !crmAttributionDue) {
    return NextResponse.json({ skipped: true, reason: "当前小时无到期营销自动流", checkedAt: now.toISOString() });
  }

  const readiness = getActivepiecesReadiness();
  const configuredFlows = new Set(
    readiness.flows.filter((flow) => flow.configured).map((flow) => flow.key),
  );
  const brandProfiles = await db.marketingBrandProfile.findMany({
    select: { orgId: true },
    distinct: ["orgId"],
  });
  const opportunityOrganizations = crmAttributionDue
    ? await db.salesOpportunity.groupBy({ by: ["orgId"] })
    : [];
  const flowOrgIds = brandProfiles.map((profile) => profile.orgId);
  const attributionOrgIds = opportunityOrganizations.map((row) => row.orgId);
  const [flowOrganizations, attributionOrganizations] = await Promise.all([
    flowOrgIds.length
      ? db.organization.findMany({
          where: { id: { in: flowOrgIds }, status: "active" },
          select: { id: true, ownerId: true },
        })
      : [],
    attributionOrgIds.length
      ? db.organization.findMany({
          where: { id: { in: attributionOrgIds }, status: "active" },
          select: { id: true, ownerId: true },
        })
      : [],
  ]);

  const results = [];
  if (crmAttributionDue) {
    const attributionResult = await runTrackedAutomation(
      "marketing-crm-attribution",
      async () => {
        const organizationResults = [];
        let failedCount = 0;
        for (const organization of attributionOrganizations) {
          try {
            const economics = await db.marketingEconomicsSetting.findUnique({
              where: { orgId: organization.id },
              select: { attributionWindowDays: true },
            });
            const periodStart = new Date(
              now.getTime() -
                Math.max(1, economics?.attributionWindowDays ?? 90) *
                  24 *
                  3600 *
                  1000,
            );
            organizationResults.push({
              orgId: organization.id,
              ...(await syncCrmSourceAttributions({
                orgId: organization.id,
                userId: organization.ownerId,
                periodStart,
                periodEnd: now,
              })),
            });
          } catch (error) {
            failedCount += 1;
            organizationResults.push({
              orgId: organization.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return {
          data: organizationResults,
          status: failedCount > 0 ? "partial" : "succeeded",
          processedCount: organizationResults.length,
          succeededCount: organizationResults.length - failedCount,
          failedCount,
        };
      },
    );
    results.push({
      flowKey: "crm-source-attribution",
      status: "completed",
      organizations: attributionResult,
    });
  }
  for (const flowKey of dueFlows) {
    if (!configuredFlows.has(flowKey)) {
      results.push({ flowKey, status: "skipped", reason: "Activepieces Webhook 未配置" });
      continue;
    }

    const flowResult = await runTrackedAutomation(AUTOMATION_KEY[flowKey], async () => {
      const orgResults = [];
      for (const organization of flowOrganizations) {
        try {
          const run = await dispatchMarketingWorkflow({
            orgId: organization.id,
            userId: organization.ownerId,
            flowKey,
            requestId: scheduledMarketingRequestId({
              orgId: organization.id,
              flowKey,
              now,
            }),
            data: { trigger: "schedule", scheduledAt: now.toISOString() },
          });
          await logAudit({
            userId: organization.ownerId,
            orgId: organization.id,
            action: "marketing_workflow_scheduled",
            targetType: "marketing_workflow_run",
            targetId: run.id,
            afterData: { flowKey, status: run.status },
            request,
          });
          orgResults.push({ orgId: organization.id, runId: run.id, status: run.status });
        } catch (error) {
          orgResults.push({
            orgId: organization.id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const failedCount = orgResults.filter((row) => row.status === "failed").length;
      return {
        data: orgResults,
        processedCount: orgResults.length,
        succeededCount: orgResults.length - failedCount,
        failedCount,
      };
    });
    results.push({ flowKey, status: "dispatched", organizations: flowResult });
  }

  return NextResponse.json({
    checkedAt: now.toISOString(),
    organizationCount: new Set([
      ...flowOrganizations.map((row) => row.id),
      ...attributionOrganizations.map((row) => row.id),
    ]).size,
    results,
  });
}
