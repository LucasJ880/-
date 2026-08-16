/**
 * Lucas-only A1-P1 coverage diagnostics loader.
 * Recent runs only — not a dashboard, not employee scoring.
 *
 * Dark / observe-read-off: short-circuit BEFORE Autopilot table queries.
 */

import { db } from "@/lib/db";
import {
  isAutopilotProcessorEnabled,
  isAutopilotTelemetryCaptureEnabled,
} from "./flags";
import { classifyAgentRunEvent } from "./map-events";
import {
  summarizeCoverage,
  type CoverageSnapshot,
} from "./coverage";
import {
  isObserveTelemetryReadEnabled,
  noteAutopilotTableQuery,
} from "./observe-read-gate";

/** A1-P1/P3 coverage window. Observability health is not a 30-day full scan. */
export const AUTOPILOT_COVERAGE_RECENT_RUN_LIMIT = 20;

export const OBSERVE_HEALTH_SCOPE = {
  type: "RECENT_RUNS",
  runLimit: AUTOPILOT_COVERAGE_RECENT_RUN_LIMIT,
} as const;

export type ObserveHealthScope = typeof OBSERVE_HEALTH_SCOPE;

export type AutopilotEventCoverage = CoverageSnapshot & {
  observeReadEnabled: boolean;
  captureEnabled: boolean;
  processorEnabled: boolean;
  schemaAvailable: boolean;
  note: string;
};

const EMPTY: CoverageSnapshot = summarizeCoverage({
  runCount: 0,
  events: [],
  outboxEventCount: 0,
  projectedEventCount: 0,
  captureEnabled: false,
  classify: classifyAgentRunEvent,
});

export async function loadAutopilotEventCoverage(
  orgId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AutopilotEventCoverage> {
  const captureEnabled = isAutopilotTelemetryCaptureEnabled(env);
  const processorEnabled = isAutopilotProcessorEnabled(env);
  const observeReadEnabled = isObserveTelemetryReadEnabled(env);
  const note =
    "A1-P1 Coverage + A1-P2 Human Signals（最近 " +
    `${AUTOPILOT_COVERAGE_RECENT_RUN_LIMIT} 条 Run）。` +
    "观察人类对 AI 输出的明确动作，不是员工绩效，不是 AI 对错。";

  if (!observeReadEnabled) {
    return {
      ...EMPTY,
      observeReadEnabled: false,
      captureEnabled,
      processorEnabled,
      schemaAvailable: false,
      note: "Autopilot Observe is not active in this environment. Production telemetry is not active.",
    };
  }

  const runs = await db.agentRun.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: AUTOPILOT_COVERAGE_RECENT_RUN_LIMIT,
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  if (runIds.length === 0) {
    return {
      ...EMPTY,
      observeReadEnabled: true,
      captureEnabled,
      processorEnabled,
      schemaAvailable: true,
      note: `${note} ${EMPTY.runtimeCoverageGapNote}`,
    };
  }

  const events = await db.agentRunEvent.findMany({
    where: { orgId, runId: { in: runIds } },
    select: { runId: true, eventType: true, payload: true },
  });
  noteAutopilotTableQuery();
  const outboxEventCount = await db.autopilotTelemetryOutbox.count({
    where: {
      orgId,
      noticeType: "event",
      agentRunId: { in: runIds },
    },
  });
  noteAutopilotTableQuery();
  const projectedEventCount = await db.autopilotRunEvent.count({
    where: {
      orgId,
      run: { agentRunId: { in: runIds } },
    },
  });
  noteAutopilotTableQuery();
  const projectedUnknownCount = await db.autopilotRunEvent.count({
    where: {
      orgId,
      eventType: "UNKNOWN_EVENT",
      run: { agentRunId: { in: runIds } },
    },
  });
  noteAutopilotTableQuery();
  const projectedHumanSignalCount = await db.autopilotRunEvent.count({
    where: {
      orgId,
      eventType: { in: ["HUMAN_EDIT", "HUMAN_OVERRIDE", "RE_ASK_SIGNAL"] },
      run: { agentRunId: { in: runIds } },
    },
  });

  const snapshot = summarizeCoverage({
    runCount: runIds.length,
    events: events.map((e) => ({
      runId: e.runId,
      eventType: e.eventType,
      payload: e.payload,
    })),
    outboxEventCount,
    projectedEventCount,
    projectedMappedCount: Math.max(
      0,
      projectedEventCount - projectedUnknownCount,
    ),
    projectedUnknownCount,
    projectedHumanSignalCount,
    captureEnabled,
    classify: classifyAgentRunEvent,
  });

  return {
    ...snapshot,
    observeReadEnabled: true,
    captureEnabled,
    processorEnabled,
    schemaAvailable: true,
    note: `${note} ${snapshot.runtimeCoverageGapNote}`,
  };
}
