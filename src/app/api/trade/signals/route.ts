/**
 * GET /api/trade/signals?orgId= 必填
 *     &prospectId= &pageType= &limit= 可选
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listSignalsForOrg } from "@/lib/trade/watch-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
  }

  const prospectId = url.searchParams.get("prospectId") ?? undefined;
  const pageType = url.searchParams.get("pageType") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) || 50 : 50;

  const items = await listSignalsForOrg(orgId, { prospectId, pageType, limit });
  return NextResponse.json({ items });
}
