/**
 * 仅测试环境启用的 handoff 故障注入。
 * 必须同时满足：
 *   ALLOW_HANDOFF_FAULT_INJECTION=true
 *   HANDOFF_FAULT_POINT=<point>
 * 且非 production。
 * 禁止通过公开 API 参数触发。
 */

export type HandoffFaultPoint =
  | "before_processing"
  | "after_delivery_created"
  | "after_source_link"
  | "after_first_task"
  | "after_all_tasks"
  | "on_audit_log"
  | "before_completed_update"
  | "after_completed_before_response";

const ALLOWED = new Set<HandoffFaultPoint>([
  "before_processing",
  "after_delivery_created",
  "after_source_link",
  "after_first_task",
  "after_all_tasks",
  "on_audit_log",
  "before_completed_update",
  "after_completed_before_response",
]);

export function isHandoffFaultInjectionEnabled(): boolean {
  if (process.env.ALLOW_HANDOFF_FAULT_INJECTION !== "true") return false;
  if (process.env.NODE_ENV === "production") return false;
  const point = process.env.HANDOFF_FAULT_POINT;
  return Boolean(point && ALLOWED.has(point as HandoffFaultPoint));
}

export function getActiveHandoffFaultPoint(): HandoffFaultPoint | null {
  if (!isHandoffFaultInjectionEnabled()) return null;
  const point = process.env.HANDOFF_FAULT_POINT as HandoffFaultPoint;
  return ALLOWED.has(point) ? point : null;
}

export function maybeInjectHandoffFault(point: HandoffFaultPoint): void {
  if (getActiveHandoffFaultPoint() !== point) return;
  throw new Error(`HANDOFF_FAULT_INJECTED:${point}`);
}
