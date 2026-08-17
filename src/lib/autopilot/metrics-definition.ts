/**
 * A1-P3 Observe Dashboard metric semantics.
 * UI must not invent formulas. Completed ≠ success. Human signals ≠ quality.
 */

export const OBSERVE_METRIC_DEFINITIONS = {
  runsObserved: {
    key: "runsObserved",
    meaning: "AgentRun count in the selected window",
    not: "AI success count",
  },
  activeRuns: {
    key: "activeRuns",
    meaning: "AgentRun.status in running / awaiting_approval / similar non-terminal",
    not: "healthy AI",
  },
  completedRuns: {
    key: "completedRuns",
    meaning: "AgentRun.status = completed (runtime state, not task success)",
    not: "successRate",
  },
  failedRuns: {
    key: "failedRuns",
    meaning: "AgentRun.status = failed",
    not: "observability degraded",
  },
  cancelledRuns: {
    key: "cancelledRuns",
    meaning: "AgentRun.status = cancelled",
    not: "user dissatisfaction",
  },
  humanEditCount: {
    key: "humanEditCount",
    meaning: "Count of HUMAN_EDIT / human.edit / job.human_edited sources",
    not: "AI_WRONG",
  },
  humanOverrideCount: {
    key: "humanOverrideCount",
    meaning: "Count of HUMAN_OVERRIDE / human.override / approval.rejected sources",
    not: "AI_WRONG",
  },
  reAskCount: {
    key: "reAskCount",
    meaning: "Count of RE_ASK_SIGNAL / human.reask sources",
    not: "dissatisfaction",
  },
  durableCaptureGap: {
    key: "durableCaptureGap",
    meaning: "canonical events minus outbox envelopes when capture is ON",
    not: "AI quality",
  },
  projectionGap: {
    key: "projectionGap",
    meaning: "mapped source events minus projected AutopilotRunEvent",
    not: "AI quality",
  },
  humanSignalProjectionGap: {
    key: "humanSignalProjectionGap",
    meaning: "human signal sources minus projected HUMAN_* events",
    not: "employee score",
  },
  toolOrphans: {
    key: "toolOrphans",
    meaning: "tool.started without matching terminal (or unmatched terminal)",
    not: "tool is bad",
  },
  modelOrphans: {
    key: "modelOrphans",
    meaning: "model.started without matching terminal",
    not: "model is bad",
  },
  retrievalOrphans: {
    key: "retrievalOrphans",
    meaning: "retrieval.started without matching terminal",
    not: "retrieval is bad",
  },
  unknownEventTypeCount: {
    key: "unknownEventTypeCount",
    meaning: "canonical event types not in Autopilot map",
    not: "failures",
  },
  unlinkedHumanSignalCount: {
    key: "unlinkedHumanSignalCount",
    meaning: "human-signal-shaped events missing sourceAgentRunId",
    not: "AI_WRONG",
  },
} as const;

export type ObserveMetricKey = keyof typeof OBSERVE_METRIC_DEFINITIONS;

export function observeMetricMapsToAiWrong(key: ObserveMetricKey): boolean {
  return false;
}

export function humanEditMapsToAiWrong(): boolean {
  return false;
}
