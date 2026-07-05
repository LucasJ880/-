/**
 * 供应商资源级访问守卫
 *
 * 按 supplier.orgId 校验当前用户是否有权访问（复用统一 org 解析规则：
 * 管理员放行已存在组织；普通用户必须是该组织 active 成员）。
 */

import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import type { Supplier } from "@prisma/client";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { getSupplier } from "./service";

export type SupplierAccessResult =
  | { ok: true; supplier: Supplier }
  | { ok: false; response: NextResponse };

export async function requireSupplierOrgAccess(
  user: AuthUser,
  supplierId: string,
): Promise<SupplierAccessResult> {
  const supplier = await getSupplier(supplierId);
  if (!supplier) {
    return {
      ok: false,
      response: NextResponse.json({ error: "供应商不存在" }, { status: 404 }),
    };
  }

  const resolved = await resolveRequestOrgIdForUser(user, supplier.orgId);
  if (!resolved.ok) {
    // 统一 403，不向无权用户泄露供应商归属信息
    return {
      ok: false,
      response: NextResponse.json({ error: "无权访问该供应商" }, { status: 403 }),
    };
  }

  return { ok: true, supplier };
}
