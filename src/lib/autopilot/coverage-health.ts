/**
 * Lucas-only A1-P1 coverage diagnostics loader.
 * Recent runs only — not a dashboard, not employee scoring.
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

const RECENT_RUN_LIMIT = 20;

export type AutopilotEventCoverage = CoverageSnapshot & {
  captureEnabled: boolean;
  processorEnabled: boolean;
  schemaAvailable: boolean;
  note: string;
};

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2021"
  );
}

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
  const note =
    "A1-P1 Runtime Event Coverage（最近 20 条 Run）。监控 AI Runtime，不是员工绩效。";

  try {
    const runs = await db.agentRun.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: RECENT_RUN_LIMIT,
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    if (runIds.length === 0) {
      return {
        ...EMPTY,
        captureEnabled,
        processorEnabled,
        schemaAvailable: true,
        note,
      };
    }

    const [events, outboxEventCount, projectedEventCount] = await Promise.all([
      db.agentRunEvent.findMany({
        where: { orgId, runId: { in: runIds } },
        select: { runId: true, eventType: true, payload: true },
      }),
      db.autopilotTelemetryOutbox.count({
        where: {
          orgId,
          noticeType: "event",
          agentRunId: { in: runIds },
        },
      }),
      db.autopilotRunEvent.count({
        where: {
          orgId,
          run: { agentRunId: { in: runIds } },
        },
      }),
    ]);

    const snapshot = summarizeCoverage({
      runCount: runIds.length,
      events: events.map((e) => ({
        runId: e.runId,
        eventType: e.eventType,
        payload: e.payload,
      })),
      outboxEventCount,
      projectedEventCount,
      captureEnabled,
      classify: classifyAgentRunEvent,
    });

    return {
      ...snapshot,
      captureEnabled,
      processorEnabled,
      schemaAvailable: true,
      note,
    };
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        ...EMPTY,
        captureEnabled,
        processorEnabled,
        schemaAvailable: false,
        note,
      };
    }
    throw error;
  }
}
