/**
 * Autopilot A0 instrumentation：best-effort / non-blocking。
 * Trace 写入失败不得让 Agent Runtime 失败。
 *
 * Durability (A0): fire-and-forget. Do not add an outbox/queue here.
 * A1 mandatory blocker: TELEMETRY_DURABILITY — serverless freeze can drop
 * Observe events; A1 must add durable persistence before Observe completeness.
 * See AUTOPILOT_A1_MANDATORY_BLOCKERS in ./types.
 */

import { runtimeFromRunMetadata } from "@/lib/ai/runtime-context";
import { isAutopilotInstrumentationEnabled } from "./flags";
import { mapAgentRunEventToAutopilot } from "./map-events";
import {
  mapDeterministicFailureType,
  mapDeterministicOutcome,
} from "./outcome";
import {
  appendAutopilotObservationEvent,
  upsertAutopilotObservation,
} from "./repository";
import { sanitizedErrorSummary } from "./projection";

export type AutopilotRuntimeNotice =
  | {
      type: "run_created" | "run_terminal";
      orgId: string;
      runId: string;
      userId?: string | null;
    }
  | {
      type: "event";
      orgId: string;
      runId: string;
      eventType: string;
      sequence?: number;
      payload?: Record<string, unknown> | null;
      timestamp?: Date;
    };

type PersistFn = (notice: AutopilotRuntimeNotice) => Promise<void>;

export function createAutopilotNotifier(opts: {
  enabled: boolean;
  persist: PersistFn;
  onError?: (error: unknown) => void;
}) {
  return function notifyAutopilot(notice: AutopilotRuntimeNotice): void {
    if (!opts.enabled) return;
    try {
      void opts.persist(notice).catch((error) => {
        opts.onError?.(error);
      });
    } catch (error) {
      opts.onError?.(error);
    }
  };
}

async function persistAutopilotNotice(
  notice: AutopilotRuntimeNotice,
): Promise<void> {
  const { db } = await import("@/lib/db");
  const run = await db.agentRun.findFirst({
    where: { id: notice.runId, orgId: notice.orgId },
    include: { session: { select: { userId: true } } },
  });
  if (!run) return;

  const runtime = runtimeFromRunMetadata(run);
  const userId =
    (notice.type !== "event" ? notice.userId : null) ??
    run.session?.userId ??
    runtime.actor?.userId ??
    null;
  const outcome = mapDeterministicOutcome({
    status: run.status,
    errorCode: run.errorCode,
  });
  const failure = mapDeterministicFailureType(run.errorCode);

  await upsertAutopilotObservation({
    agentRunId: run.id,
    orgId: run.orgId,
    userId,
    projectId: runtime.projectId ?? null,
    threadId: runtime.threadId ?? null,
    sessionId: run.sessionId,
    agentId: runtime.agent?.id ?? null,
    agentType: runtime.agent?.role ?? run.runType,
    agentVersion: run.runtimeVersion ?? null,
    intent: run.intent,
    outcome,
    failureType: failure?.failureType ?? null,
    failureSource: failure?.failureSource ?? null,
    latencyMs: run.latencyMs,
    errorCode: run.errorCode,
    errorSummary: sanitizedErrorSummary(run.errorMessage),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    metadata: {
      runType: run.runType,
      status: run.status,
      model: run.model,
    },
  });

  if (notice.type !== "event") return;

  const mapped = mapAgentRunEventToAutopilot(notice.eventType, notice.payload);
  if (!mapped) return;
  await appendAutopilotObservationEvent({
    orgId: notice.orgId,
    agentRunId: notice.runId,
    eventType: mapped.eventType,
    sequence: notice.sequence,
    timestamp: notice.timestamp ?? new Date(),
    durationMs: mapped.durationMs,
    payload: mapped.payload,
  });
}

const defaultNotifier = createAutopilotNotifier({
  enabled: true,
  persist: persistAutopilotNotice,
  onError: (error) => {
    console.error("[autopilot] telemetry failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  },
});

/** Runtime 调用点：flag 关闭时立即返回，不碰 DB。 */
export function notifyAutopilotRuntime(notice: AutopilotRuntimeNotice): void {
  if (!isAutopilotInstrumentationEnabled()) return;
  defaultNotifier(notice);
}
