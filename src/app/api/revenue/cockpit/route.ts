/**
 * GET /api/revenue/cockpit — Revenue Cockpit（Mengxin FDE V1）
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { computeRevenueCockpit } from "@/lib/revenue-spine/cockpit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request);
  if (!access.ok) return access.response;
  const cockpit = await computeRevenueCockpit(access.orgId);
  return NextResponse.json(cockpit);
}
