/**
 * GET /api/revenue/opportunities/[id] — 商机详情：RFQ + 证据 + 评分 + 行动 + 互动 + 结果 + 待审批
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";
import { ALLOWED_TRANSITIONS, toCanonicalStage } from "@/lib/revenue-spine/opportunity-stage";
import { listOpportunityOutcomes } from "@/lib/revenue-spine/outcomes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const access = await resolveRevenueAccess(request);
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  const opp = await db.salesOpportunity.findFirst({
    where: { id, orgId: access.orgId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, contactName: true, website: true, country: true, emailDomain: true, source: true } },
      assignedTo: { select: { id: true, name: true } },
      rfq: { include: { evidence: { orderBy: { createdAt: "desc" }, take: 200 } } },
      assessments: { orderBy: { createdAt: "desc" }, take: 5 },
      salesActions: { orderBy: { createdAt: "desc" }, take: 50 },
      interactions: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, direction: true, channel: true, summary: true, content: true, language: true, createdAt: true, createdById: true } },
    },
  });
  if (!opp) return NextResponse.json({ error: "商机不存在" }, { status: 404 });
  const [outcomes, pendingApprovals, runs] = await Promise.all([
    listOpportunityOutcomes(access.orgId, opp.id),
    db.pendingAction.findMany({
      where: { orgId: access.orgId, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: opp.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, title: true, preview: true, createdAt: true, expiresAt: true, decidedAt: true, decidedById: true, failureReason: true, agentRunId: true, approverUserId: true },
    }),
    db.agentRun.findMany({
      where: { orgId: access.orgId, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: opp.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, intent: true, createdAt: true, completedAt: true, errorCode: true, errorMessage: true, events: { orderBy: { sequence: "asc" }, select: { eventType: true, title: true, payload: true, createdAt: true } } },
    }),
  ]);
  const canonical = toCanonicalStage(opp.stage);
  return NextResponse.json({
    opportunity: opp,
    allowedTransitions: canonical && canonical === opp.stage ? ALLOWED_TRANSITIONS[canonical] : [],
    outcomes,
    pendingApprovals,
    runs,
  });
}
