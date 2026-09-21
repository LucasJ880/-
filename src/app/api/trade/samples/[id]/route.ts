import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import {
  getTradeSampleForOrg,
  markSampleFollowedUp,
  updateTradeSampleStatus,
} from "@/lib/trade/sample-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const row = await getTradeSampleForOrg(orgRes.orgId, id);
  if (!row) return NextResponse.json({ error: "寄样单不存在" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  if (body.followedUp === true || body.action === "followed_up") {
    const result = await markSampleFollowedUp({
      orgId: orgRes.orgId,
      sampleId: id,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.sample);
  }

  const result = await updateTradeSampleStatus({
    orgId: orgRes.orgId,
    sampleId: id,
    status: String(body.status ?? ""),
    trackingNo: typeof body.trackingNo === "string" ? body.trackingNo : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.sample);
}
