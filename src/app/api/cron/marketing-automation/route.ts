import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { getActivepiecesReadiness, type MarketingFlowKey } from "@/lib/marketing/activepieces";
import {
  scheduledMarketingFlows,
  scheduledMarketingRequestId,
} from "@/lib/marketing/automation-schedule";
import { dispatchMarketingWorkflow } from "@/lib/marketing/workflows";
import type { AutomationKey } from "@/lib/automation/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AUTOMATION_KEY: Record<Exclude<MarketingFlowKey, "mmm-run">, AutomationKey> = {
  "sync-metrics": "marketing-channel-sync",
  "health-scan": "marketing-health",
  "daily-brief": "marketing-daily-brief",
  "experiment-review": "marketing-experiment-review",
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dueFlows = scheduledMarketingFlows(now);
  if (dueFlows.length === 0) {
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
  const orgIds = brandProfiles.map((profile) => profile.orgId);
  const organizations = orgIds.length
    ? await db.organization.findMany({
      where: { id: { in: orgIds }, status: "active" },
      select: { id: true, ownerId: true },
    })
    : [];

  const results = [];
  for (const flowKey of dueFlows) {
    if (!configuredFlows.has(flowKey)) {
      results.push({ flowKey, status: "skipped", reason: "Activepieces Webhook 未配置" });
      continue;
    }

    const flowResult = await runTrackedAutomation(AUTOMATION_KEY[flowKey], async () => {
      const orgResults = [];
      for (const organization of organizations) {
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
    organizationCount: organizations.length,
    results,
  });
}
