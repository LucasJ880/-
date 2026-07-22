/**
 * 中台总览聚合 — 按 TenantContext.orgId，失败不伪造 0。
 */

import { db } from "@/lib/db";
import { listCapabilityRuns } from "@/lib/capabilities/runs/list";
import { getUsageSummary } from "@/lib/capabilities/usage/query";
import { getGovernanceUsage } from "@/lib/capabilities/governance/usage-summary";
import { assessConfigHealth } from "@/lib/capabilities/config-health/assess";
import { listCapabilityCatalog } from "@/lib/capabilities/catalog/list";
import { listCapabilityApprovals } from "@/lib/capabilities/approvals/query";
import type { CapabilitiesAccessContext } from "../types";

export type OverviewActionItem = {
  code: string;
  severity: "CRITICAL" | "ERROR" | "WARNING" | "INFO";
  title: string;
  count?: number;
  href: string;
};

export type CapabilitiesOverview = {
  orgId: string;
  orgName: string;
  metrics: {
    todayRuns: number | null;
    successRateToday: number | null;
    pendingApprovals: number | null;
    monthCost: number | null;
    currency: string;
    quotaLevel: string | null;
    configOverall: string | null;
  };
  metricsError?: string;
  actions: OverviewActionItem[];
  recentRuns: Array<{
    runId: string;
    label: string;
    status: string;
    workspaceId: string | null;
    durationMs: number | null;
    totalCost: number | null;
    startedAt: string | null;
  }>;
  capabilityCounts: {
    agents: number;
    skills: number;
    tools: number;
    workflows: number;
    knowledgeBases: number;
    industryPacks: number;
    workspaces: number;
  } | null;
};

export async function getCapabilitiesOverview(
  access: CapabilitiesAccessContext,
): Promise<CapabilitiesOverview> {
  const org = await db.organization.findUnique({
    where: { id: access.orgId },
    select: { id: true, name: true },
  });
  const orgName = org?.name ?? access.orgId;

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  let metricsError: string | undefined;
  let todayRuns: number | null = null;
  let successRateToday: number | null = null;
  let pendingApprovals: number | null = null;
  let monthCost: number | null = null;
  let currency = "USD";
  let quotaLevel: string | null = null;
  let configOverall: string | null = null;
  const actions: OverviewActionItem[] = [];
  let recentRuns: CapabilitiesOverview["recentRuns"] = [];
  /** catalog 失败时保持 null，页面展示「—」，不伪造 0 */
  let capabilityCounts: CapabilitiesOverview["capabilityCounts"] | null = null;

  try {
    const [
      runsToday,
      failedToday,
      runsRecent,
      usage,
      govUsage,
      health,
      catalog,
      wsCount,
      approvals,
    ] = await Promise.all([
      listCapabilityRuns(access, {
        from: startOfDay,
        to: new Date(),
        page: 1,
        pageSize: 1,
      }),
      listCapabilityRuns(access, {
        from: startOfDay,
        to: new Date(),
        hasError: true,
        page: 1,
        pageSize: 1,
      }),
      listCapabilityRuns(access, {
        from: new Date(Date.now() - 7 * 86400000),
        to: new Date(),
        page: 1,
        pageSize: 8,
      }),
      getUsageSummary(access).catch(() => null),
      getGovernanceUsage({ access, workspaceId: null }).catch(() => null),
      assessConfigHealth(access).catch(() => null),
      listCapabilityCatalog(access).catch(() => null),
      db.workspace.count({ where: { orgId: access.orgId, status: "active" } }),
      listCapabilityApprovals(access, {
        tab: "pending_mine",
        page: 1,
        pageSize: 1,
      }).catch(() => null),
    ]);

    todayRuns = runsToday.total;
    if (todayRuns > 0) {
      const failN = failedToday.total;
      successRateToday =
        Math.round(((todayRuns - failN) / todayRuns) * 1000) / 10;
    }

    pendingApprovals = approvals?.total ?? null;

    if (usage) {
      monthCost = usage.monthTotal;
      currency = usage.currency ?? "USD";
    }

    const costMetric = (
      govUsage as { metrics?: Array<{ metric: string; level: string }> } | null
    )?.metrics?.find((m) => m.metric === "MONTHLY_AI_COST");
    quotaLevel = costMetric?.level ?? null;

    if (health) {
      configOverall = health.overall;
      for (const issue of health.issues.slice(0, 8)) {
        if (issue.severity === "INFO" && issue.status === "HEALTHY") continue;
        actions.push({
          code: issue.code,
          severity: issue.severity,
          title: issue.title,
          href: issue.actionHref ?? "/capabilities/config-health",
        });
      }
    }

    if (failedToday.total > 0) {
      actions.push({
        code: "FAILED_RUNS",
        severity: "ERROR",
        title: "失败运行",
        count: failedToday.total,
        href: "/capabilities/runs?hasError=true",
      });
    }
    if ((pendingApprovals ?? 0) > 0) {
      actions.push({
        code: "PENDING_APPROVALS",
        severity: "WARNING",
        title: "待审批",
        count: pendingApprovals ?? 0,
        href: "/capabilities/approvals",
      });
    }
    if (quotaLevel === "SOFT_LIMIT" || quotaLevel === "WARNING") {
      actions.push({
        code: "QUOTA_SOFT",
        severity: quotaLevel === "SOFT_LIMIT" ? "WARNING" : "INFO",
        title:
          quotaLevel === "SOFT_LIMIT" ? "接近 / 达到软限额" : "配额预警",
        href: "/capabilities/governance",
      });
    }
    if (quotaLevel === "HARD_LIMIT") {
      actions.push({
        code: "QUOTA_HARD",
        severity: "CRITICAL",
        title: "配额 Hard Limit",
        href: "/capabilities/governance",
      });
    }

    const sevRank = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
    actions.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

    recentRuns = (runsRecent.items ?? []).map((r) => ({
      runId: r.runId,
      label: r.agentOrSkill || r.executionType || r.runId,
      status: r.status,
      workspaceId: r.workspaceId,
      durationMs: r.durationMs,
      totalCost: r.totalCost,
      startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
    }));

    if (catalog) {
      const c = catalog.items;
      capabilityCounts = {
        agents: c.filter((i) => i.type === "AGENT" && i.enabled).length,
        skills: c.filter((i) => i.type === "SKILL" && i.enabled).length,
        tools: c.filter((i) => i.type === "TOOL" && i.enabled).length,
        workflows: c.filter((i) => i.type === "WORKFLOW" && i.enabled).length,
        knowledgeBases: c.filter(
          (i) => i.type === "KNOWLEDGE_BASE" && i.enabled,
        ).length,
        industryPacks: c.filter(
          (i) => i.type === "INDUSTRY_PACK" && i.enabled,
        ).length,
        workspaces: wsCount,
      };
    }
  } catch (err) {
    metricsError = err instanceof Error ? err.message : "overview_load_failed";
  }

  return {
    orgId: access.orgId,
    orgName,
    metrics: {
      todayRuns,
      successRateToday,
      pendingApprovals,
      monthCost,
      currency,
      quotaLevel,
      configOverall,
    },
    metricsError,
    actions: actions.slice(0, 12),
    recentRuns,
    capabilityCounts,
  };
}
