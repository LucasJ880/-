/**
 * A1-P1 canonical runtime observation helpers.
 * Emit AgentRunEvent only — Autopilot mapping/outbox stay on appendAgentRunEvent.
 * Never persist prompt / tool args / retrieval chunks / credentials.
 */

import { randomUUID } from "crypto";
import { hashAutopilotContent, toContentRef } from "@/lib/autopilot/sanitize";
import { appendAgentRunEvent } from "./run";
import type { AgentRunEventType } from "./types";

export const RUNTIME_EVENT_SCHEMA_VERSION = 1;

export function newToolCallId(existing?: string | null): string {
  const s = existing?.trim();
  return s || `tool_${randomUUID()}`;
}

export function newModelCallId(existing?: string | null): string {
  const s = existing?.trim();
  return s || `model_${randomUUID()}`;
}

export function newRetrievalId(existing?: string | null): string {
  const s = existing?.trim();
  return s || `retrieval_${randomUUID()}`;
}

function withSchema(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION, ...(payload ?? {}) };
}

export async function emitObservedEvent(input: {
  orgId: string;
  runId: string;
  eventType: AgentRunEventType;
  title?: string;
  payload?: Record<string, unknown>;
  visibleToUser?: boolean;
}) {
  return appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: input.eventType,
    title: input.title,
    payload: withSchema(input.payload),
    visibleToUser: input.visibleToUser,
  });
}

export async function emitAgentOutputEvent(input: {
  orgId: string;
  runId: string;
  output: string;
  outputType?: string;
}) {
  const ref = toContentRef(input.output, `run:${input.runId}:output`);
  return emitObservedEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "agent.output",
    title: "Agent 输出已产生",
    visibleToUser: false,
    payload: {
      outputType: input.outputType ?? "text",
      outputRef: ref,
      bytes: ref?.bytes ?? 0,
      hash: ref?.hash ?? null,
    },
  });
}

export async function emitRetrievalLifecycle(input: {
  orgId: string;
  runId: string;
  retrievalId: string;
  phase: "started" | "completed" | "failed";
  retrievalType: string;
  queryHash?: string;
  resultCount?: number;
  sourceRefs?: string[];
  durationMs?: number;
  topScore?: number;
  errorCode?: string;
}) {
  const eventType: AgentRunEventType =
    input.phase === "started"
      ? "retrieval.started"
      : input.phase === "failed"
        ? "retrieval.failed"
        : "retrieval.completed";
  return emitObservedEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType,
    title:
      input.phase === "started"
        ? "检索开始"
        : input.phase === "failed"
          ? "检索失败"
          : "检索完成",
    visibleToUser: false,
    payload: {
      retrievalId: input.retrievalId,
      retrievalType: input.retrievalType,
      queryHash: input.queryHash ?? null,
      resultCount: input.resultCount ?? null,
      sourceRefs: input.sourceRefs ?? null,
      durationMs: input.durationMs ?? null,
      topScore: input.topScore ?? null,
      errorCode: input.errorCode ?? null,
    },
  });
}

export function hashQueryRef(query: string): string {
  return hashAutopilotContent(query.trim());
}

export async function emitModelLifecycle(input: {
  orgId: string;
  runId: string;
  modelCallId: string;
  phase: "started" | "completed" | "failed";
  provider?: string;
  model?: string;
  durationMs?: number;
  tokenUsage?: Record<string, unknown> | null;
  finishReason?: string | null;
  errorCode?: string;
}) {
  const eventType: AgentRunEventType =
    input.phase === "started"
      ? "model.started"
      : input.phase === "failed"
        ? "model.failed"
        : "model.completed";
  return emitObservedEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType,
    title:
      input.phase === "started"
        ? "模型调用开始"
        : input.phase === "failed"
          ? "模型调用失败"
          : "模型调用完成",
    visibleToUser: false,
    payload: {
      modelCallId: input.modelCallId,
      provider: input.provider ?? "openai",
      model: input.model ?? null,
      durationMs: input.durationMs ?? null,
      tokenUsage: input.tokenUsage ?? null,
      finishReason: input.finishReason ?? null,
      errorCode: input.errorCode ?? null,
    },
  });
}

/** Observe a retrieval that actually runs. No runId → no event (do not fake). */
export async function withObservedRetrieval<T>(input: {
  orgId: string;
  runId?: string | null;
  retrievalType: string;
  query: string;
  run: () => Promise<T>;
  resultCount: (result: T) => number;
  sourceRefs?: (result: T) => string[];
  topScore?: (result: T) => number | undefined;
}): Promise<T> {
  const runId = input.runId?.trim();
  if (!runId) return input.run();

  const retrievalId = newRetrievalId();
  const queryHash = hashQueryRef(input.query);
  const startedAt = Date.now();
  await emitRetrievalLifecycle({
    orgId: input.orgId,
    runId,
    retrievalId,
    phase: "started",
    retrievalType: input.retrievalType,
    queryHash,
  });
  try {
    const result = await input.run();
    const refs = input.sourceRefs?.(result) ?? [];
    const uniqueRefs = [...new Set(refs.filter(Boolean))].slice(0, 32);
    await emitRetrievalLifecycle({
      orgId: input.orgId,
      runId,
      retrievalId,
      phase: "completed",
      retrievalType: input.retrievalType,
      queryHash,
      resultCount: input.resultCount(result),
      sourceRefs: uniqueRefs,
      durationMs: Date.now() - startedAt,
      topScore: input.topScore?.(result),
    });
    return result;
  } catch (error) {
    await emitRetrievalLifecycle({
      orgId: input.orgId,
      runId,
      retrievalId,
      phase: "failed",
      retrievalType: input.retrievalType,
      queryHash,
      durationMs: Date.now() - startedAt,
      errorCode: "retrieval_failed",
    });
    throw error;
  }
}
