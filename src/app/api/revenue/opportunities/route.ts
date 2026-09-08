/**
 * GET /api/revenue/opportunities?stage=&grade=&q= — canonical 商机列表（ORG 范围）
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { OPEN_STAGES, isOpportunityStage } from "@/lib/revenue-spine/opportunity-stage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request);
  if (!access.ok) return access.response;
  const sp = request.nextUrl.searchParams;
  const stage = sp.get("stage") ?? "";
  const grade = sp.get("grade") ?? "";
  const q = (sp.get("q") ?? "").trim();
  const scope = sp.get("scope") ?? "open";
  const where: Record<string, unknown> = { orgId: access.orgId, customer: { archivedAt: null } };
  if (stage && isOpportunityStage(stage)) where.stage = stage;
  else if (scope === "open") where.stage = { in: [...OPEN_STAGES] };
  if (grade) where.scoreGrade = grade.toUpperCase();
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { customer: { email: { contains: q, mode: "insensitive" } } }];
  const rows = await db.salesOpportunity.findMany({
    where,
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true, title: true, stage: true, source: true, score: true, scoreGrade: true, estimatedValue: true, market: true, buyerType: true,
      nextActionType: true, nextFollowupAt: true, nextActionReason: true, lastInteractionAt: true, lastCustomerReplyAt: true, lastOutboundAt: true,
      followUpCount: true, fdeSourced: true, fdeInfluenced: true, createdAt: true, updatedAt: true, stageChangedAt: true,
      customer: { select: { id: true, name: true, email: true, contactName: true, country: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ opportunities: rows });
}
