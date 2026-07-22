/**
 * 模型调用前月费用预检（estimated）
 * 账本写入失败不得绕过本检查；调用方在发起模型前调用。
 */

import { evaluateQuota } from "./evaluate";

export async function precheckMonthlyAiCost(opts: {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  /** 估算增量（USD），默认保守 0.05 */
  estimatedCost?: number;
}): Promise<{ allowed: boolean; reasonCode?: string; level: string }> {
  if (!opts.orgId?.trim()) {
    return { allowed: false, reasonCode: "missing_orgId", level: "HARD_LIMIT" };
  }
  const ev = await evaluateQuota({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    metric: "MONTHLY_AI_COST",
    requestedAmount: opts.estimatedCost ?? 0.05,
  });
  return {
    allowed: ev.allowed,
    reasonCode: ev.reasonCode,
    level: ev.level,
  };
}
