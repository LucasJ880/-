/**
 * POST /api/accounting/balance/[orderId]/warranty   JSON { orgId? }
 * INSTALL-2c：（重新）生成完工 + 质保邮件审批。不发信，发信只在审批执行器。
 * - 需 ORG 范围 install.balance.confirm，否则 403；工艺单不属本企业 404
 * - 未确认尾款 409 NOT_CONFIRMED；已发送 409 ALREADY_SENT；已有待批准 → 200 返回该审批
 * - 缺资料 → 200 { status: "blocked", blockers }；否则 200 { status: "pending_approval", approvalId, preview }
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireAccountingPermissions } from "@/lib/accounting/access";
import { BALANCE_PERMISSION, loadBalanceRecords } from "@/lib/install/balance-service";
import { generateWarrantyApproval } from "@/lib/install/warranty-service";

export const POST = withAuth<{ orderId: string }>(async (request, ctx, user) => {
  const { orderId } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    body = {};
  }
  const orgRes = await resolveRequestOrgIdForUser(user, typeof body.orgId === "string" ? body.orgId : request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireAccountingPermissions(user, orgRes.orgId, [BALANCE_PERMISSION]);
  if (denied) return denied;

  const g = await generateWarrantyApproval({ orgId: orgRes.orgId, orderId, approverUserId: user.id });
  if (g.kind === "not_found") return NextResponse.json({ error: "工艺单不存在", code: "NOT_FOUND" }, { status: 404 });
  if (g.kind === "error") return NextResponse.json({ error: `生成审批失败：${g.message}`, code: "APPROVAL_FAILED" }, { status: 500 });
  if (g.kind === "sent") return NextResponse.json({ error: "该单质保邮件已发送", code: "ALREADY_SENT", warranty: g.view }, { status: 409 });
  if (!(await loadBalanceRecords([orderId])).has(orderId)) {
    return NextResponse.json({ error: "该单尚未确认尾款", code: "NOT_CONFIRMED" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, warranty: g.view });
});
