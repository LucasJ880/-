export const SALES_ACTION_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "dismissed",
] as const;

export type SalesActionStatus = (typeof SALES_ACTION_STATUSES)[number];

export function isSalesActionStatus(value: unknown): value is SalesActionStatus {
  return typeof value === "string" && SALES_ACTION_STATUSES.includes(value as SalesActionStatus);
}

export function canTransitionSalesAction(
  current: SalesActionStatus,
  next: SalesActionStatus,
): boolean {
  if (current === next) return true;
  if (current === "completed" || current === "dismissed") return false;
  return ["open", "in_progress", "completed", "dismissed"].includes(next);
}

export function validateSalesActionResolution(input: {
  status: SalesActionStatus;
  resolutionNote?: string | null;
  dismissedReason?: string | null;
}): string | null {
  if (input.status === "completed" && !input.resolutionNote?.trim()) {
    return "完成行动时请填写处理结果";
  }
  if (input.status === "dismissed" && !input.dismissedReason?.trim()) {
    return "忽略行动时请填写原因";
  }
  return null;
}

function compactKeyPart(value: string | null | undefined): string {
  return (value ?? "none").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80);
}

export function buildSalesActionActiveKey(input: {
  orgId: string;
  customerId: string;
  opportunityId?: string | null;
  signalKey: string;
}): string {
  return [input.orgId, input.customerId, input.opportunityId ?? "none", compactKeyPart(input.signalKey)].join(":");
}

export function defaultSalesActionDueAt(
  priority: "urgent" | "high" | "medium" | "low",
  now = new Date(),
): Date {
  const hours = priority === "urgent" ? 8 : priority === "high" ? 24 : priority === "medium" ? 72 : 168;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export type SalesActionMetricInput = {
  status: string;
  dueAt: Date | string | null;
  completedAt?: Date | string | null;
};

export function summarizeSalesActions(items: SalesActionMetricInput[], now = new Date()) {
  const nowMs = now.getTime();
  const active = items.filter((item) => item.status === "open" || item.status === "in_progress");
  const completed = items.filter((item) => item.status === "completed");
  const dismissed = items.filter((item) => item.status === "dismissed");
  const overdue = active.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < nowMs);
  const resolvedCount = completed.length + dismissed.length;
  return {
    open: active.length,
    overdue: overdue.length,
    completed: completed.length,
    dismissed: dismissed.length,
    completionRate: resolvedCount > 0 ? Math.round((completed.length / resolvedCount) * 100) : null,
  };
}
