/**
 * Per-run observability integrity for A1-P3.
 * AutopilotRun existence is not HEALTHY. Overlay absence is not always GAP.
 */

export type ObserveRunHealth = "HEALTHY" | "GAP" | "ORPHAN" | "UNKNOWN";

export function perRunObservabilityHealth(input: {
  eventCount: number;
  durableCaptureGap: number | null;
  projectionGap: number;
  humanSignalProjectionGap: number | null;
  toolOrphans: number;
  modelOrphans: number;
  retrievalOrphans: number;
}): ObserveRunHealth {
  if (input.eventCount <= 0) return "UNKNOWN";
  if (
    input.toolOrphans > 0 ||
    input.modelOrphans > 0 ||
    input.retrievalOrphans > 0
  ) {
    return "ORPHAN";
  }
  if (
    (input.durableCaptureGap ?? 0) > 0 ||
    input.projectionGap > 0 ||
    (input.humanSignalProjectionGap ?? 0) > 0
  ) {
    return "GAP";
  }
  return "HEALTHY";
}

export function isObserveRunIntegrityIssue(health: ObserveRunHealth): boolean {
  return health === "GAP" || health === "ORPHAN";
}
