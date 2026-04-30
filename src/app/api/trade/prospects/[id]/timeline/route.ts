import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getProspectTimeline } from "@/lib/trade/activity-log";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const timeline = await getProspectTimeline(id, orgRes.orgId);
  return NextResponse.json(timeline);
}
