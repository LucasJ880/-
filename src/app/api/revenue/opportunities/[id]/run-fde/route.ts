/**
 * POST /api/revenue/opportunities/[id]/run-fde — 手动（重）跑 Inbound Sales FDE
 * body.salesActionId 指向该商机的来信行动时经原子认领执行：同一来信的 FDE 正在别处执行 → 409 FDE_IN_FLIGHT，
 * 不并行；已结束的照旧重跑（人工明确要求）。不带 salesActionId（页面上的「重跑」按钮）→ 按原行为直接跑。
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { REVENUE_MANAGE_KEYS, resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { runInboundFdeForHuman } from "@/lib/revenue-spine/fde/inbound-queue";

export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, REVENUE_MANAGE_KEYS, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  const result = await runInboundFdeForHuman({
    orgId: access.orgId,
    opportunityId: id,
    trigger: "manual",
    by: "manual",
    actorUserId: access.auth.user.id,
    salesActionId: typeof body.salesActionId === "string" ? body.salesActionId : null,
    rerunFinished: true,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.errorCode === "NOT_FOUND" ? 404 : 409 });
}
