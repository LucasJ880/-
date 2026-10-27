/**
 * PERM-2：销售设置修改走审批 —— payload 构造与幂等键（纯函数）
 *
 * payload 只含校验后的数值 diff、品类成本率、解锁码哈希；绝不含解锁码明文。
 */

import { computePayloadHash } from "@/lib/capabilities/approvals/integrity";
import type { SalesUpdateQuoteSettingsPayload } from "@/lib/pending-actions/types";

export const QUOTE_SETTINGS_ACTION_TYPE = "sales.update_quote_settings" as const;

export function buildQuoteSettingsApprovalPayload(input: {
  orgId: string;
  requestedById: string;
  settingsVersion: number;
  numericPatch: Record<string, number>;
  costRates?: Record<string, number>;
  depositOverrideCodeHash?: string | null;
  lineDiscountUnlockCodeHash?: string | null;
}): SalesUpdateQuoteSettingsPayload {
  const payload: SalesUpdateQuoteSettingsPayload = {
    orgId: input.orgId,
    requestedById: input.requestedById,
    settingsVersion: input.settingsVersion,
    numericPatch: { ...input.numericPatch },
    resourceType: "quote_discount_settings",
    resourceId: input.orgId,
    riskLevel: "CRITICAL",
    metadata: { orgId: input.orgId, targetType: "quote_discount_settings", targetId: input.orgId, source: "quote_settings" },
  };
  if (input.costRates !== undefined) payload.costRates = { ...input.costRates };
  if (input.depositOverrideCodeHash !== undefined) payload.depositOverrideCodeHash = input.depositOverrideCodeHash;
  if (input.lineDiscountUnlockCodeHash !== undefined) payload.lineDiscountUnlockCodeHash = input.lineDiscountUnlockCodeHash;
  return payload;
}

/** 同企业、同设置版本、同内容 → 同一键；执行后版本加一，键自然失效 */
export function quoteSettingsIdempotencyKey(payload: SalesUpdateQuoteSettingsPayload): string {
  const content = {
    numericPatch: payload.numericPatch,
    costRates: payload.costRates ?? null,
    depositOverrideCodeHash: payload.depositOverrideCodeHash ?? undefined,
    lineDiscountUnlockCodeHash: payload.lineDiscountUnlockCodeHash ?? undefined,
    requestedById: payload.requestedById,
  };
  return `quote-settings:${payload.orgId}:v${payload.settingsVersion}:${computePayloadHash(content).slice(0, 24)}`;
}

/** 审批中心展示用：不含任何码值 */
export function describeQuoteSettingsPatch(payload: SalesUpdateQuoteSettingsPayload): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload.numericPatch)) parts.push(`${k}=${v}`);
  if (payload.costRates) parts.push(`成本率 ${Object.keys(payload.costRates).length} 项`);
  if (payload.depositOverrideCodeHash !== undefined) parts.push(payload.depositOverrideCodeHash === null ? "清空定金解锁码" : "更新定金解锁码");
  if (payload.lineDiscountUnlockCodeHash !== undefined) parts.push(payload.lineDiscountUnlockCodeHash === null ? "清空行折扣解锁码" : "更新行折扣解锁码");
  return parts.length ? parts.join("，") : "（无变化）";
}
