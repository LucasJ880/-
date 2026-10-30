/**
 * PERM-5a：会计视图权限判定（路由只调这里）
 *   成交与提成：accounting.read（ORG）
 *   报价过程：accounting.read + sales.quote.read（均 ORG）
 *   项目结算：project.finance.read（ORG = 全企业；ASSIGNED = 本人参与的项目）
 */

import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";

export const ACCOUNTING_READ = "accounting.read";
export const PROJECT_FINANCE_READ = "project.finance.read";

/** 全部键都须以 ORG 范围允许 */
export async function holdsOrgPermissions(user: AuthUser, orgId: string, keys: readonly string[]): Promise<boolean> {
  for (const permission of keys) {
    const d = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission });
    if (!d.allowed || !d.scopes.includes("ORG")) return false;
  }
  return true;
}

export async function requireAccountingPermissions(
  user: AuthUser,
  orgId: string,
  keys: readonly string[],
): Promise<NextResponse | null> {
  if (await holdsOrgPermissions(user, orgId, keys)) return null;
  return NextResponse.json({ error: "无权查看会计数据", code: "ACCOUNTING_PERMISSION_REQUIRED" }, { status: 403 });
}

export type ProjectFinanceScope = "ORG" | "ASSIGNED" | null;

/** 项目结算可见范围：ORG 优先；只有 ASSIGNED → 参与项目；无 → null */
export async function resolveProjectFinanceScope(user: AuthUser, orgId: string): Promise<ProjectFinanceScope> {
  const d = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission: PROJECT_FINANCE_READ });
  if (!d.allowed) return null;
  if (d.scopes.includes("ORG")) return "ORG";
  if (d.scopes.includes("ASSIGNED")) return "ASSIGNED";
  return null;
}
