/**
 * Autopilot A2-P2.1 — pure adapter onto P2.0 EvaluationEvidenceStatus.
 *
 * Does not call routeEvaluation(). Runtime wiring is out of scope.
 */

import type { EvaluationEvidenceStatus } from "./a2p2-contract";
import type { EvidencePacketStatus } from "./a2p2-evidence-types";

export function toEvaluationEvidenceStatus(
  status: EvidencePacketStatus,
): EvaluationEvidenceStatus {
  if (status === "SUFFICIENT") return "SUFFICIENT";
  if (status === "INSUFFICIENT") return "INSUFFICIENT";
  if (status === "CONFLICTING") return "CONFLICTING";
  if (status === "PRIVACY_BLOCKED") return "PRIVACY_BLOCKED";
  return "INSUFFICIENT";
}
