/**
 * POST /api/revenue/opportunities/[id]/run-fde — 手动（重）跑 Inbound Sales FDE
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { runInboundSalesFde } from "@/lib/revenue-spine/fde/inbound-sales";

export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  const result = await runInboundSalesFde({
    orgId: access.orgId,
    opportunityId: id,
    trigger: "manual",
    actorUserId: access.auth.user.id,
    salesActionId: typeof body.salesActionId === "string" ? body.salesActionId : null,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.errorCode === "NOT_FOUND" ? 404 : 409 });
}
