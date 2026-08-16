/**
 * A1-P1 runtime event coverage diagnostics (pure).
 * Structural gaps only — no AI quality / employee scoring.
 */

export const AUTOPILOT_EVENT_SCHEMA_VERSION = 1;

export type CoverageEvent = {
  eventType: string;
  payload?: unknown;
  runId?: string;
};

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function payloadId(payload: unknown, keys: string[]): string | null {
  const p = asRecord(payload);
  for (const key of keys) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type LifecycleOrphan = {
  id: string;
  started: number;
  terminals: number;
};

export function countLifecycleOrphans(
  events: CoverageEvent[],
  spec: {
    started: readonly string[];
    terminal: readonly string[];
    idKeys: readonly string[];
  },
): { orphans: LifecycleOrphan[]; orphanCount: number } {
  const started = new Map<string, number>();
  const terminals = new Map<string, number>();
  for (const event of events) {
    const id = payloadId(event.payload, spec.idKeys as string[]);
    if (!id) continue;
    if ((spec.started as readonly string[]).includes(event.eventType)) {
      started.set(id, (started.get(id) ?? 0) + 1);
    }
    if ((spec.terminal as readonly string[]).includes(event.eventType)) {
      terminals.set(id, (terminals.get(id) ?? 0) + 1);
    }
  }
  const orphans: LifecycleOrphan[] = [];
  for (const [id, n] of started) {
    const t = terminals.get(id) ?? 0;
    if (n !== 1 || t !== 1) {
      orphans.push({ id, started: n, terminals: t });
    }
  }
  for (const [id, t] of terminals) {
    if (!started.has(id) && t > 0) {
      orphans.push({ id, started: 0, terminals: t });
    }
  }
  return { orphans, orphanCount: orphans.length };
}

export const TOOL_LIFECYCLE = {
  started: ["tool.started"] as const,
  terminal: ["tool.completed", "tool.failed"] as const,
  idKeys: ["toolCallId"] as const,
};

export const MODEL_LIFECYCLE = {
  started: ["model.started", "response.started", "grader.started"] as const,
  terminal: [
    "model.completed",
    "model.failed",
    "response.completed",
    "response.failed",
    "grader.completed",
  ] as const,
  idKeys: ["modelCallId"] as const,
};

export const RETRIEVAL_LIFECYCLE = {
  started: ["retrieval.started"] as const,
  terminal: ["retrieval.completed", "retrieval.failed"] as const,
  idKeys: ["retrievalId"] as const,
};

export const CONTEXT_LIFECYCLE = {
  started: ["context.loading"] as const,
  terminal: ["context.loaded", "context.failed"] as const,
};

/** A1-P1 coverage metrics. Not AI quality / employee scoring. */
export const A1P1_COVERAGE_METRIC_KEYS = [
  "runsObserved",
  "canonicalEvents",
  "outboxEvents",
  "projectedEvents",
  "durableCaptureGap",
  "projectionGap",
  "runtimeCoverageGap",
  "toolStarted",
  "toolCompleted",
  "toolFailed",
  "toolOrphans",
  "modelStarted",
  "modelCompleted",
  "modelFailed",
  "modelOrphans",
  "retrievalStarted",
  "retrievalCompleted",
  "retrievalFailed",
  "retrievalOrphans",
  "unknownEventTypes",
] as const;

export function durableCaptureGap(input: {
  captureEnabled: boolean;
  canonicalEventCount: number;
  outboxEventCount: number;
}): number | null {
  if (!input.captureEnabled) return null;
  return Math.max(0, input.canonicalEventCount - input.outboxEventCount);
}

export function projectionGap(input: {
  mappedEventCount: number;
  projectedEventCount: number;
}): number {
  return Math.max(0, input.mappedEventCount - input.projectedEventCount);
}

export function runtimeCoverageGap(
  expectedTypes: readonly string[],
  actualTypes: readonly string[],
): { missing: string[]; gap: number } {
  const have = new Set(actualTypes);
  const missing = expectedTypes.filter((t) => !have.has(t));
  return { missing, gap: missing.length };
}

export type CoverageSnapshot = {
  runsObserved: number;
  canonicalEvents: number;
  outboxEvents: number;
  projectedEvents: number;
  mappedEvents: number;
  durableCaptureGap: number | null;
  projectionGap: number;
  runtimeCoverageGap: number | null;
  toolStarted: number;
  toolCompleted: number;
  toolFailed: number;
  toolOrphans: number;
  modelStarted: number;
  modelCompleted: number;
  modelFailed: number;
  modelOrphans: number;
  retrievalStarted: number;
  retrievalCompleted: number;
  retrievalFailed: number;
  retrievalOrphans: number;
  contextOrphans: number;
  unknownEventTypes: string[];
  unknownEventTypeCount: number;
};

function groupEventsByRun(events: CoverageEvent[]): CoverageEvent[][] {
  const groups = new Map<string, CoverageEvent[]>();
  for (const event of events) {
    const key = event.runId?.trim() || "__ungrouped";
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  return [...groups.values()];
}

function countUnpairedPhase(
  events: CoverageEvent[],
  spec: { started: readonly string[]; terminal: readonly string[] },
): number {
  let orphans = 0;
  for (const group of groupEventsByRun(events)) {
    const started = group.filter((e) =>
      (spec.started as readonly string[]).includes(e.eventType),
    ).length;
    const terminals = group.filter((e) =>
      (spec.terminal as readonly string[]).includes(e.eventType),
    ).length;
    if (started > terminals) orphans += started - terminals;
  }
  return orphans;
}

export function summarizeCoverage(input: {
  runCount: number;
  events: CoverageEvent[];
  outboxEventCount: number;
  projectedEventCount: number;
  captureEnabled: boolean;
  classify: (eventType: string) => "mapped" | "internal" | "unknown";
  mapToCanonical?: (eventType: string, payload?: unknown) => string | null;
}): CoverageSnapshot {
  const mappedEvents = input.events.filter(
    (e) => input.classify(e.eventType) === "mapped",
  ).length;
  const unknownTypes = [
    ...new Set(
      input.events
        .filter((e) => input.classify(e.eventType) === "unknown")
        .map((e) => e.eventType),
    ),
  ].sort();
  const count = (types: readonly string[]) =>
    input.events.filter((e) => (types as readonly string[]).includes(e.eventType))
      .length;
  const toolFailedExplicit = count(["tool.failed"]);
  const toolCompletedFail = input.events.filter(
    (e) =>
      e.eventType === "tool.completed" && asRecord(e.payload).ok === false,
  ).length;
  return {
    runsObserved: input.runCount,
    canonicalEvents: input.events.length,
    outboxEvents: input.outboxEventCount,
    projectedEvents: input.projectedEventCount,
    mappedEvents,
    durableCaptureGap: durableCaptureGap({
      captureEnabled: input.captureEnabled,
      canonicalEventCount: input.events.length,
      outboxEventCount: input.outboxEventCount,
    }),
    projectionGap: projectionGap({
      mappedEventCount: mappedEvents,
      projectedEventCount: input.projectedEventCount,
    }),
    runtimeCoverageGap: null,
    toolStarted: count(TOOL_LIFECYCLE.started),
    toolCompleted: count(["tool.completed"]) - toolCompletedFail,
    toolFailed: toolFailedExplicit + toolCompletedFail,
    toolOrphans: countLifecycleOrphans(input.events, TOOL_LIFECYCLE).orphanCount,
    modelStarted: count(MODEL_LIFECYCLE.started),
    modelCompleted: count([
      "model.completed",
      "response.completed",
      "grader.completed",
    ]),
    modelFailed: count(["model.failed", "response.failed"]),
    modelOrphans: countLifecycleOrphans(input.events, MODEL_LIFECYCLE)
      .orphanCount,
    retrievalStarted: count(RETRIEVAL_LIFECYCLE.started),
    retrievalCompleted: count(["retrieval.completed"]),
    retrievalFailed: count(["retrieval.failed"]),
    retrievalOrphans: countLifecycleOrphans(input.events, RETRIEVAL_LIFECYCLE)
      .orphanCount,
    contextOrphans: countUnpairedPhase(input.events, CONTEXT_LIFECYCLE),
    unknownEventTypes: unknownTypes,
    unknownEventTypeCount: unknownTypes.length,
  };
}
