import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  createCoachingRecord,
  getCoachingStats,
} from "@/lib/sales/coaching-service";

export const GET = withAuth(async (request, _ctx, user) => {
  const customerId = request.nextUrl.searchParams.get("customerId");
  const opportunityId = request.nextUrl.searchParams.get("opportunityId");
  const withStats = request.nextUrl.searchParams.get("stats") === "true";

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (opportunityId) where.opportunityId = opportunityId;
  if (!customerId && !opportunityId) where.userId = user.id;

  const records = await db.coachingRecord.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      opportunity: { select: { title: true, stage: true } },
      insight: { select: { title: true, insightType: true, effectiveness: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  let stats = null;
  if (withStats) {
    stats = await getCoachingStats({
      userId: user.id,
      customerId: customerId ?? undefined,
      opportunityId: opportunityId ?? undefined,
    });
  }

  return NextResponse.json({ records, stats });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const { customerId, opportunityId, insightId, coachingType, recommendation, context } = body as {
    customerId: string;
    opportunityId?: string;
    insightId?: string;
    coachingType: string;
    recommendation: string;
    context?: Record<string, string | number | boolean | null>;
  };

  if (!customerId || !recommendation) {
    return NextResponse.json({ error: "需要 customerId 和 recommendation" }, { status: 400 });
  }

  const record = await createCoachingRecord({
    userId: user.id,
    customerId,
    opportunityId,
    insightId,
    coachingType: (coachingType as "tactic" | "objection_response" | "email_draft" | "next_action") || "next_action",
    recommendation,
    context,
  });

  return NextResponse.json(record, { status: 201 });
});
