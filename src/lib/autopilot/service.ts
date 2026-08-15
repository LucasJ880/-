/**
 * Autopilot 应用服务。所有读路径必须先经过 AutopilotAccess。
 */

import { assertAutopilotAccess } from "./access";
import {
  AUTOPILOT_DISABLED_CAPABILITIES,
  AUTOPILOT_MODE,
  AUTOPILOT_PHASE,
  type AutopilotAccessContext,
  type AutopilotCapability,
  type AutopilotMetricAvailability,
} from "./types";
import { projectAutopilotRunDetail, projectAutopilotRunListItem } from "./projection";
import {
  averageLatencySince,
  countRunsSince,
  countToolFailuresSince,
  getAgentRunForAutopilot,
  listAgentRunsForAutopilot,
  listPendingActionsForRun,
  type AutopilotListQuery,
} from "./repository";

export type AutopilotActor = {
  id: string;
  role?: string | null;
};

function requireAccess(
  actor: AutopilotActor,
  orgId: string,
  capability: AutopilotCapability,
): AutopilotAccessContext {
  assertAutopilotAccess(actor, capability);
  return {
    userId: actor.id,
    role: actor.role ?? "",
    orgId,
    capability,
  };
}

function unavailable(): AutopilotMetricAvailability {
  return { available: false, reason: "DATA NOT AVAILABLE YET" };
}

function available(value: number): AutopilotMetricAvailability {
  return { available: true, value };
}

export async function getAutopilotOverview(
  actor: AutopilotActor,
  orgId: string,
) {
  requireAccess(actor, orgId, "autopilot.view");

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [today, last7Days, toolFailures, avgLatency] = await Promise.all([
    countRunsSince(orgId, startOfToday),
    countRunsSince(orgId, last7),
    countToolFailuresSince(orgId, last7),
    averageLatencySince(orgId, last7),
  ]);

  return {
    phase: AUTOPILOT_PHASE,
    mode: AUTOPILOT_MODE,
    ...AUTOPILOT_DISABLED_CAPABILITIES,
    orgId,
    metrics: {
      runCountToday: available(today),
      runCountLast7Days: available(last7Days),
      toolFailureCountLast7Days: available(toolFailures),
      avgLatencyMsLast7Days:
        avgLatency == null ? unavailable() : available(Math.round(avgLatency)),
      taskSuccessRate: unavailable(),
      partialSuccessRate: unavailable(),
      failureRate: unavailable(),
      humanOverrideRate: unavailable(),
      humanEditRate: unavailable(),
      reAskRate: unavailable(),
      toolFailureRate: unavailable(),
      retrievalFailureRate: unavailable(),
      p50Latency: unavailable(),
      p95Latency: unavailable(),
      tokenUsage: unavailable(),
      estimatedCost: unavailable(),
    },
  };
}

export async function listAutopilotRuns(
  actor: AutopilotActor,
  orgId: string,
  query: AutopilotListQuery = {},
) {
  requireAccess(actor, orgId, "autopilot.runs.read");
  const { total, page, pageSize, rows } = await listAgentRunsForAutopilot(
    orgId,
    query,
  );
  const items = rows.map((row) =>
    projectAutopilotRunListItem({
      run: row,
      overlay: row.autopilotRun,
      toolCallCount: row.events.filter((e) => e.eventType === "tool.started")
        .length,
      humanOverride: row.autopilotRun?.humanOverride === true,
    }),
  );
  return { total, page, pageSize, items };
}

export async function getAutopilotRun(
  actor: AutopilotActor,
  orgId: string,
  runId: string,
) {
  requireAccess(actor, orgId, "autopilot.runs.read");
  const row = await getAgentRunForAutopilot(orgId, runId);
  if (!row) return null;
  const pending = await listPendingActionsForRun(orgId, runId);
  return projectAutopilotRunDetail({
    run: row,
    events: row.events,
    pendingActions: pending,
    overlay: row.autopilotRun,
  });
}
