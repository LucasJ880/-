import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { updateProspect } from "@/lib/trade/service";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { parseStrictTradeProspectStage } from "@/lib/trade/stage";

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
  return NextResponse.json(loaded.prospect);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const { orgId: _o, campaignId: _c, id: _i, ...safe } = body as Record<string, unknown>;
  if ("stage" in safe && safe.stage !== undefined) {
    const parsed = parseStrictTradeProspectStage(safe.stage);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    safe.stage = parsed.stage;
  }
  const prospect = await updateProspect(id, safe);
  return NextResponse.json(prospect);
}
