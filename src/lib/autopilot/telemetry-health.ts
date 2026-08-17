/**
 * Autopilot A1-P0 telemetry health / CAPTURE_GAP diagnostics.
 * Lucas-only via service access. Not a full Observe dashboard.
 *
 * Dark / observe-read-off: short-circuit BEFORE Autopilot table queries.
 * Catching a missing-table database error is not the safety strategy.
 */

import { db } from "@/lib/db";
import {
  isAutopilotProcessorEnabled,
  isAutopilotTelemetryCaptureEnabled,
} from "./flags";
import {
  isObserveTelemetryReadEnabled,
  noteAutopilotTableQuery,
} from "./observe-read-gate";

export type AutopilotTelemetryHealth = {
  observeReadEnabled: boolean;
  captureEnabled: boolean;
  processorEnabled: boolean;
  schemaAvailable: boolean;
  pendingCount: number | null;
  processingCount: number | null;
  processedCount: number | null;
  deadCount: number | null;
  retryCount: number | null;
  oldestPendingAgeMs: number | null;
  canonicalEventCount: number | null;
  outboxEventCount: number | null;
  projectedEventCount: number | null;
  captureGap: number | null;
  captureGapNote: string;
};

export function describeCaptureGap(input: {
  captureEnabled: boolean;
  canonicalEventCount: number;
  outboxEventCount: number;
}): { captureGap: number | null; captureGapNote: string } {
  if (!input.captureEnabled) {
    return {
      captureGap: null,
      captureGapNote:
        "CAPTURE OFF：不写 outbox。canonical AgentRunEvent 与 outbox 差额不视为丢失。",
    };
  }
  const gap = Math.max(0, input.canonicalEventCount - input.outboxEventCount);
  return {
    captureGap: gap,
    captureGapNote:
      "CAPTURE_GAP = canonical AgentRunEvent count − outbox event envelope count（按 org 估计；projection 另计 mapped events）。",
  };
}

export async function loadAutopilotTelemetryHealth(
  orgId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AutopilotTelemetryHealth> {
  const captureEnabled = isAutopilotTelemetryCaptureEnabled(env);
  const processorEnabled = isAutopilotProcessorEnabled(env);
  const observeReadEnabled = isObserveTelemetryReadEnabled(env);

  if (!observeReadEnabled) {
    return {
      observeReadEnabled: false,
      captureEnabled,
      processorEnabled,
      schemaAvailable: false,
      pendingCount: null,
      processingCount: null,
      processedCount: null,
      deadCount: null,
      retryCount: null,
      oldestPendingAgeMs: null,
      canonicalEventCount: null,
      outboxEventCount: null,
      projectedEventCount: null,
      captureGap: null,
      captureGapNote:
        "Autopilot Observe is not active in this environment. Production telemetry is not active.",
    };
  }

  const now = Date.now();
  noteAutopilotTableQuery();
  const pendingCount = await db.autopilotTelemetryOutbox.count({
    where: { orgId, status: "pending" },
  });
  noteAutopilotTableQuery();
  const processingCount = await db.autopilotTelemetryOutbox.count({
    where: { orgId, status: "processing" },
  });
  noteAutopilotTableQuery();
  const processedCount = await db.autopilotTelemetryOutbox.count({
    where: { orgId, status: "processed" },
  });
  noteAutopilotTableQuery();
  const deadCount = await db.autopilotTelemetryOutbox.count({
    where: { orgId, status: "dead" },
  });
  noteAutopilotTableQuery();
  const retryCount = await db.autopilotTelemetryOutbox.count({
    where: {
      orgId,
      attemptCount: { gt: 0 },
      status: { in: ["pending", "processing"] },
    },
  });
  noteAutopilotTableQuery();
  const oldestPending = await db.autopilotTelemetryOutbox.findFirst({
    where: { orgId, status: "pending" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const canonicalEventCount = await db.agentRunEvent.count({ where: { orgId } });
  noteAutopilotTableQuery();
  const outboxEventCount = await db.autopilotTelemetryOutbox.count({
    where: { orgId, noticeType: "event" },
  });
  noteAutopilotTableQuery();
  const projectedEventCount = await db.autopilotRunEvent.count({
    where: { orgId },
  });

  const gap = describeCaptureGap({
    captureEnabled,
    canonicalEventCount,
    outboxEventCount,
  });

  return {
    observeReadEnabled: true,
    captureEnabled,
    processorEnabled,
    schemaAvailable: true,
    pendingCount,
    processingCount,
    processedCount,
    deadCount,
    retryCount,
    oldestPendingAgeMs: oldestPending
      ? Math.max(0, now - oldestPending.createdAt.getTime())
      : null,
    canonicalEventCount,
    outboxEventCount,
    projectedEventCount,
    ...gap,
  };
}
