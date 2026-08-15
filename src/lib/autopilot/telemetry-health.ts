/**
 * Autopilot A1-P0 telemetry health / CAPTURE_GAP diagnostics.
 * Lucas-only via service access. Not a full Observe dashboard.
 */

import { db } from "@/lib/db";
import {
  isAutopilotProcessorEnabled,
  isAutopilotTelemetryCaptureEnabled,
} from "./flags";

export type AutopilotTelemetryHealth = {
  captureEnabled: boolean;
  processorEnabled: boolean;
  schemaAvailable: boolean;
  pendingCount: number;
  processingCount: number;
  processedCount: number;
  deadCount: number;
  retryCount: number;
  oldestPendingAgeMs: number | null;
  canonicalEventCount: number;
  outboxEventCount: number;
  projectedEventCount: number;
  captureGap: number | null;
  captureGapNote: string;
};

const EMPTY: Omit<
  AutopilotTelemetryHealth,
  "captureEnabled" | "processorEnabled" | "schemaAvailable" | "captureGapNote"
> = {
  pendingCount: 0,
  processingCount: 0,
  processedCount: 0,
  deadCount: 0,
  retryCount: 0,
  oldestPendingAgeMs: null,
  canonicalEventCount: 0,
  outboxEventCount: 0,
  projectedEventCount: 0,
  captureGap: null,
};

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2021"
  );
}

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
  const now = Date.now();

  try {
    const [
      pendingCount,
      processingCount,
      processedCount,
      deadCount,
      retryCount,
      oldestPending,
      canonicalEventCount,
      outboxEventCount,
      projectedEventCount,
    ] = await Promise.all([
      db.autopilotTelemetryOutbox.count({
        where: { orgId, status: "pending" },
      }),
      db.autopilotTelemetryOutbox.count({
        where: { orgId, status: "processing" },
      }),
      db.autopilotTelemetryOutbox.count({
        where: { orgId, status: "processed" },
      }),
      db.autopilotTelemetryOutbox.count({
        where: { orgId, status: "dead" },
      }),
      db.autopilotTelemetryOutbox.count({
        where: {
          orgId,
          attemptCount: { gt: 0 },
          status: { in: ["pending", "processing"] },
        },
      }),
      db.autopilotTelemetryOutbox.findFirst({
        where: { orgId, status: "pending" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      db.agentRunEvent.count({ where: { orgId } }),
      db.autopilotTelemetryOutbox.count({
        where: { orgId, noticeType: "event" },
      }),
      db.autopilotRunEvent.count({ where: { orgId } }),
    ]);

    const gap = describeCaptureGap({
      captureEnabled,
      canonicalEventCount,
      outboxEventCount,
    });

    return {
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
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        captureEnabled,
        processorEnabled,
        schemaAvailable: false,
        ...EMPTY,
        captureGapNote: "Outbox schema 尚未出现在当前数据库（未 migrate）。",
      };
    }
    throw error;
  }
}
