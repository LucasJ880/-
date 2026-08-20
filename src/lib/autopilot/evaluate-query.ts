/**
 * A2-P0 Evaluate read path.
 * Dark telemetry short-circuits BEFORE AutopilotEvaluation queries.
 * Does not expose quality scores, prompts, or employee identity.
 */

import { db } from "@/lib/db";
import {
  extractObserveRunIdentity,
  formatObserveAgentLabel,
} from "./observe-identity";
import {
  darkObserveState,
  isObserveTelemetryReadEnabled,
  noteAutopilotTableQuery,
} from "./observe-read-gate";
import {
  encodeObserveCursor,
  MAX_RUN_PAGE_SIZE,
  ObserveQueryError,
  observeWindow,
  parseObserveCursor,
  parseObserveLimit,
  parseObserveRange,
  type ObserveRange,
  type ObserveRunCursor,
} from "./observe-range";
import { isAutopilotLlmJudgeEnabled, type AutopilotFlagEnv } from "./flags";
import {
  AUTOPILOT_EVALUATE_SURFACE,
  AUTOPILOT_EVALUATOR_KIND,
  AUTOPILOT_EVALUATOR_VERSION,
  AUTOPILOT_LLM_EVALUATOR_VERSION,
  type AutopilotOutcome,
} from "./types";
import { isKnownAutopilotOutcome } from "./evaluate";

export type EvaluateListItem = {
  evaluationId: string;
  runId: string;
  evaluatedAt: string;
  startedAt: string | null;
  runType: string;
  model: string | null;
  agent: string | null;
  domain: string | null;
  runtimeStatus: string;
  outcome: AutopilotOutcome;
  failureType: string | null;
  failureSource: string | null;
  judged: boolean;
  ruleId: string;
  evaluatorKind: string;
  evaluatorVersion: string;
  llmOutcome: AutopilotOutcome | null;
  llmFailureType: string | null;
  llmJudged: boolean | null;
  llmRuleId: string | null;
};

export type EvaluateCounts = {
  evaluatedRuns: number;
  unknownCount: number;
  failureCount: number;
  humanOverrideOutcomeCount: number;
  abandonedCount: number;
  taskSuccessCount: number;
  partialSuccessCount: number;
  judgedCount: number;
  llmJudgedCount: number;
  llmTaskSuccessCount: number;
  llmPartialSuccessCount: number;
  llmFailureCount: number;
  llmAttemptedCount: number;
  llmAbstainedCount: number;
  llmRejectedInsufficientCount: number;
  llmUnavailableCount: number;
  llmParseFailedCount: number;
};

const EMPTY_COUNTS: EvaluateCounts = {
  evaluatedRuns: 0,
  unknownCount: 0,
  failureCount: 0,
  humanOverrideOutcomeCount: 0,
  abandonedCount: 0,
  taskSuccessCount: 0,
  partialSuccessCount: 0,
  judgedCount: 0,
  llmJudgedCount: 0,
  llmTaskSuccessCount: 0,
  llmPartialSuccessCount: 0,
  llmFailureCount: 0,
  llmAttemptedCount: 0,
  llmAbstainedCount: 0,
  llmRejectedInsufficientCount: 0,
  llmUnavailableCount: 0,
  llmParseFailedCount: 0,
};

export function parseEvaluateOutcome(
  raw: string | null | undefined,
): AutopilotOutcome | undefined {
  if (raw == null || raw === "") return undefined;
  if (!isKnownAutopilotOutcome(raw)) {
    throw new ObserveQueryError("outcome is not a known Autopilot outcome");
  }
  return raw;
}

export function parseEvaluateListQuery(search: URLSearchParams): {
  range: ObserveRange;
  limit: number;
  cursor: ObserveRunCursor | null;
  outcome?: AutopilotOutcome;
} {
  return {
    range: parseObserveRange(search.get("range")),
    limit: parseObserveLimit(search.get("limit")),
    cursor: parseObserveCursor(search.get("cursor")),
    outcome: parseEvaluateOutcome(search.get("outcome")),
  };
}

