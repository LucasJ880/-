/**
 * A1-P3 Observe Dashboard read gate.
 * Dark / inactive telemetry must short-circuit BEFORE Autopilot table queries.
 * Catching a missing-table database error is not an acceptable safety strategy.
 */

import {
  isAutopilotObserveTelemetryReadEnabled,
  isAutopilotProcessorEnabled,
  isAutopilotTelemetryCaptureEnabled,
  type AutopilotFlagEnv,
} from "./flags";
import { AUTOMATIC_RECONCILER_TRIGGER } from "./reconcile-cursor";

/**
 * DESIGN NOTE ONLY (A1-P3).
 * Production activation must introduce an ACTIVATION_WATERMARK / NOT-BEFORE
 * so the Human Signal reconciler only processes facts after activation.
 * Do not implement Production activation or historical full backfill here.
 */
export const ACTIVATION_WATERMARK =
  "REQUIRED_BEFORE_PRODUCTION_ACTIVATION" as const;

export type ObserveMode = "OBSERVE" | "DARK";

export type DarkObserveState = {
  active: false;
  observeState: "NOT_ACTIVE";
  mode: "DARK";
  capture: "ON" | "OFF";
  processor: "ON" | "OFF";
  productionActivation: "OFF";
  productionTelemetryActive: false;
  message: string;
  reconciler: typeof AUTOMATIC_RECONCILER_TRIGGER;
  activationWatermark: typeof ACTIVATION_WATERMARK;
};

const queryCounter = { count: 0 };

export function resetAutopilotTableQueryCount(): void {
  queryCounter.count = 0;
}

export function getAutopilotTableQueryCount(): number {
  return queryCounter.count;
}

/** Call immediately before any AutopilotTelemetryOutbox / AutopilotRun / AutopilotRunEvent query. */
export function noteAutopilotTableQuery(): void {
  queryCounter.count += 1;
}

export function isObserveTelemetryReadEnabled(
  env: AutopilotFlagEnv = process.env,
): boolean {
  return isAutopilotObserveTelemetryReadEnabled(env);
}

export function darkObserveState(
  env: AutopilotFlagEnv = process.env,
): DarkObserveState {
  return {
    active: false,
    observeState: "NOT_ACTIVE",
    mode: "DARK",
    capture: isAutopilotTelemetryCaptureEnabled(env) ? "ON" : "OFF",
    processor: isAutopilotProcessorEnabled(env) ? "ON" : "OFF",
    productionActivation: "OFF",
    productionTelemetryActive: false,
    message: "Autopilot Observe is not active in this environment.",
    reconciler: AUTOMATIC_RECONCILER_TRIGGER,
    activationWatermark: ACTIVATION_WATERMARK,
  };
}

export function observeMode(env: AutopilotFlagEnv = process.env): ObserveMode {
  return isObserveTelemetryReadEnabled(env) ? "OBSERVE" : "DARK";
}
