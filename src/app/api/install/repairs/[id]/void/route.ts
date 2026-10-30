/**
 * POST /api/install/repairs/[id]/void  JSON { reason, orgId? }
 * INSTALL-2f：作废维修单（spec installation/repairs「维修单作废的条件」「维修单作废的效果」；design D2）。
 * - 需 install.task.assign（ORG）→ 403；他企业 404；原因为空或超过 500 字 → 400
 * - 已关闭 → 409 CLOSED；返修预约上提交的 → 409 RETURN_VISIT（改用关闭不返修）；工艺单不是已排期 / 提交预约已取消 → 409 ORDER_STATUS
 * - 成功：install.repair.completed（voided）；取消未完成的返修预约；提交预约回到已排期；工艺单指回它
 * - 通知提交时的收件人、销售、重新打开 / 被取消预约的安装工（不带原因说明）
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
  const r = await closeRepair({ user, orgId: orgRes.orgId, repairId: id, kind: "voided", body, request });
  return NextResponse.json(r.body, { status: r.status });
});
