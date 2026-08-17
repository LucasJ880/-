/**
 * Per-run observability integrity for A1-P3.
 * AutopilotRun existence is not HEALTHY. Overlay absence is not always GAP.
 * Null means not provable — never coerce null to zero.
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
  unknownEventTypeCount: number;
  unlinkedHumanSignalCount: number;
}): ObserveRunHealth {
  if (input.eventCount <= 0) return "UNKNOWN";

  if (
    input.toolOrphans > 0 ||
    input.modelOrphans > 0 ||
    input.retrievalOrphans > 0
  ) {
    return "ORPHAN";
  }

  const knownCaptureGap =
    typeof input.durableCaptureGap === "number" && input.durableCaptureGap > 0;
  const knownHumanGap =
    typeof input.humanSignalProjectionGap === "number" &&
    input.humanSignalProjectionGap > 0;
  if (
    knownCaptureGap ||
    input.projectionGap > 0 ||
    knownHumanGap ||
    input.unlinkedHumanSignalCount > 0
  ) {
    return "GAP";
  }

  if (
    input.durableCaptureGap == null ||
    input.humanSignalProjectionGap == null
  ) {
    return "UNKNOWN";
  }

  if (input.unknownEventTypeCount > 0) return "UNKNOWN";

  return "HEALTHY";
}

export function isObserveRunIntegrityIssue(health: ObserveRunHealth): boolean {
  return health === "GAP" || health === "ORPHAN";
}
