/**
 * PERM-2：合价上限（设计稿 §2.3 / §4-6）
 *
 * 存储：Organization.settingsJson.pricing.leadMaxPct（零 schema）；默认 0.35。
 * 规则：非 0~1 有限数回落默认；不低于销售上限 promoMaxPct。
 */

import { db } from "@/lib/db";

export const DEFAULT_LEAD_MAX_PCT = 0.35;

/** 纯函数：从 settingsJson 读合价上限，坏数据回落默认 */
export function readLeadMaxPct(settingsJson: unknown): number {
  if (!settingsJson || typeof settingsJson !== "object") return DEFAULT_LEAD_MAX_PCT;
  const pricing = (settingsJson as Record<string, unknown>).pricing;
  if (!pricing || typeof pricing !== "object") return DEFAULT_LEAD_MAX_PCT;
  const raw = (pricing as Record<string, unknown>).leadMaxPct;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    return DEFAULT_LEAD_MAX_PCT;
  }
  return raw;
}

export type PricingPolicy = {
  /** 销售上限（来自 QuoteDiscountSettings.promoMaxPct） */
  promoMaxPct: number;
  /** 合价上限（≥ promoMaxPct） */
  leadMaxPct: number;
};

/** 纯函数：合价上限不低于销售上限 */
export function resolvePricingPolicy(settingsJson: unknown, promoMaxPct: number): PricingPolicy {
  const lead = readLeadMaxPct(settingsJson);
  return { promoMaxPct, leadMaxPct: Math.max(lead, promoMaxPct) };
}

export async function loadPricingPolicy(orgId: string, promoMaxPct: number): Promise<PricingPolicy> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { settingsJson: true },
  });
  return resolvePricingPolicy(org?.settingsJson ?? null, promoMaxPct);
}
