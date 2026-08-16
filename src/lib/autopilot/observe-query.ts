/**
 * Bounded Observe Dashboard queries. Read-only. Org-scoped.
 *
 * Query budget (Observe ON):
 *  1. AgentRun date_trunc + status aggregate (counts + run trend)
 *  2. AgentRun latency aggregate
 *  3. AgentRunEvent groupBy eventType
 *  4. AgentRunEvent date_trunc human-signal trend
 *  5. last observed AgentRunEvent
 *  6. loadAutopilotEventCoverage (existing A1-P1/P2 source of truth, recent 20 runs)
 *  7. outbox status groupBy + oldest pending + last projected
 *
 * Coverage/health reuse existing services instead of a new summary table.
 * That can exceed 8 Prisma round-trips; documented rather than materialized.
 *
 * Autopilot overlay / outbox tables are queried only when the read gate is on.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  summarizeCoverage,
  type CoverageEvent,
} from "./coverage";
import {
  loadAutopilotEventCoverage,
  OBSERVE_HEALTH_SCOPE,
  type ObserveHealthScope,
} from "./coverage-health";
import {
  isAutopilotProcessorEnabled,
  isAutopilotTelemetryCaptureEnabled,
  type AutopilotFlagEnv,
} from "./flags";
import {
  HUMAN_EDIT_SOURCES,
  HUMAN_OVERRIDE_SOURCES,
  HUMAN_SIGNAL_PROJECTED_TYPES,
  RE_ASK_SOURCES,
} from "./human-signals";
import { classifyAgentRunEvent, mapAgentRunEventToAutopilot } from "./map-events";
import { observabilityHealthState } from "./observe-health";
import {
  extractObserveRunIdentity,
  formatObserveAgentLabel,
} from "./observe-identity";
import {
  isObserveRunIntegrityIssue,
  perRunObservabilityHealth,
  type ObserveRunHealth,
} from "./observe-run-health";
import { AUTOMATIC_RECONCILER_TRIGGER } from "./reconcile-cursor";
import {
  ACTIVATION_WATERMARK,
  isObserveTelemetryReadEnabled,
  noteAutopilotTableQuery,
} from "./observe-read-gate";
import {
  encodeObserveCursor,
  MAX_RUN_PAGE_SIZE,
  observeWindow,
  utcBucketStart,
  type ObserveRange,
  type ObserveRunCursor,
  type ObserveRunStatus,
} from "./observe-range";
import {
  isTerminalObserveEvent,
  observeEventCategory,
  terminalInvariant,
  timelineSafeSummary,
  type ObserveEventCategory,
} from "./observe-timeline";
import { redactPersistedErrorText, safePersistedErrorCode, sanitizeAutopilotPayload } from "./sanitize";

const HUMAN_SOURCE_TYPES = [
  ...HUMAN_EDIT_SOURCES,
  ...HUMAN_OVERRIDE_SOURCES,
  ...RE_ASK_SOURCES,
] as string[];

export const MAX_TIMELINE_EVENTS = 400;
const GAP_FILTER_MAX_CANDIDATE_PAGES = 4;

const TERMINAL_SOURCE_TYPES = [
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "job.completed",
  "job.failed",
] as const;

export type ObserveTrendPoint = {
  bucket: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  humanEdit: number;
  humanOverride: number;
  reAsk: number;
};

export type ObserveOverviewData = {
  active: true;
  observeState: ReturnType<typeof observabilityHealthState>;
  mode: "OBSERVE";
  capture: "ON" | "OFF";
  processor: "ON" | "OFF";
  productionActivation: "OFF";
  productionTelemetryActive: boolean;
  range: ObserveRange;
  runsObserved: number;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  awaitingHumanRuns: number;
  avgLatencyMs: number | null;
  toolCallCount: number;
  modelCallCount: number;
  retrievalCount: number;
  toolFailureCount: number;
  modelFailureCount: number;
  retrievalFailureCount: number;
  humanEditCount: number;
  humanOverrideCount: number;
  reAskCount: number;
  durableCaptureGap: number | null;
  projectionGap: number | null;
  humanSignalProjectionGap: number | null;
  toolOrphans: number | null;
  modelOrphans: number | null;
  retrievalOrphans: number | null;
  unknownEventTypeCount: number | null;
  unlinkedHumanSignalCount: number | null;
  deadLetterCount: number | null;
  outboxPending: number | null;
  oldestPendingAgeMs: number | null;
  lastObservedEventAt: string | null;
  lastProjectedEventAt: string | null;
  processorLastActivityAt: string | null;
  coverageUnavailable: boolean;
  projectionBehind: boolean;
  healthScope: ObserveHealthScope;
  trend: ObserveTrendPoint[];
  reconciler: typeof AUTOMATIC_RECONCILER_TRIGGER;
  activationWatermark: typeof ACTIVATION_WATERMARK;
  queryCount: number;
};

export type ObserveRunListItem = {
  runId: string;
  startedAt: string;
  runType: string;
  model: string | null;
  agentId: string | null;
  agentRole: string | null;
  workDomain: string | null;
  agent: string | null;
  domain: string | null;
  status: string;
  durationMs: number | null;
  eventCount: number;
  toolCalls: number;
  modelCalls: number;
  retrievals: number;
  humanEditCount: number;
  humanOverrideCount: number;
  reAskCount: number;
  health: ObserveRunHealth;
};

export type ObserveTimelineEvent = {
  id: string;
  sequence: number;
  eventType: string;
  category: ObserveEventCategory;
  timestamp: string;
  durationMs: number | null;
  status: string | null;
  summary: Record<string, unknown> | null;
};

export type ObserveRunDetailData = {
  active: true;
  runId: string;
  agentId: string | null;
  agentRole: string | null;
  workDomain: string | null;
  agent: string | null;
  domain: string | null;
  model: string | null;
  runType: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  durationMs: number | null;
  eventCount: number;
  totalEventCount: number;
  timelineShown: number;
  timelineTruncated: boolean;
  toolCalls: number;
  modelCalls: number;
  retrievals: number;
  humanEditCount: number;
  humanOverrideCount: number;
  reAskCount: number;
  errorCode: string | null;
  errorSummary: string | null;
  events: ObserveTimelineEvent[];
  diagnostics: {
    extraTerminal: boolean;
    terminalCount: number;
    postTerminalHumanSignals: number;
  };
  note: string;
};

function eventCountMap(
  rows: Array<{ eventType: string; _count: { _all: number } }>,
): Map<string, number> {
  return new Map(rows.map((r) => [r.eventType, r._count._all]));
}

function sumTypes(map: Map<string, number>, types: readonly string[]): number {
  let n = 0;
  for (const t of types) n += map.get(t) ?? 0;
  return n;
}

function emptyTrendPoint(bucket: string): ObserveTrendPoint {
  return {
    bucket,
    runs: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    humanEdit: 0,
    humanOverride: 0,
    reAsk: 0,
  };
}

export async function loadObserveOverview(input: {
  orgId: string;
  range: ObserveRange;
  env?: AutopilotFlagEnv;
  now?: Date;
}): Promise<ObserveOverviewData> {
  const env = input.env ?? process.env;
  const window = observeWindow(input.range, input.now);
  const capture = isAutopilotTelemetryCaptureEnabled(env) ? "ON" : "OFF";
  const processor = isAutopilotProcessorEnabled(env) ? "ON" : "OFF";
  let queryCount = 0;
  const note = () => {
    queryCount += 1;
  };

  note();
  const statusRows = await db.agentRun.groupBy({
    by: ["status"],
    where: {
      orgId: input.orgId,
      startedAt: { gte: window.since, lte: window.until },
    },
    _count: { _all: true },
  });
  let runsObserved = 0;
  let completedRuns = 0;
  let failedRuns = 0;
  let cancelledRuns = 0;
  let awaitingHumanRuns = 0;
  let runningRuns = 0;
  let queuedRuns = 0;
  for (const row of statusRows) {
    const n = row._count._all;
    runsObserved += n;
    if (row.status === "completed") completedRuns += n;
    if (row.status === "failed") failedRuns += n;
    if (row.status === "cancelled") cancelledRuns += n;
    if (row.status === "awaiting_approval") awaitingHumanRuns += n;
    if (row.status === "running") runningRuns += n;
    if (row.status === "queued") queuedRuns += n;
  }

  const trendMap = new Map<string, ObserveTrendPoint>();
  note();
  const runTrendRows =
    window.bucket === "hour"
      ? await db.$queryRaw<Array<{ bucket: Date; status: string; n: number }>>`
          SELECT date_trunc('hour', COALESCE("startedAt", "createdAt")) AS bucket,
                 status,
                 COUNT(*)::int AS n
          FROM "AgentRun"
          WHERE "orgId" = ${input.orgId}
            AND "startedAt" >= ${window.since}
            AND "startedAt" <= ${window.until}
          GROUP BY 1, 2
        `
      : await db.$queryRaw<Array<{ bucket: Date; status: string; n: number }>>`
          SELECT date_trunc('day', COALESCE("startedAt", "createdAt")) AS bucket,
                 status,
                 COUNT(*)::int AS n
          FROM "AgentRun"
          WHERE "orgId" = ${input.orgId}
            AND "startedAt" >= ${window.since}
            AND "startedAt" <= ${window.until}
          GROUP BY 1, 2
        `;
  for (const row of runTrendRows) {
    const n = Number(row.n);
    const bucket = utcBucketStart(new Date(row.bucket), window.bucket);
    const point = trendMap.get(bucket) ?? emptyTrendPoint(bucket);
    point.runs += n;
    if (row.status === "completed") point.completed += n;
    if (row.status === "failed") point.failed += n;
    if (row.status === "cancelled") point.cancelled += n;
    trendMap.set(bucket, point);
  }

  note();
  const latency = await db.agentRun.aggregate({
    where: {
      orgId: input.orgId,
      startedAt: { gte: window.since, lte: window.until },
      latencyMs: { not: null },
    },
    _avg: { latencyMs: true },
  });

  note();
  const eventRows = await db.agentRunEvent.groupBy({
    by: ["eventType"],
    where: {
      orgId: input.orgId,
      createdAt: { gte: window.since, lte: window.until },
    },
    _count: { _all: true },
  });
  const events = eventCountMap(eventRows);

  note();
  const humanTrendRows =
    window.bucket === "hour"
      ? await db.$queryRaw<Array<{ bucket: Date; eventType: string; n: number }>>`
          SELECT date_trunc('hour', "createdAt") AS bucket,
                 "eventType",
                 COUNT(*)::int AS n
          FROM "AgentRunEvent"
          WHERE "orgId" = ${input.orgId}
            AND "createdAt" >= ${window.since}
            AND "createdAt" <= ${window.until}
            AND "eventType" IN (${Prisma.join(HUMAN_SOURCE_TYPES)})
          GROUP BY 1, 2
        `
      : await db.$queryRaw<Array<{ bucket: Date; eventType: string; n: number }>>`
          SELECT date_trunc('day', "createdAt") AS bucket,
                 "eventType",
                 COUNT(*)::int AS n
          FROM "AgentRunEvent"
          WHERE "orgId" = ${input.orgId}
            AND "createdAt" >= ${window.since}
            AND "createdAt" <= ${window.until}
            AND "eventType" IN (${Prisma.join(HUMAN_SOURCE_TYPES)})
          GROUP BY 1, 2
        `;
  for (const row of humanTrendRows) {
    const bucket = utcBucketStart(row.bucket, window.bucket);
    const point = trendMap.get(bucket) ?? emptyTrendPoint(bucket);
    const n = Number(row.n);
    if ((HUMAN_EDIT_SOURCES as readonly string[]).includes(row.eventType)) {
      point.humanEdit += n;
    } else if (
      (HUMAN_OVERRIDE_SOURCES as readonly string[]).includes(row.eventType)
    ) {
      point.humanOverride += n;
    } else if ((RE_ASK_SOURCES as readonly string[]).includes(row.eventType)) {
      point.reAsk += n;
    }
    trendMap.set(bucket, point);
  }

  note();
  const lastObserved = await db.agentRunEvent.findFirst({
    where: { orgId: input.orgId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  let durableCaptureGap: number | null = null;
  let projectionGap: number | null = null;
  let humanSignalProjectionGap: number | null = null;
  let toolOrphans: number | null = null;
  let modelOrphans: number | null = null;
  let retrievalOrphans: number | null = null;
  let unknownEventTypeCount: number | null = null;
  let unlinkedHumanSignalCount: number | null = null;
  let deadLetterCount: number | null = null;
  let outboxPending: number | null = null;
  let oldestPendingAgeMs: number | null = null;
  let lastProjectedEventAt: string | null = null;
  let processorLastActivityAt: string | null = null;
  let coverageAvailable = false;
  let coverageUnavailable = false;

  if (isObserveTelemetryReadEnabled(env)) {
    try {
      note();
      const coverage = await loadAutopilotEventCoverage(input.orgId, env);
      coverageAvailable = coverage.schemaAvailable && coverage.observeReadEnabled;
      if (coverageAvailable) {
        durableCaptureGap = coverage.durableCaptureGap;
        projectionGap = coverage.projectionGap;
        humanSignalProjectionGap = coverage.humanSignalProjectionGap;
        toolOrphans = coverage.toolOrphans;
        modelOrphans = coverage.modelOrphans;
        retrievalOrphans = coverage.retrievalOrphans;
        unknownEventTypeCount = coverage.unknownEventTypeCount;
        unlinkedHumanSignalCount = coverage.unlinkedHumanSignalCount;
      } else {
        coverageUnavailable = true;
      }
    } catch {
      coverageUnavailable = true;
      coverageAvailable = false;
    }

    try {
      noteAutopilotTableQuery();
      note();
      const outboxGroups = await db.autopilotTelemetryOutbox.groupBy({
        by: ["status"],
        where: { orgId: input.orgId },
        _count: { _all: true },
      });
      const outboxMap = new Map(
        outboxGroups.map((g) => [g.status, g._count._all]),
      );
      outboxPending = outboxMap.get("pending") ?? 0;
      deadLetterCount = outboxMap.get("dead") ?? 0;

      noteAutopilotTableQuery();
      note();
      const [oldestPending, lastProjected, lastProcessed] = await Promise.all([
        db.autopilotTelemetryOutbox.findFirst({
          where: { orgId: input.orgId, status: "pending" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        db.autopilotRunEvent.findFirst({
          where: { orgId: input.orgId },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true },
        }),
        db.autopilotTelemetryOutbox.findFirst({
          where: { orgId: input.orgId, status: "processed" },
          orderBy: { processedAt: "desc" },
          select: { processedAt: true },
        }),
      ]);
      noteAutopilotTableQuery();
      noteAutopilotTableQuery();
      oldestPendingAgeMs = oldestPending
        ? Math.max(0, Date.now() - oldestPending.createdAt.getTime())
        : null;
      lastProjectedEventAt = lastProjected?.timestamp.toISOString() ?? null;
      processorLastActivityAt = lastProcessed?.processedAt?.toISOString() ?? null;
    } catch {
      outboxPending = null;
      deadLetterCount = null;
    }
  }

  const observeState = observabilityHealthState({
    telemetryReadEnabled: isObserveTelemetryReadEnabled(env),
    coverageAvailable: coverageAvailable && !coverageUnavailable,
    durableCaptureGap,
    projectionGap,
    humanSignalProjectionGap,
    toolOrphans,
    modelOrphans,
    retrievalOrphans,
    unknownEventTypeCount,
    unlinkedHumanSignalCount,
  });

  return {
    active: true,
    observeState: coverageUnavailable ? "UNKNOWN" : observeState,
    mode: "OBSERVE",
    capture,
    processor,
    productionActivation: "OFF",
    productionTelemetryActive: capture === "ON",
    range: input.range,
    runsObserved,
    activeRuns: runningRuns + queuedRuns + awaitingHumanRuns,
    completedRuns,
    failedRuns,
    cancelledRuns,
    awaitingHumanRuns,
    avgLatencyMs:
      typeof latency._avg.latencyMs === "number"
        ? Math.round(latency._avg.latencyMs)
        : null,
    toolCallCount: sumTypes(events, ["tool.started", "TOOL_CALL_STARTED"]),
    modelCallCount: sumTypes(events, [
      "model.started",
      "MODEL_STARTED",
      "response.started",
    ]),
    retrievalCount: sumTypes(events, ["retrieval.started", "RETRIEVAL_STARTED"]),
    toolFailureCount: sumTypes(events, ["tool.failed", "TOOL_CALL_FAILED"]),
    modelFailureCount: sumTypes(events, ["model.failed", "MODEL_FAILED"]),
    retrievalFailureCount: sumTypes(events, [
      "retrieval.failed",
      "RETRIEVAL_FAILED",
    ]),
    humanEditCount: sumTypes(events, HUMAN_EDIT_SOURCES),
    humanOverrideCount: sumTypes(events, HUMAN_OVERRIDE_SOURCES),
    reAskCount: sumTypes(events, RE_ASK_SOURCES),
    durableCaptureGap,
    projectionGap,
    humanSignalProjectionGap,
    toolOrphans,
    modelOrphans,
    retrievalOrphans,
    unknownEventTypeCount,
    unlinkedHumanSignalCount,
    deadLetterCount,
    outboxPending,
    oldestPendingAgeMs,
    lastObservedEventAt: lastObserved?.createdAt.toISOString() ?? null,
    lastProjectedEventAt,
    processorLastActivityAt,
    coverageUnavailable,
    projectionBehind: (projectionGap ?? 0) > 0,
    healthScope: OBSERVE_HEALTH_SCOPE,
    trend: [...trendMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    reconciler: AUTOMATIC_RECONCILER_TRIGGER,
    activationWatermark: ACTIVATION_WATERMARK,
    queryCount,
  };
}

export type ObserveRunListQuery = {
  orgId: string;
  limit: number;
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
  now?: Date;
  env?: AutopilotFlagEnv;
};

type ObserveRunRow = {
  id: string;
  startedAt: Date | null;
  latencyMs: number | null;
  status: string;
  runType: string;
  model: string | null;
  metadata: Prisma.JsonValue | null;
  _count: { events: number };
};

type PerRunObserveFacts = {
  health: ObserveRunHealth;
  toolCalls: number;
  modelCalls: number;
  retrievals: number;
  humanEditCount: number;
  humanOverrideCount: number;
  reAskCount: number;
};

function observeRunListWhere(
  query: ObserveRunListQuery,
  cursor?: ObserveRunCursor | null,
): Prisma.AgentRunWhereInput {
  const window = query.range ? observeWindow(query.range, query.now) : null;
  const cursorStartedAt = cursor ? new Date(cursor.startedAt) : null;
  const and: Prisma.AgentRunWhereInput[] = [];
  if (cursorStartedAt && cursor) {
    and.push({
      OR: [
        { startedAt: { lt: cursorStartedAt } },
        {
          AND: [{ startedAt: cursorStartedAt }, { id: { lt: cursor.id } }],
        },
      ],
    });
  }
  if (query.agent) {
    and.push({
      OR: [
        { metadata: { path: ["agentId"], equals: query.agent } },
        { metadata: { path: ["agentRole"], equals: query.agent } },
      ],
    });
  }
  if (query.domain) {
    and.push({
      metadata: { path: ["workDomain"], equals: query.domain },
    });
  }
  if (query.hasToolFailure) {
    and.push({
      events: {
        some: { eventType: { in: ["tool.failed", "TOOL_CALL_FAILED"] } },
      },
    });
  }
  if (query.hasModelFailure) {
    and.push({
      events: {
        some: { eventType: { in: ["model.failed", "MODEL_FAILED"] } },
      },
    });
  }
  if (query.hasRetrievalFailure) {
    and.push({
      events: {
        some: {
          eventType: { in: ["retrieval.failed", "RETRIEVAL_FAILED"] },
        },
      },
    });
  }
  if (query.hasHumanSignal) {
    and.push({
      events: { some: { eventType: { in: HUMAN_SOURCE_TYPES } } },
    });
  }

  return {
    orgId: query.orgId,
    startedAt: {
      not: null,
      ...(window ? { gte: window.since, lte: window.until } : {}),
    },
    ...(query.status ? { status: query.status } : {}),
    ...(query.runType ? { runType: query.runType } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

async function fetchObserveRunRows(
  where: Prisma.AgentRunWhereInput,
  take: number,
): Promise<ObserveRunRow[]> {
  return db.agentRun.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      startedAt: true,
      latencyMs: true,
      status: true,
      runType: true,
      model: true,
      metadata: true,
      _count: { select: { events: true } },
    },
  });
}

async function loadPerRunObserveFacts(input: {
  orgId: string;
  runIds: string[];
  captureEnabled: boolean;
  env: AutopilotFlagEnv;
}): Promise<Map<string, PerRunObserveFacts>> {
  const out = new Map<string, PerRunObserveFacts>();
  if (input.runIds.length === 0) return out;

  const events = await db.agentRunEvent.findMany({
    where: { orgId: input.orgId, runId: { in: input.runIds } },
    select: { runId: true, eventType: true, payload: true },
  });
  const eventsByRun = new Map<string, CoverageEvent[]>();
  for (const id of input.runIds) eventsByRun.set(id, []);
  for (const event of events) {
    eventsByRun.get(event.runId)?.push({
      runId: event.runId,
      eventType: event.eventType,
      payload: event.payload,
    });
  }

  const outboxByRun = new Map<string, number>();
  const overlayByAgentRun = new Map<string, string>();
  const projectedByOverlay = new Map<
    string,
    { total: number; unknown: number; human: number }
  >();

  if (isObserveTelemetryReadEnabled(input.env)) {
    noteAutopilotTableQuery();
    const outboxGroups = await db.autopilotTelemetryOutbox.groupBy({
      by: ["agentRunId"],
      where: {
        orgId: input.orgId,
        noticeType: "event",
        agentRunId: { in: input.runIds },
      },
      _count: { _all: true },
    });
    for (const row of outboxGroups) {
      outboxByRun.set(row.agentRunId, row._count._all);
    }

    noteAutopilotTableQuery();
    const overlays = await db.autopilotRun.findMany({
      where: { orgId: input.orgId, agentRunId: { in: input.runIds } },
      select: { id: true, agentRunId: true },
    });
    for (const overlay of overlays) {
      overlayByAgentRun.set(overlay.agentRunId, overlay.id);
    }
    const overlayIds = overlays.map((row) => row.id);
    if (overlayIds.length > 0) {
      noteAutopilotTableQuery();
      const projectedGroups = await db.autopilotRunEvent.groupBy({
        by: ["runId", "eventType"],
        where: { orgId: input.orgId, runId: { in: overlayIds } },
        _count: { _all: true },
      });
      for (const row of projectedGroups) {
        const cur = projectedByOverlay.get(row.runId) ?? {
          total: 0,
          unknown: 0,
          human: 0,
        };
        cur.total += row._count._all;
        if (row.eventType === "UNKNOWN_EVENT") cur.unknown += row._count._all;
        if (
          (HUMAN_SIGNAL_PROJECTED_TYPES as readonly string[]).includes(
            row.eventType,
          )
        ) {
          cur.human += row._count._all;
        }
        projectedByOverlay.set(row.runId, cur);
      }
    }
  }

  const telemetryReadable = isObserveTelemetryReadEnabled(input.env);
  for (const runId of input.runIds) {
    const runEvents = eventsByRun.get(runId) ?? [];
    const counts = new Map<string, number>();
    for (const event of runEvents) {
      counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    }
    const facts = {
      toolCalls: counts.get("tool.started") ?? 0,
      modelCalls: counts.get("model.started") ?? 0,
      retrievals: counts.get("retrieval.started") ?? 0,
      humanEditCount: sumTypes(counts, HUMAN_EDIT_SOURCES),
      humanOverrideCount: sumTypes(counts, HUMAN_OVERRIDE_SOURCES),
      reAskCount: sumTypes(counts, RE_ASK_SOURCES),
    };
    if (!telemetryReadable) {
      out.set(runId, { ...facts, health: "UNKNOWN" });
      continue;
    }
    const overlayId = overlayByAgentRun.get(runId);
    const projected = overlayId ? projectedByOverlay.get(overlayId) : undefined;
    const snap = summarizeCoverage({
      runCount: 1,
      events: runEvents,
      outboxEventCount: outboxByRun.get(runId) ?? 0,
      projectedEventCount: projected?.total ?? 0,
      projectedMappedCount: projected
        ? Math.max(0, projected.total - projected.unknown)
        : 0,
      projectedUnknownCount: projected?.unknown ?? 0,
      projectedHumanSignalCount: projected?.human ?? 0,
      captureEnabled: input.captureEnabled,
      classify: classifyAgentRunEvent,
    });
    out.set(runId, {
      ...facts,
      health: perRunObservabilityHealth({
        eventCount: runEvents.length,
        durableCaptureGap: snap.durableCaptureGap,
        projectionGap: snap.projectionGap,
        humanSignalProjectionGap: snap.humanSignalProjectionGap,
        toolOrphans: snap.toolOrphans,
        modelOrphans: snap.modelOrphans,
        retrievalOrphans: snap.retrievalOrphans,
      }),
    });
  }
  return out;
}

function toObserveRunListItem(
  row: ObserveRunRow,
  facts: PerRunObserveFacts | undefined,
): ObserveRunListItem {
  const identity = extractObserveRunIdentity(row.metadata);
  return {
    runId: row.id,
    startedAt: (row.startedAt ?? new Date(0)).toISOString(),
    runType: row.runType,
    model: row.model,
    agentId: identity.agentId,
    agentRole: identity.agentRole,
    workDomain: identity.workDomain,
    agent: formatObserveAgentLabel(identity),
    domain: identity.workDomain,
    status: row.status,
    durationMs: row.latencyMs,
    eventCount: row._count.events,
    toolCalls: facts?.toolCalls ?? 0,
    modelCalls: facts?.modelCalls ?? 0,
    retrievals: facts?.retrievals ?? 0,
    humanEditCount: facts?.humanEditCount ?? 0,
    humanOverrideCount: facts?.humanOverrideCount ?? 0,
    reAskCount: facts?.reAskCount ?? 0,
    health: facts?.health ?? "UNKNOWN",
  };
}

export async function listObserveRuns(query: ObserveRunListQuery): Promise<{
  items: ObserveRunListItem[];
  nextCursor: string | null;
}> {
  const env = query.env ?? process.env;
  const captureEnabled = isAutopilotTelemetryCaptureEnabled(env);
  const loadFacts = (runIds: string[]) =>
    loadPerRunObserveFacts({
      orgId: query.orgId,
      runIds,
      captureEnabled,
      env,
    });

  if (!query.hasObservabilityGap) {
    const rows = await fetchObserveRunRows(
      observeRunListWhere(query, query.cursor),
      query.limit,
    );
    const facts = await loadFacts(rows.map((row) => row.id));
    const last = rows[rows.length - 1];
    return {
      items: rows.map((row) => toObserveRunListItem(row, facts.get(row.id))),
      nextCursor:
        rows.length === query.limit && last?.startedAt
          ? encodeObserveCursor(last.startedAt, last.id)
          : null,
    };
  }

  const matched: ObserveRunListItem[] = [];
  let scanCursor = query.cursor ?? null;
  let scanned = 0;
  let lastScanned: ObserveRunRow | undefined;
  let lastBatchTake = 0;
  let lastBatchLength = 0;
  const maxScan = MAX_RUN_PAGE_SIZE * GAP_FILTER_MAX_CANDIDATE_PAGES;

  while (matched.length < query.limit && scanned < maxScan) {
    const take = Math.min(query.limit, maxScan - scanned);
    const rows = await fetchObserveRunRows(
      observeRunListWhere(query, scanCursor),
      take,
    );
    lastBatchTake = take;
    lastBatchLength = rows.length;
    if (rows.length === 0) break;
    scanned += rows.length;
    lastScanned = rows[rows.length - 1];
    const facts = await loadFacts(rows.map((row) => row.id));
    for (const row of rows) {
      const item = toObserveRunListItem(row, facts.get(row.id));
      if (!isObserveRunIntegrityIssue(item.health)) continue;
      matched.push(item);
      if (matched.length === query.limit) break;
    }
    if (matched.length === query.limit) break;
    if (!lastScanned.startedAt) break;
    scanCursor = {
      startedAt: lastScanned.startedAt.toISOString(),
      id: lastScanned.id,
    };
    if (rows.length < take) break;
  }

  const filled = matched.length === query.limit;
  const lastMatched = matched[matched.length - 1];
  const exhausted = lastBatchLength === 0 || lastBatchLength < lastBatchTake;
  let nextCursor: string | null = null;
  if (filled && lastMatched) {
    nextCursor = `${lastMatched.startedAt}~${lastMatched.runId}`;
  } else if (!exhausted && lastScanned?.startedAt) {
    nextCursor = encodeObserveCursor(lastScanned.startedAt, lastScanned.id);
  }

  return { items: matched, nextCursor };
}

export async function loadObserveRunDetail(input: {
  orgId: string;
  runId: string;
}): Promise<ObserveRunDetailData | null> {
  const row = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId },
    select: {
      id: true,
      runType: true,
      model: true,
      metadata: true,
      status: true,
      startedAt: true,
      completedAt: true,
      latencyMs: true,
      errorCode: true,
      errorMessage: true,
    },
  });
  if (!row) return null;

  const [totalEventCount, typeGroups, terminalRows, timelineRows] =
    await Promise.all([
      db.agentRunEvent.count({
        where: { orgId: input.orgId, runId: input.runId },
      }),
      db.agentRunEvent.groupBy({
        by: ["eventType"],
        where: { orgId: input.orgId, runId: input.runId },
        _count: { _all: true },
      }),
      db.agentRunEvent.findMany({
        where: {
          orgId: input.orgId,
          runId: input.runId,
          eventType: { in: [...TERMINAL_SOURCE_TYPES] },
        },
        select: { sequence: true, eventType: true },
        orderBy: { sequence: "asc" },
      }),
      db.agentRunEvent.findMany({
        where: { orgId: input.orgId, runId: input.runId },
        orderBy: { sequence: "asc" },
        take: MAX_TIMELINE_EVENTS,
        select: {
          id: true,
          sequence: true,
          eventType: true,
          payload: true,
          createdAt: true,
        },
      }),
    ]);

  const counts = eventCountMap(typeGroups);
  const invariant = terminalInvariant(terminalRows);
  const firstTerminalSeq = terminalRows.find((event) =>
    isTerminalObserveEvent(event.eventType),
  )?.sequence;
  const postTerminalHumanSignals =
    firstTerminalSeq == null
      ? 0
      : await db.agentRunEvent.count({
          where: {
            orgId: input.orgId,
            runId: input.runId,
            eventType: { in: HUMAN_SOURCE_TYPES },
            sequence: { gt: firstTerminalSeq },
          },
        });

  const mapped: ObserveTimelineEvent[] = [];
  for (const event of timelineRows) {
    const mappedEvent = mapAgentRunEventToAutopilot(
      event.eventType,
      event.payload,
    );
    if (!mappedEvent) continue;
    const payload = timelineSafeSummary(
      sanitizeAutopilotPayload(mappedEvent.payload),
    );
    mapped.push({
      id: event.id,
      sequence: event.sequence,
      eventType: mappedEvent.eventType,
      category: observeEventCategory(mappedEvent.eventType),
      timestamp: event.createdAt.toISOString(),
      durationMs: mappedEvent.durationMs,
      status:
        typeof payload?.errorCode === "string"
          ? payload.errorCode
          : mappedEvent.eventType.endsWith("_FAILED")
            ? "failed"
            : mappedEvent.eventType.endsWith("_COMPLETED") ||
                mappedEvent.eventType === "TASK_COMPLETED" ||
                mappedEvent.eventType === "TASK_CANCELLED"
              ? "terminal"
              : null,
      summary: payload,
    });
  }

  const identity = extractObserveRunIdentity(row.metadata);
  const timelineShown = timelineRows.length;
  const timelineTruncated = totalEventCount > timelineShown;

  return {
    active: true,
    runId: row.id,
    agentId: identity.agentId,
    agentRole: identity.agentRole,
    workDomain: identity.workDomain,
    agent: formatObserveAgentLabel(identity),
    domain: identity.workDomain,
    model: row.model,
    runType: row.runType,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.completedAt?.toISOString() ?? null,
    status: row.status,
    durationMs: row.latencyMs,
    eventCount: totalEventCount,
    totalEventCount,
    timelineShown,
    timelineTruncated,
    toolCalls: counts.get("tool.started") ?? 0,
    modelCalls: counts.get("model.started") ?? 0,
    retrievals: counts.get("retrieval.started") ?? 0,
    humanEditCount: sumTypes(counts, HUMAN_EDIT_SOURCES),
    humanOverrideCount: sumTypes(counts, HUMAN_OVERRIDE_SOURCES),
    reAskCount: sumTypes(counts, RE_ASK_SOURCES),
    errorCode: row.errorCode ? safePersistedErrorCode(row.errorCode) : null,
    errorSummary: row.errorMessage
      ? redactPersistedErrorText(row.errorMessage)
      : null,
    events: mapped,
    diagnostics: {
      extraTerminal: invariant.extraTerminal,
      terminalCount: invariant.terminalCount,
      postTerminalHumanSignals,
    },
    note: "Observed events. Not a quality judgment or root-cause diagnosis.",
  };
}
