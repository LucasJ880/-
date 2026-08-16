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
  HUMAN_EDIT_SOURCES,
  HUMAN_OVERRIDE_SOURCES,
  RE_ASK_SOURCES,
} from "./human-signals";
import { loadAutopilotEventCoverage } from "./coverage-health";
import {
  isAutopilotProcessorEnabled,
  isAutopilotTelemetryCaptureEnabled,
  type AutopilotFlagEnv,
} from "./flags";
import { mapAgentRunEventToAutopilot } from "./map-events";
import { observabilityHealthState } from "./observe-health";
import { AUTOMATIC_RECONCILER_TRIGGER } from "./reconcile-cursor";
import {
  ACTIVATION_WATERMARK,
  isObserveTelemetryReadEnabled,
  noteAutopilotTableQuery,
} from "./observe-read-gate";
import {
  encodeObserveCursor,
  observeWindow,
  utcBucketStart,
  type ObserveRange,
  type ObserveRunCursor,
  type ObserveRunStatus,
} from "./observe-range";
import {
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

const MAX_TIMELINE_EVENTS = 400;

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
  trend: ObserveTrendPoint[];
  reconciler: typeof AUTOMATIC_RECONCILER_TRIGGER;
  activationWatermark: typeof ACTIVATION_WATERMARK;
  queryCount: number;
};

export type ObserveRunListItem = {
  runId: string;
  startedAt: string;
  runType: string;
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
  health: "HEALTHY" | "GAP" | "ORPHAN" | "UNKNOWN";
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
  agent: string | null;
  domain: string | null;
  runType: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  durationMs: number | null;
  eventCount: number;
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
  hasToolFailure?: boolean;
  hasModelFailure?: boolean;
  hasRetrievalFailure?: boolean;
  hasHumanSignal?: boolean;
  hasObservabilityGap?: boolean;
  range?: ObserveRange;
  now?: Date;
};

export async function listObserveRuns(query: ObserveRunListQuery): Promise<{
  items: ObserveRunListItem[];
  nextCursor: string | null;
}> {
  const window = query.range ? observeWindow(query.range, query.now) : null;
  const cursorStartedAt = query.cursor ? new Date(query.cursor.startedAt) : null;
  const and: Prisma.AgentRunWhereInput[] = [];
  if (cursorStartedAt && query.cursor) {
    and.push({
      OR: [
        { startedAt: { lt: cursorStartedAt } },
        {
          AND: [{ startedAt: cursorStartedAt }, { id: { lt: query.cursor.id } }],
        },
      ],
    });
  }
  if (query.agent) {
    and.push({
      OR: [{ model: query.agent }, { runType: query.agent }],
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

  const where: Prisma.AgentRunWhereInput = {
    orgId: query.orgId,
    startedAt: {
      not: null,
      ...(window ? { gte: window.since, lte: window.until } : {}),
    },
    ...(query.status ? { status: query.status } : {}),
    ...(query.runType ? { runType: query.runType } : {}),
    ...(query.hasObservabilityGap ? { autopilotRun: { is: null } } : {}),
    ...(and.length ? { AND: and } : {}),
  };

  noteAutopilotTableQuery();
  const rows = await db.agentRun.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: query.limit,
    select: {
      id: true,
      startedAt: true,
      latencyMs: true,
      status: true,
      runType: true,
      model: true,
      autopilotRun: {
        select: { id: true },
      },
      _count: { select: { events: true } },
    },
  });

  const ids = rows.map((r) => r.id);
  const grouped =
    ids.length === 0
      ? []
      : await db.agentRunEvent.groupBy({
          by: ["runId", "eventType"],
          where: {
            orgId: query.orgId,
            runId: { in: ids },
            eventType: {
              in: [
                "tool.started",
                "model.started",
                "retrieval.started",
                ...HUMAN_SOURCE_TYPES,
              ],
            },
          },
          _count: { _all: true },
        });

  const byRun = new Map<string, Map<string, number>>();
  for (const row of grouped) {
    let inner = byRun.get(row.runId);
    if (!inner) {
      inner = new Map();
      byRun.set(row.runId, inner);
    }
    inner.set(row.eventType, row._count._all);
  }

  const items: ObserveRunListItem[] = rows.map((row) => {
    const counts = byRun.get(row.id) ?? new Map();
    return {
      runId: row.id,
      startedAt: (row.startedAt ?? new Date(0)).toISOString(),
      runType: row.runType,
      agent: row.model ?? row.runType,
      domain: row.runType,
      status: row.status,
      durationMs: row.latencyMs,
      eventCount: row._count.events,
      toolCalls: counts.get("tool.started") ?? 0,
      modelCalls: counts.get("model.started") ?? 0,
      retrievals: counts.get("retrieval.started") ?? 0,
      humanEditCount: sumTypes(counts, HUMAN_EDIT_SOURCES),
      humanOverrideCount: sumTypes(counts, HUMAN_OVERRIDE_SOURCES),
      reAskCount: sumTypes(counts, RE_ASK_SOURCES),
      health: row.autopilotRun ? "HEALTHY" : "GAP",
    };
  });

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === query.limit && last?.startedAt
      ? encodeObserveCursor(last.startedAt, last.id)
      : null;

  return { items, nextCursor };
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
      status: true,
      startedAt: true,
      completedAt: true,
      latencyMs: true,
      errorCode: true,
      errorMessage: true,
      events: {
        orderBy: { sequence: "asc" },
        take: MAX_TIMELINE_EVENTS,
        select: {
          id: true,
          sequence: true,
          eventType: true,
          payload: true,
          createdAt: true,
        },
      },
    },
  });
  if (!row) return null;

  const mapped: ObserveTimelineEvent[] = [];
  for (const event of row.events) {
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

  const invariant = terminalInvariant(mapped);
  const counts = new Map<string, number>();
  for (const event of row.events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  const firstTerminalSeq = mapped.find((e) =>
    ["TASK_COMPLETED", "TASK_FAILED", "TASK_CANCELLED"].includes(e.eventType),
  )?.sequence;
  const postTerminalHumanSignals = mapped.filter(
    (e) =>
      ["HUMAN_EDIT", "HUMAN_OVERRIDE", "RE_ASK_SIGNAL"].includes(e.eventType) &&
      firstTerminalSeq != null &&
      e.sequence > firstTerminalSeq,
  ).length;

  return {
    active: true,
    runId: row.id,
    agent: row.model ?? row.runType,
    domain: row.runType,
    runType: row.runType,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.completedAt?.toISOString() ?? null,
    status: row.status,
    durationMs: row.latencyMs,
    eventCount: row.events.length,
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
