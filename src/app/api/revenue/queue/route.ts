/**
 * GET /api/revenue/queue — Today's Revenue Actions
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { buildRevenueQueue } from "@/lib/revenue-spine/daily-actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request);
  if (!access.ok) return access.response;
  const queue = await buildRevenueQueue(access.orgId);
  return NextResponse.json(queue);
}