function countsFromGroups(
  groups: Array<{ outcome: string; judged: boolean; _count: { _all: number } }>,
): EvaluateCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const row of groups) {
    const n = row._count._all;
    counts.evaluatedRuns += n;
    if (row.judged) counts.judgedCount += n;
    if (row.outcome === "UNKNOWN") counts.unknownCount += n;
    else if (row.outcome === "FAILURE") counts.failureCount += n;
    else if (row.outcome === "HUMAN_OVERRIDE") {
      counts.humanOverrideOutcomeCount += n;
    } else if (row.outcome === "ABANDONED") counts.abandonedCount += n;
    else if (row.outcome === "TASK_SUCCESS") counts.taskSuccessCount += n;
    else if (row.outcome === "PARTIAL_SUCCESS") counts.partialSuccessCount += n;
  }
  return counts;
}

export async function loadEvaluateOverview(input: {
  orgId: string;
  range: ObserveRange;
  env?: AutopilotFlagEnv;
  now?: Date;
}) {
  const env = input.env ?? process.env;
  if (!isObserveTelemetryReadEnabled(env)) {
    return {
      surface: AUTOPILOT_EVALUATE_SURFACE,
      evaluatorKind: AUTOPILOT_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      ...darkObserveState(env),
      evaluateState: "NOT_ACTIVE" as const,
      llmJudge: "OFF" as const,
      range: input.range,
      ...EMPTY_COUNTS,
      items: [] as EvaluateListItem[],
    };
  }

  const { since, until } = observeWindow(input.range, input.now);
  noteAutopilotTableQuery();
  const groups = await db.autopilotEvaluation.groupBy({
    by: ["outcome", "judged"],
    where: {
      orgId: input.orgId,
      evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      updatedAt: { gte: since, lte: until },
    },
    _count: { _all: true },
  });
  noteAutopilotTableQuery();
  const llmGroups = await db.autopilotEvaluation.groupBy({
    by: ["outcome", "judged"],
    where: {
      orgId: input.orgId,
      evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      updatedAt: { gte: since, lte: until },
    },
    _count: { _all: true },
  });
  const llmCounts = countsFromGroups(llmGroups);
  noteAutopilotTableQuery();
  const llmRuleGroups = await db.autopilotEvaluation.groupBy({
    by: ["ruleId"],
    where: {
      orgId: input.orgId,
      evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      updatedAt: { gte: since, lte: until },
    },
    _count: { _all: true },
  });
  const llmRuleCounts = {
    llmAttemptedCount: 0,
    llmAbstainedCount: 0,
    llmRejectedInsufficientCount: 0,
    llmUnavailableCount: 0,
    llmParseFailedCount: 0,
  };
  for (const row of llmRuleGroups) {
    const n = row._count._all;
    llmRuleCounts.llmAttemptedCount += n;
    if (row.ruleId === "LLM_JUDGE_ABSTAINED") llmRuleCounts.llmAbstainedCount += n;
    else if (row.ruleId === "LLM_JUDGE_REJECTED_INSUFFICIENT_EVIDENCE") {
      llmRuleCounts.llmRejectedInsufficientCount += n;
    } else if (row.ruleId === "LLM_JUDGE_UNAVAILABLE") {
      llmRuleCounts.llmUnavailableCount += n;
    } else if (row.ruleId === "LLM_JUDGE_PARSE_FAILED") {
      llmRuleCounts.llmParseFailedCount += n;
    }
  }

  return {
    surface: AUTOPILOT_EVALUATE_SURFACE,
    evaluatorKind: AUTOPILOT_EVALUATOR_KIND,
    evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
    active: true as const,
    evaluateState: "ACTIVE" as const,
    mode: "EVALUATE" as const,
    llmJudge: isAutopilotLlmJudgeEnabled(env) ? ("FLAG_ON" as const) : ("OFF" as const),
    range: input.range,
    ...countsFromGroups(groups),
    llmJudgedCount: llmCounts.judgedCount,
    llmTaskSuccessCount: llmCounts.taskSuccessCount,
    llmPartialSuccessCount: llmCounts.partialSuccessCount,
    llmFailureCount: llmCounts.failureCount,
    ...llmRuleCounts,
    message:
      "Deterministic outcomes first. A2-P1 LLM Judge is structural-only and cannot assign TASK_SUCCESS, PARTIAL_SUCCESS, or final FAILURE. Human override is not AI_WRONG.",
  };
}

