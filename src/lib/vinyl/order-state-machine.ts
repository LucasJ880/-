/**
 * Vinyl 工单状态机 —— 与 Blinds 的 order-state-machine 同构，
 * 但两套工单表分开，状态流转互不影响。
 */

export const VINYL_ORDER_STATUSES = [
  "draft", "confirmed", "in_production", "ready", "scheduled", "installed", "completed", "cancelled",
] as const;

export type VinylOrderStatus = (typeof VINYL_ORDER_STATUSES)[number];

export const VINYL_STATUS_LABELS: Record<VinylOrderStatus, string> = {
  draft: "草稿",
  confirmed: "已确认",
  in_production: "生产中",
  ready: "待安装",
  scheduled: "已排期",
  installed: "已安装",
  completed: "已完工",
  cancelled: "已取消",
};

const TRANSITIONS: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["in_production", "cancelled"],
  in_production: ["ready", "cancelled"],
  ready: ["scheduled", "cancelled"],
  scheduled: ["installed", "cancelled"],
  installed: ["completed"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function getNextStatuses(current: string): string[] {
  return TRANSITIONS[current] ?? [];
}

export function timestampField(status: string): string | null {
  const map: Record<string, string> = {
    confirmed: "confirmedAt",
    in_production: "productionStartAt",
    ready: "readyAt",
    scheduled: "scheduledAt",
    installed: "installedAt",
    completed: "completedAt",
    cancelled: "cancelledAt",
  };
  return map[status] ?? null;
}
