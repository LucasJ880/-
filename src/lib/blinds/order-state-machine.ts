/**
 * 工单状态机 — 定义合法的状态流转
 *
 * draft → confirmed → in_production → ready → scheduled → installed → completed
 *                 ↘ cancelled (任意非终态可取消)
 */

export const ORDER_STATUSES = [
  "draft",
  "confirmed",
  "in_production",
  "ready",
  "scheduled",
  "installed",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "草稿",
  confirmed: "已确认",
  in_production: "生产中",
  ready: "待安装",
  scheduled: "已排期",
  installed: "已安装",
  completed: "已完工",
  cancelled: "已取消",
};

export const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  confirmed: "bg-blue-100 text-blue-700",
  in_production: "bg-indigo-100 text-indigo-700",
  ready: "bg-amber-100 text-amber-700",
  scheduled: "bg-cyan-100 text-cyan-700",
  installed: "bg-emerald-100 text-emerald-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
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
