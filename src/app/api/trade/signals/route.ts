/**
 * GET /api/trade/signals?orgId= 必填
 *     &prospectId= &pageType= &limit= 可选
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listSignalsForOrg } from "@/lib/trade/watch-service";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const prospectId = url.searchParams.get("prospectId") ?? undefined;
  const pageType = url.searchParams.get("pageType") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) || 50 : 50;

  if (prospectId) {
    const p = await loadTradeProspectForOrg(prospectId, orgRes.orgId);
    if (p instanceof NextResponse) return p;
  }

  const items = await listSignalsForOrg(orgRes.orgId, { prospectId, pageType, limit });
  return NextResponse.json({ items });
}
