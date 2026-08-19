/**
 * A2-P0 Evaluate metric semantics.
 * UI must not invent quality scores. Counts are outcomes, not grades.
 */

export const EVALUATE_METRIC_DEFINITIONS = {
  evaluatedRuns: {
    key: "evaluatedRuns",
    meaning: "AutopilotEvaluation rows in the selected window",
    not: "AI success count",
  },
  unknownCount: {
    key: "unknownCount",
    meaning: "outcome = UNKNOWN — not judged as task success",
    not: "failure",
  },
  failureCount: {
    key: "failureCount",
    meaning: "outcome = FAILURE from runtime failed + system failure map",
    not: "observability gap",
  },
  humanOverrideOutcomeCount: {
    key: "humanOverrideOutcomeCount",
    meaning: "outcome = HUMAN_OVERRIDE",
    not: "AI_WRONG",
  },
  abandonedCount: {
    key: "abandonedCount",
    meaning: "outcome = ABANDONED from cancelled",
    not: "user dissatisfaction",
  },
  taskSuccessCount: {
    key: "taskSuccessCount",
    meaning: "outcome = TASK_SUCCESS. A2-P0 never assigns this.",
    not: "completedRuns",
  },
  partialSuccessCount: {
    key: "partialSuccessCount",
    meaning: "outcome = PARTIAL_SUCCESS. A2-P0 never assigns this.",
    not: "humanEditCount",
  },
} as const;

export type EvaluateMetricKey = keyof typeof EVALUATE_METRIC_DEFINITIONS;

export function evaluateMetricMapsToAiWrong(_key: EvaluateMetricKey): boolean {
  return false;
}
