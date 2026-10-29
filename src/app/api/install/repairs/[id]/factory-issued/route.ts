/**
 * POST /api/install/repairs/[id]/factory-issued  JSON { readyDate, note?, orgId? }
 * INSTALL-2e：出单确认按品类登记（spec installation/repairs「出单确认按品类登记」；design D2）。
 * - 只对持该维修单待登记品类修改键或伞键的成员开放（403）；品类推不出的需工厂行任一品类岗可登记
 * - 409 NOT_NEEDED（无需工厂）/ ALREADY_ISSUED（能登记的已登记）/ CLOSED；400 入参
 * - 成功：审计 install.repair.factory_issued；通知排安装的人与销售
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { issueFactory } from "@/lib/install/repair-service";

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
  const r = await issueFactory({ user, orgId: orgRes.orgId, repairId: id, body, request });
  return NextResponse.json(r.body, { status: r.status });
});
