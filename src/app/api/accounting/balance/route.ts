/**
 * GET /api/accounting/balance?orgId
 * INSTALL-2b：装完待收尾款列表——pending（已安装 / 已完成且无尾款确认记录）+ recentConfirmed（最近 30 条）。
 * 需当前企业 ORG 范围的 install.balance.confirm（会计 / 老板），否则 403。
 * 不输出成本 / 毛利 / 提成 / 客户联系方式 / 报价备注与表单原文。
 * INSTALL-2c：recentConfirmed 每条带质保邮件状态（warranty）。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireAccountingPermissions } from "@/lib/accounting/access";
import { BALANCE_PERMISSION, listBalance } from "@/lib/install/balance-service";
import { loadWarrantyStatuses } from "@/lib/install/warranty-service";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireAccountingPermissions(user, orgRes.orgId, [BALANCE_PERMISSION]);
  if (denied) return denied;
  const data = await listBalance(orgRes.orgId);
  const statuses = await loadWarrantyStatuses(orgRes.orgId, data.recentConfirmed.map((r) => r.orderId));
  return NextResponse.json({
    ...data,
    recentConfirmed: data.recentConfirmed.map((r) => ({ ...r, warranty: statuses.get(r.orderId) ?? null })),
  });
});
