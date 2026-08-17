/**
 * Deterministic observability health — not AI quality, not run failure.
 */

export type ObservabilityHealthState =
  | "NOT_ACTIVE"
  | "HEALTHY"
  | "DEGRADED"
  | "UNKNOWN";

export type ObservabilityHealthInput = {
  telemetryReadEnabled: boolean;
  coverageAvailable: boolean;
  durableCaptureGap: number | null;
  projectionGap: number | null;
  humanSignalProjectionGap: number | null;
  toolOrphans: number | null;
  modelOrphans: number | null;
  retrievalOrphans: number | null;
  unknownEventTypeCount: number | null;
  unlinkedHumanSignalCount: number | null;
};

function positive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function observabilityHealthState(
  input: ObservabilityHealthInput,
): ObservabilityHealthState {
  if (!input.telemetryReadEnabled) return "NOT_ACTIVE";
  if (!input.coverageAvailable) return "UNKNOWN";
  const integrity = [
    input.durableCaptureGap,
    input.projectionGap,
    input.humanSignalProjectionGap,
    input.toolOrphans,
    input.modelOrphans,
    input.retrievalOrphans,
    input.unknownEventTypeCount,
    input.unlinkedHumanSignalCount,
  ];
  if (integrity.some((v) => v == null)) return "UNKNOWN";
  if (integrity.some((v) => positive(v))) return "DEGRADED";
  return "HEALTHY";
}

export function healthTone(
  state: ObservabilityHealthState,
): "neutral" | "ok" | "warn" | "unknown" {
  if (state === "HEALTHY") return "ok";
  if (state === "DEGRADED") return "warn";
  if (state === "UNKNOWN") return "unknown";
  return "neutral";
}
