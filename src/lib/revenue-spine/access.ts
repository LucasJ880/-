/**
 * Revenue Spine — API 访问控制（安全原则 §二十六）
 *
 * - 组织解析复用 Security-1 的 resolveTradeOrgId（activeOrgId + active membership；平台 admin 须显式 orgId）
 * - 平台角色白名单：trade / sales / boss / manager（admin 由 requireRole 直接放行）
 * - 数据范围：ORG（梦馨 1–3 人团队；Sunny 车道不经此 API）
 * - 写操作：同样白名单（发送仍必须经 PendingAction 审批）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole, type AuthResult } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";

export const REVENUE_SPINE_ROLES = ["trade", "sales", "boss", "manager", "admin"] as const;

export type RevenueAccess = { ok: true; orgId: string; auth: AuthResult } | { ok: false; response: NextResponse };

export async function resolveRevenueAccess(request: NextRequest, opts?: { bodyOrgId?: string | null }): Promise<RevenueAccess> {
  const auth = await requireRole(request, [...REVENUE_SPINE_ROLES]);
  if (auth instanceof NextResponse) return { ok: false, response: auth };
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: opts?.bodyOrgId ?? null });
  if (!orgRes.ok) return { ok: false, response: orgRes.response };
  return { ok: true, orgId: orgRes.orgId, auth };
}

/** 纯函数：角色矩阵（供单测） */
export function roleCanAccessRevenueSpine(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role === "super_admin" ? "admin" : role;
  return (REVENUE_SPINE_ROLES as readonly string[]).includes(r);
}
