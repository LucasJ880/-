/**
 * MMM 预算情景状态机（只改库内 status，不触达广告平台）。
 */

export const MMM_SCENARIO_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
] as const;

export type MmmScenarioStatus = (typeof MMM_SCENARIO_STATUSES)[number];

const ALLOWED: Record<MmmScenarioStatus, readonly MmmScenarioStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function isMmmScenarioStatus(value: unknown): value is MmmScenarioStatus {
  return (
    typeof value === "string" &&
    (MMM_SCENARIO_STATUSES as readonly string[]).includes(value)
  );
}

/** 返回 null 表示合法；否则为错误文案 */
export function validateScenarioTransition(
  from: string,
  to: string,
): string | null {
  if (!isMmmScenarioStatus(from)) return `未知当前状态：${from}`;
  if (!isMmmScenarioStatus(to)) return `未知目标状态：${to}`;
  if (from === to) return null;
  if (!ALLOWED[from].includes(to)) {
    return `不允许从 ${from} 转到 ${to}`;
  }
  return null;
}

export function formatAllocations(
  allocations: unknown,
): Array<{ channel: string; amount: number }> {
  if (!allocations || typeof allocations !== "object") return [];
  if (Array.isArray(allocations)) {
    return allocations
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const record = row as Record<string, unknown>;
        const channel = String(record.channel || record.name || "").trim();
        const amount = Number(record.amount ?? record.budget ?? record.spend ?? 0);
        if (!channel) return null;
        return { channel, amount: Number.isFinite(amount) ? amount : 0 };
      })
      .filter((row): row is { channel: string; amount: number } => Boolean(row));
  }
  return Object.entries(allocations as Record<string, unknown>).map(
    ([channel, value]) => ({
      channel,
      amount: Number.isFinite(Number(value)) ? Number(value) : 0,
    }),
  );
}
