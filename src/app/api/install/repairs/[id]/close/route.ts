/**
 * POST /api/install/repairs/[id]/close  JSON { reason, orgId? }
 * INSTALL-2f：关闭不返修（spec installation/repairs「关闭不返修」；design D3）。
 * - 需 install.task.assign（ORG）→ 403；他企业 404；原因为空或超过 500 字 → 400
 * - 已关闭 → 409 CLOSED；工艺单不是已排期 → 409 ORDER_STATUS
 * - 成功：install.repair.completed（waived）；取消未完成的返修预约，工艺单指回提交预约；
 *   无其他未关闭维修单时 scheduled → installed（状态日志"关闭不返修（R-…）"）并发 2b 完工通知
 * - 通知提交时的收件人、销售、被取消预约的安装工（不带原因说明）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { closeRepair } from "@/lib/install/repair-service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    body = {};
  }
  const orgRes = await resolveRequestOrgIdForUser(user, typeof body.orgId === "string" ? body.orgId : request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const r = await closeRepair({ user, orgId: orgRes.orgId, repairId: id, kind: "waived", body, request });
  return NextResponse.json(r.body, { status: r.status });
});
