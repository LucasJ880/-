/**
 * Supplier Intelligence 访问门（对齐 quote-engine 404-dark 模式）：
 * flag 检查在任何 auth/DB 之前 → OFF 时 404（禁用与不存在不可区分，无存在性泄漏）；
 * 然后 canonical requireTenantContext（trusted principal，orgId/userId 只来自服务端上下文）；
 * 最后 org allowlist。复用既有租户体系，不建第二套鉴权。
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantContext, type TenantContext } from "@/lib/tenancy/context";
import { isSupplierIntelEnabled, isSupplierIntelEnabledForOrg } from "./flags";

function disabledResponse(): NextResponse {
  return NextResponse.json({ error: "供应商情报未启用" }, { status: 404 });
}

export async function requireSupplierIntelAccess(
  request: NextRequest,
): Promise<TenantContext | NextResponse> {
  if (!isSupplierIntelEnabled()) return disabledResponse();
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;
  if (!isSupplierIntelEnabledForOrg(tenant.orgId)) return disabledResponse();
  return tenant;
}
