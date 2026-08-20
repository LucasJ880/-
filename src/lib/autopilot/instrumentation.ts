/**
 * Autopilot observation projection + runtime capture hook.
 *
 * A1-P0: request path only enqueues a durable outbox envelope (or no-ops when
 * capture flag is off). Projection runs in the async processor.
 *
 * TELEMETRY_DURABILITY is CLOSED after Lucas Final Review 2.
 * CLOSED does not enable Production capture or processor.
 */

import { runtimeFromRunMetadata } from "@/lib/ai/runtime-context";
import { db } from "@/lib/db";
import { isAutopilotTelemetryCaptureEnabled } from "./flags";
import { mapAgentRunEventToAutopilot } from "./map-events";
import {
  mapDeterministicFailureType,
  mapDeterministicOutcome,
} from "./outcome";
import {
  enqueueAutopilotTelemetryOutbox,
  type AutopilotOutboxEnvelope,
} from "./outbox";
import { persistDeterministicEvaluation } from "./evaluate-persist";
import { persistLlmJudgeEvaluation } from "./evaluate-judge-persist";
import { shouldInvokeLlmJudge } from "./evaluate-judge";
import {
  appendAutopilotObservationEvent,
  upsertAutopilotObservation,
} from "./repository";
import { sanitizedErrorSummary } from "./projection";

export type ProjectAutopilotNoticeDeps = {
  persistDeterministicEvaluation?: typeof persistDeterministicEvaluation;
  persistLlmJudgeEvaluation?: typeof persistLlmJudgeEvaluation;
};

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
      agentEventId?: string;
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

export function noticeToOutboxEnvelope(
  notice: AutopilotRuntimeNotice,
): AutopilotOutboxEnvelope | null {
  if (notice.type === "event") {
    if (!notice.agentEventId) return null;
    return {
      orgId: notice.orgId,
      agentRunId: notice.runId,
      noticeType: "event",
      agentEventId: notice.agentEventId,
      sequence: notice.sequence ?? null,
      sourceEventType: notice.eventType,
    };
  }
  return {
    orgId: notice.orgId,
    agentRunId: notice.runId,
    noticeType: notice.type,
  };
}

/**
 * Processor 投影：从 canonical AgentRun 重建 overlay / event。
 * A1 Observe must finish before A2 Evaluate is attempted.
 * A2 persistence errors propagate to outbox retry; they must not
 * prevent A1 overlay/event writes that already committed.
 */
export async function projectAutopilotNotice(
  notice: AutopilotRuntimeNotice,
  deps: ProjectAutopilotNoticeDeps = {},
): Promise<void> {
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
    // Observation flags only. Do not pass humanOverride into outcome mapping
    // (that would look like A2 evaluation: override ≠ AI wrong).
  const failure = mapDeterministicFailureType(run.errorCode);

  const mapped =
    notice.type === "event"
      ? mapAgentRunEventToAutopilot(notice.eventType, notice.payload)
      : null;

  const overlay = await upsertAutopilotObservation({
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
    humanOverride: mapped?.eventType === "HUMAN_OVERRIDE" ? true : undefined,
    humanEdit: mapped?.eventType === "HUMAN_EDIT" ? true : undefined,
    reAskStatus: mapped?.eventType === "RE_ASK_SIGNAL" ? "CONFIRMED" : undefined,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    metadata: {
      runType: run.runType,
      status: run.status,
      model: run.model,
    },
  });

  if (notice.type === "event" && mapped) {
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

  const persistEvaluation =
    deps.persistDeterministicEvaluation ?? persistDeterministicEvaluation;
  await persistEvaluation({
    orgId: overlay.orgId,
    agentRunId: run.id,
    autopilotRunId: overlay.id,
    status: run.status,
    errorCode: run.errorCode,
    humanOverride: overlay.humanOverride,
    humanEdit: overlay.humanEdit,
    reAskStatus: overlay.reAskStatus,
    cancelled: run.status === "cancelled",
  });

  const persistJudge =
    deps.persistLlmJudgeEvaluation ?? persistLlmJudgeEvaluation;
  if (
    shouldInvokeLlmJudge({
      noticeType: notice.type,
      mappedEventType: mapped?.eventType,
    })
  ) {
    // Model/LLM failures are converted to LLM_JUDGE_UNAVAILABLE inside persist.
    // DB/infrastructure failures must propagate for outbox retry.
    await persistJudge({
      orgId: overlay.orgId,
      agentRunId: run.id,
      autopilotRunId: overlay.id,
      status: run.status,
      errorCode: run.errorCode,
      humanOverride: overlay.humanOverride,
      humanEdit: overlay.humanEdit,
      reAskStatus: overlay.reAskStatus,
    });
  }
}

/**
 * Runtime capture：flag 关闭立即返回，不碰 Outbox 表。
 * 同步 await envelope 写入；投影仍由 processor 异步完成。
 */
export async function notifyAutopilotRuntime(
  notice: AutopilotRuntimeNotice,
): Promise<void> {
  if (!isAutopilotTelemetryCaptureEnabled()) return;
  const envelope = noticeToOutboxEnvelope(notice);
  if (!envelope) return;
  await enqueueAutopilotTelemetryOutbox(db, envelope);
}
