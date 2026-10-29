/**
 * POST /api/install/repairs/[id]/schedule  JSON { installAt, assignedToId, orgId? }
 * INSTALL-2e：安排返修 / 改期（spec installation/repairs「安排返修」；design D3）。
 * - 需 install.task.assign（ORG）→ 403；所选人须持 install.task.read → 400 NOT_INSTALLER
 * - 新建返修预约（或改期同一条未完成的返修预约），工艺单当前预约指向它，状态不变；审计 install.repair.scheduled
 * - 维修单已关闭 / 工艺单不在已排期 → 409；出单未登记或备好日较晚 → 200 + warnings
 * - 通知安装工、销售、确认尾款的人
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { scheduleRepair } from "@/lib/install/repair-service";

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
  const r = await scheduleRepair({ user, orgId: orgRes.orgId, repairId: id, body, request });
  return NextResponse.json(r.body, { status: r.status });
});
