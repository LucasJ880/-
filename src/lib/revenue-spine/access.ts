/**
 * Revenue Spine — API 访问控制（安全原则 §二十六）
 *
 * - 组织解析复用 Security-1 的 resolveTradeOrgId（activeOrgId + active membership；只有平台 super_admin 可显式指定企业）
 * - PERM-6c：按外贸权限键（与外贸接口同一守卫 requireTradePermission）：
 *   读 = trade.read / trade.manage；写 = trade.manage；发布策略 = trade.settings.manage（读策略三键任一）；平台 super_admin 全权。
 *   平台角色（trade / sales / boss / manager / admin）不再单独放行
 * - 数据范围：ORG（梦馨 1–3 人团队；Sunny 车道不经此 API）
 * - 发送仍必须经 PendingAction 审批
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthResult } from "@/lib/auth/guards";
import {
  TRADE_MANAGE,
  TRADE_READ,
  TRADE_SETTINGS_MANAGE,
  requireTradePermission,
  resolveTradeOrgId,
} from "@/lib/trade/access";

export {
  TRADE_MANAGE_KEYS as REVENUE_MANAGE_KEYS,
  TRADE_READ_KEYS as REVENUE_READ_KEYS,
  TRADE_SETTINGS_KEYS as REVENUE_SETTINGS_KEYS,
} from "@/lib/trade/access";

/** 读取策略：读写键或设置键任一（只管设置的企业管理员要先看到当前策略才能发布） */
export const REVENUE_POLICY_READ_KEYS = [TRADE_READ, TRADE_MANAGE, TRADE_SETTINGS_MANAGE] as const;

export type RevenueAccess = { ok: true; orgId: string; auth: AuthResult } | { ok: false; response: NextResponse };

export async function resolveRevenueAccess(
  request: NextRequest,
  keys: readonly string[],
  opts?: { bodyOrgId?: string | null },
): Promise<RevenueAccess> {
  const auth = await requireTradePermission(request, keys);
  if (auth instanceof NextResponse) return { ok: false, response: auth };
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: opts?.bodyOrgId ?? null });
  if (!orgRes.ok) return { ok: false, response: orgRes.response };
  return { ok: true, orgId: orgRes.orgId, auth };
}
