/**
 * Autopilot feature flag。
 * 总开关不是身份权限：ENABLED=true 仍必须通过 Lucas owner 检查。
 */

export type AutopilotFlagEnv = Record<string, string | undefined>;

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function isAutopilotEnabled(env: AutopilotFlagEnv = process.env): boolean {
  return envBool(env.AUTOPILOT_ENABLED);
}

/**
 * Canonical Autopilot owner user IDs（稳定 User.id，不是显示名）。
 * 未配置 = 无人拥有 = Default Deny。
 */
export function getAutopilotOwnerUserIds(
  env: AutopilotFlagEnv = process.env,
): string[] {
  return envList(env.AUTOPILOT_OWNER_USER_IDS);
}

export function isAutopilotInstrumentationEnabled(
  env: AutopilotFlagEnv = process.env,
): boolean {
  return isAutopilotTelemetryCaptureEnabled(env);
}

/** Durable outbox capture。默认 OFF；与 Lucas UI 开关解耦。 */
export function isAutopilotTelemetryCaptureEnabled(
  env: AutopilotFlagEnv = process.env,
): boolean {
  return envBool(env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED);
}

/** Outbox processor / cron drain。默认 OFF。 */
export function isAutopilotProcessorEnabled(
  env: AutopilotFlagEnv = process.env,
): boolean {
  return envBool(env.AUTOPILOT_PROCESSOR_ENABLED);
}

/**
 * Observe Dashboard 是否允许读取 Autopilot overlay / outbox 表。
 * Capture 与 Processor 都 OFF 时必须短路，禁止查询可能尚未 migrate 的表。
 */
export function isAutopilotObserveTelemetryReadEnabled(
  env: AutopilotFlagEnv = process.env,
): boolean {
  return (
    isAutopilotTelemetryCaptureEnabled(env) ||
    isAutopilotProcessorEnabled(env)
  );
}

export function describeAutopilotFlag(
  env: AutopilotFlagEnv = process.env,
): Record<string, unknown> {
  const owners = getAutopilotOwnerUserIds(env);
  return {
    enabled: isAutopilotEnabled(env),
    ownerCount: owners.length,
    instrumentation: isAutopilotInstrumentationEnabled(env),
    telemetryCapture: isAutopilotTelemetryCaptureEnabled(env),
    processor: isAutopilotProcessorEnabled(env),
    observeTelemetryRead: isAutopilotObserveTelemetryReadEnabled(env),
  };
}
