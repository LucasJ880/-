/**
 * Autopilot 应用服务。所有读路径必须先经过 AutopilotAccess。
 * A1-P3 Observe Dashboard is read-only. Dark telemetry short-circuits
 * before Autopilot overlay / outbox table queries.
 */

import { assertAutopilotAccess } from "./access";
import {
  AUTOPILOT_DISABLED_CAPABILITIES,
  AUTOPILOT_EVALUATE_SURFACE,
  AUTOPILOT_MODE,
  AUTOPILOT_OBSERVE_SURFACE,
  AUTOPILOT_PHASE,
  type AutopilotAccessContext,
  type AutopilotCapability,
  type AutopilotOutcome,
} from "./types";
import { loadAutopilotTelemetryHealth } from "./telemetry-health";
import { loadAutopilotEventCoverage, OBSERVE_HEALTH_SCOPE } from "./coverage-health";
import {
  darkObserveState,
  isObserveTelemetryReadEnabled,
} from "./observe-read-gate";
import {
  listObserveRuns,
  loadObserveOverview,
  loadObserveRunDetail,
} from "./observe-query";
import { listEvaluateRows, loadEvaluateOverview } from "./evaluate-query";
import {
  parseObserveRange,
  type ObserveRange,
  type ObserveRunCursor,
  type ObserveRunStatus,
} from "./observe-range";
import type { AutopilotFlagEnv } from "./flags";

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

export async function getAutopilotOverview(
  actor: AutopilotActor,
  orgId: string,
  query: { range?: ObserveRange; env?: AutopilotFlagEnv; now?: Date } = {},
) {
  requireAccess(actor, orgId, "autopilot.view");
  const env = query.env ?? process.env;
  const range = query.range ?? parseObserveRange("7d");

  if (!isObserveTelemetryReadEnabled(env)) {
    return {
      phase: AUTOPILOT_PHASE,
      surface: AUTOPILOT_OBSERVE_SURFACE,
      infrastructureMode: AUTOPILOT_MODE,
      ...AUTOPILOT_DISABLED_CAPABILITIES,
      ...darkObserveState(env),
      healthScope: OBSERVE_HEALTH_SCOPE,
      range,
    };
  }

  const overview = await loadObserveOverview({
    orgId,
    range,
    env,
    now: query.now,
  });
  return {
    phase: AUTOPILOT_PHASE,
    surface: AUTOPILOT_OBSERVE_SURFACE,
    infrastructureMode: AUTOPILOT_MODE,
    ...AUTOPILOT_DISABLED_CAPABILITIES,
    ...overview,
  };
}

export async function listAutopilotRuns(
  actor: AutopilotActor,
  orgId: string,
  query: {
    limit?: number;
    cursor?: ObserveRunCursor | null;
    status?: ObserveRunStatus;
    runType?: string;
    agent?: string;
    domain?: string;
    hasToolFailure?: boolean;
    hasModelFailure?: boolean;
    hasRetrievalFailure?: boolean;
    hasHumanSignal?: boolean;
    hasObservabilityGap?: boolean;
    range?: ObserveRange;
    env?: AutopilotFlagEnv;
    now?: Date;
  } = {},
) {
  requireAccess(actor, orgId, "autopilot.runs.read");
  const env = query.env ?? process.env;
  if (!isObserveTelemetryReadEnabled(env)) {
    return {
      ...darkObserveState(env),
      items: [] as const,
      nextCursor: null,
    };
  }
  const { items, nextCursor } = await listObserveRuns({
    orgId,
    limit: query.limit ?? 25,
    cursor: query.cursor,
    status: query.status,
    runType: query.runType,
    agent: query.agent,
    domain: query.domain,
    hasToolFailure: query.hasToolFailure,
    hasModelFailure: query.hasModelFailure,
    hasRetrievalFailure: query.hasRetrievalFailure,
    hasHumanSignal: query.hasHumanSignal,
    hasObservabilityGap: query.hasObservabilityGap,
    range: query.range,
    now: query.now,
    env,
  });
  return { active: true as const, items, nextCursor };
}

export async function getAutopilotRun(
  actor: AutopilotActor,
  orgId: string,
  runId: string,
  query: { env?: AutopilotFlagEnv } = {},
) {
  requireAccess(actor, orgId, "autopilot.runs.read");
  const env = query.env ?? process.env;
  if (!isObserveTelemetryReadEnabled(env)) {
    return { ...darkObserveState(env), run: null };
  }
  const detail = await loadObserveRunDetail({ orgId, runId });
  if (!detail) return null;
  return detail;
}

export async function getAutopilotTelemetryHealth(
  actor: AutopilotActor,
  orgId: string,
) {
  requireAccess(actor, orgId, "autopilot.view");
  return loadAutopilotTelemetryHealth(orgId);
}

export async function getAutopilotEventCoverage(
  actor: AutopilotActor,
  orgId: string,
) {
  requireAccess(actor, orgId, "autopilot.view");
  return loadAutopilotEventCoverage(orgId);
}

export async function getAutopilotEvaluations(
  actor: AutopilotActor,
  orgId: string,
  query: {
    range?: ObserveRange;
    limit?: number;
    cursor?: ObserveRunCursor | null;
    outcome?: AutopilotOutcome;
    env?: AutopilotFlagEnv;
    now?: Date;
  } = {},
) {
  requireAccess(actor, orgId, "autopilot.view");
  const env = query.env ?? process.env;
  const range = query.range ?? parseObserveRange("7d");

  if (!isObserveTelemetryReadEnabled(env)) {
    return {
      phase: AUTOPILOT_PHASE,
      surface: AUTOPILOT_EVALUATE_SURFACE,
      infrastructureMode: AUTOPILOT_MODE,
      ...AUTOPILOT_DISABLED_CAPABILITIES,
      ...darkObserveState(env),
      evaluateState: "NOT_ACTIVE" as const,
      range,
      items: [] as const,
      nextCursor: null,
    };
  }

  const [overview, list] = await Promise.all([
    loadEvaluateOverview({ orgId, range, env, now: query.now }),
    listEvaluateRows({
      orgId,
      range,
      limit: query.limit ?? 25,
      cursor: query.cursor,
      outcome: query.outcome,
      env,
      now: query.now,
    }),
  ]);

  return {
    phase: AUTOPILOT_PHASE,
    infrastructureMode: AUTOPILOT_MODE,
    ...AUTOPILOT_DISABLED_CAPABILITIES,
    ...overview,
    items: list.items,
    nextCursor: list.nextCursor,
  };
}
