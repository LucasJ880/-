/**
 * GET /api/trade/signals?orgId=&prospectId=&limit=
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listSignals } from "@/lib/trade/watch-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const prospectId = url.searchParams.get("prospectId");
  if (!orgId || !prospectId) {
    return NextResponse.json(
      { error: "缺少 orgId 或 prospectId" },
      { status: 400 },
    );
  }

  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
  const items = await listSignals(orgId, prospectId, limit);
  return NextResponse.json({ items });
}
