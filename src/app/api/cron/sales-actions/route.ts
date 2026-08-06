import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { syncSalesAutoActions } from "@/lib/sales/auto-action-sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("sales-action-sync", async () => {
    const [opportunityOrganizations, actionOrganizations] = await Promise.all([
      db.salesOpportunity.groupBy({
        by: ["orgId"],
        where: { stage: { in: ["new_lead", "needs_confirmed", "measure_booked", "quoted", "negotiation"] } },
      }),
      db.salesAction.groupBy({
        by: ["orgId"],
        where: { source: "digital_employee_auto", status: { in: ["open", "in_progress"] } },
      }),
    ]);
    // 仍有自动行动的企业也必须扫描，否则商机签约后旧提醒无法自动收口。
    const orgIds = new Set([
      ...opportunityOrganizations.map((organization) => organization.orgId),
      ...actionOrganizations.map((organization) => organization.orgId),
    ]);
    const results: Array<Record<string, unknown>> = [];
    let failedCount = 0;
    for (const orgId of orgIds) {
      try {
        results.push({ orgId, ...(await syncSalesAutoActions(orgId, "cron")) });
      } catch (error) {
        failedCount += 1;
        results.push({ orgId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      data: { organizations: results.length, failedCount, results },
      status: failedCount > 0 ? "partial" : "succeeded",
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
      metadata: { organizations: results.length, failedCount },
    };
  });
  return NextResponse.json({ syncedAt: new Date().toISOString(), ...data });
}
