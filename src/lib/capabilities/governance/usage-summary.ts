import { db } from "@/lib/db";
import { getUsageSummary } from "../usage/query";
import type { CapabilitiesAccessContext } from "../types";
import { ALL_QUOTA_METRICS } from "./defaults";
import { resolveEffectiveQuota } from "./resolve";
import { getQuotaCurrentUsage } from "./usage-counters";
export async function getGovernanceUsage(opts: {
  access: CapabilitiesAccessContext;
  workspaceId?: string | null;
}) {
  const cost = await getUsageSummary(opts.access);
  const metrics = await Promise.all(
    ALL_QUOTA_METRICS.map(async (metric) => {
      const effective = await resolveEffectiveQuota({
        orgId: opts.access.orgId,
        workspaceId: opts.workspaceId,
        metric,
      });
      const current = await getQuotaCurrentUsage({
        orgId: opts.access.orgId,
        workspaceId: opts.workspaceId,
        metric,
      });
      let level: "OK" | "WARNING" | "SOFT_LIMIT" | "HARD_LIMIT" = "OK";
      if (effective.hardLimit != null && current > effective.hardLimit) {
        level = "HARD_LIMIT";
      } else if (effective.softLimit != null && current > effective.softLimit) {
        level = "SOFT_LIMIT";
      } else if (
        effective.warningLimit != null &&
        current > effective.warningLimit
      ) {
        level = "WARNING";
      }
      const pct =
        effective.hardLimit && effective.hardLimit > 0
          ? Math.min(100, (current / effective.hardLimit) * 100)
          : 0;
      return {
        ...effective,
        metric,
        currentUsage: current,
        level,
        usagePercent: Math.round(pct * 10) / 10,
      };
    }),
  );

  const concurrent = await db.agentRun.count({
    where: {
      orgId: opts.access.orgId,
      status: { in: ["running", "claimed", "queued"] },
    },
  });

  return {
    orgId: opts.access.orgId,
    workspaceId: opts.workspaceId ?? null,
    monthAiCost: cost.monthTotal,
    last24hCost: cost.last24hTotal,
    byWorkspace: cost.byWorkspace,
    byModel: cost.byModel,
    byAgent: cost.byAgent,
    bySkill: cost.bySkill,
    concurrentRuns: concurrent,
    metrics,
    nearLimits: metrics.filter((m) => m.level !== "OK"),
  };
}