export async function listEvaluateRows(input: {
  orgId: string;
  range: ObserveRange;
  limit?: number;
  cursor?: ObserveRunCursor | null;
  outcome?: AutopilotOutcome;
  env?: AutopilotFlagEnv;
  now?: Date;
}): Promise<{ items: EvaluateListItem[]; nextCursor: string | null }> {
  const env = input.env ?? process.env;
  if (!isObserveTelemetryReadEnabled(env)) {
    return { items: [], nextCursor: null };
  }

  const limit = Math.min(input.limit ?? 25, MAX_RUN_PAGE_SIZE);
  const { since, until } = observeWindow(input.range, input.now);
  const cursor = input.cursor;
  const cursorAt = cursor ? new Date(cursor.startedAt) : null;

  noteAutopilotTableQuery();
  const rows = await db.autopilotEvaluation.findMany({
    where: {
      orgId: input.orgId,
      evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      updatedAt: { gte: since, lte: until },
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(cursorAt && cursor
        ? {
            OR: [
              { updatedAt: { lt: cursorAt } },
              { updatedAt: cursorAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      agentRunId: true,
      updatedAt: true,
      outcome: true,
      failureType: true,
      failureSource: true,
      judged: true,
      ruleId: true,
      evaluatorKind: true,
      evaluatorVersion: true,
      agentRun: {
        select: {
          status: true,
          startedAt: true,
          runType: true,
          model: true,
          metadata: true,
        },
      },
    },
  });

  const items: EvaluateListItem[] = rows.map((row) => {
    const identity = extractObserveRunIdentity(row.agentRun.metadata);
    const outcome = isKnownAutopilotOutcome(row.outcome)
      ? row.outcome
      : "UNKNOWN";
    return {
      evaluationId: row.id,
      runId: row.agentRunId,
      evaluatedAt: row.updatedAt.toISOString(),
      startedAt: row.agentRun.startedAt?.toISOString() ?? null,
      runType: row.agentRun.runType,
      model: row.agentRun.model,
      agent: formatObserveAgentLabel(identity),
      domain: identity.workDomain,
      runtimeStatus: row.agentRun.status,
      outcome,
      failureType: row.failureType,
      failureSource: row.failureSource,
      judged: row.judged,
      ruleId: row.ruleId,
      evaluatorKind: row.evaluatorKind,
      evaluatorVersion: row.evaluatorVersion,
      llmOutcome: null,
      llmFailureType: null,
      llmJudged: null,
      llmRuleId: null,
    };
  });

  const runIds = items.map((item) => item.runId);
  if (runIds.length > 0) {
    noteAutopilotTableQuery();
    const llmRows = await db.autopilotEvaluation.findMany({
      where: {
        orgId: input.orgId,
        evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
        agentRunId: { in: runIds },
      },
      select: {
        agentRunId: true,
        outcome: true,
        failureType: true,
        judged: true,
        ruleId: true,
      },
    });
    const llmByRun = new Map(llmRows.map((row) => [row.agentRunId, row]));
    for (const item of items) {
      const llm = llmByRun.get(item.runId);
      if (!llm) continue;
      item.llmOutcome = isKnownAutopilotOutcome(llm.outcome)
        ? llm.outcome
        : "UNKNOWN";
      item.llmFailureType = llm.failureType;
      item.llmJudged = llm.judged;
      item.llmRuleId = llm.ruleId;
    }
  }

  const last = rows[rows.length - 1];
  return {
    items,
    nextCursor:
      rows.length === limit && last
        ? encodeObserveCursor(last.updatedAt, last.id)
        : null,
  };
}
