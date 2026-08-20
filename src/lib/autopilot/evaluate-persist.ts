/**
 * Persist A2-P0 deterministic evaluation after Observe projection.
 * Does not change AutopilotRun.outcome (Observe remains non-evaluative persist).
 */

import { evaluateDeterministicRun } from "./evaluate";
import { upsertAutopilotEvaluation } from "./repository";

export async function persistDeterministicEvaluation(input: {
  orgId: string;
  agentRunId: string;
  autopilotRunId: string;
  status?: string | null;
  errorCode?: string | null;
  humanOverride?: boolean;
  humanEdit?: boolean;
  reAskStatus?: string | null;
  cancelled?: boolean;
}): Promise<void> {
  const reAsk =
    input.reAskStatus === "CONFIRMED" || input.reAskStatus === "CANDIDATE";
  const evaluation = evaluateDeterministicRun({
    status: input.status,
    errorCode: input.errorCode,
    humanOverride: input.humanOverride,
    humanEdit: input.humanEdit,
    reAsk,
    cancelled: input.cancelled,
  });

  await upsertAutopilotEvaluation({
    orgId: input.orgId,
    agentRunId: input.agentRunId,
    autopilotRunId: input.autopilotRunId,
    evaluatorKind: evaluation.evaluatorKind,
    evaluatorVersion: evaluation.evaluatorVersion,
    outcome: evaluation.outcome,
    failureType: evaluation.failureType,
    failureSource: evaluation.failureSource,
    judged: evaluation.judged,
    ruleId: evaluation.ruleId,
    evidence: evaluation.evidence,
  });
}
