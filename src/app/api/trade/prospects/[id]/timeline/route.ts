import { NextRequest, NextResponse } from "next/server";
import { getProspectTimeline } from "@/lib/trade/activity-log";
import {
  loadTradeProspectForOrg,
  resolveTradeOrgId,
  TRADE_READ_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_READ_KEYS);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const timeline = await getProspectTimeline(id, orgRes.orgId);
  return NextResponse.json(timeline);
}
