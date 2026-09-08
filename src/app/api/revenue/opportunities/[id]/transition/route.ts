/**
 * POST /api/revenue/opportunities/[id]/transition  body: { to, reason?, estimatedValue? }
 * 人工阶段流转（canonical 词表 + allowed transitions；无效流转 400）
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { isOpportunityStage } from "@/lib/revenue-spine/opportunity-stage";
import { transitionOpportunity } from "@/lib/revenue-spine/transition";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  const to = body.to;
  if (!isOpportunityStage(to)) return NextResponse.json({ error: "to 必须为 canonical 阶段值", code: "INVALID_STAGE" }, { status: 400 });
  const estimatedValue = typeof body.estimatedValue === "number" && Number.isFinite(body.estimatedValue) ? body.estimatedValue : undefined;
  const result = await transitionOpportunity({
    orgId: access.orgId,
    opportunityId: id,
    to,
    actorUserId: access.auth.user.id,
    source: "human",
    reason: typeof body.reason === "string" ? body.reason.slice(0, 2000) : null,
    estimatedValue,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code, from: result.from ?? null }, { status: result.code === "NOT_FOUND" ? 404 : 400 });
  }
  return NextResponse.json(result);
}
