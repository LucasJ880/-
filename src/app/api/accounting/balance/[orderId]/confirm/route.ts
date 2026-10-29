/**
 * POST /api/accounting/balance/[orderId]/confirm   JSON { amount, method, receivedAt, note, orgId? }
 * INSTALL-2b：确认收到尾款。
 * - 需 ORG 范围的 install.balance.confirm，否则 403；工艺单不属本企业 404；未安装 409 NOT_INSTALLED
 * - 金额 > 0 且最多两位小数；方式 cash / visa / check / finance；收款日期不晚于企业当天；差额须备注（400 NOTE_REQUIRED）
 * - 写审计 install.balance.confirmed；installed → completed（状态日志"尾款确认"）；重复确认 200 idempotent
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireAccountingPermissions } from "@/lib/accounting/access";
import { BALANCE_PERMISSION, confirmBalance } from "@/lib/install/balance-service";

export const POST = withAuth<{ orderId: string }>(async (request, ctx, user) => {
  const { orderId } = await ctx.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "需要 JSON 请求体", code: "INVALID" }, { status: 400 });
  }
  const bodyOrgId =
    body && typeof body === "object" && typeof (body as { orgId?: unknown }).orgId === "string"
      ? (body as { orgId: string }).orgId
      : request.nextUrl.searchParams.get("orgId");
  const orgRes = await resolveRequestOrgIdForUser(user, bodyOrgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireAccountingPermissions(user, orgRes.orgId, [BALANCE_PERMISSION]);
  if (denied) return denied;
  const result = await confirmBalance({ orgId: orgRes.orgId, userId: user.id, orderId, body });
  return NextResponse.json(result.body, { status: result.status });
});
