import { NextRequest, NextResponse } from "next/server";
import { updateCampaign, deleteCampaign } from "@/lib/trade/service";
import {
  loadTradeCampaignForOrg,
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
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
  const loaded = await loadTradeCampaignForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json(loaded.campaign);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeCampaignForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const { orgId: _o, id: _i, ...safe } = body as Record<string, unknown>;
  const campaign = await updateCampaign(id, safe);
  return NextResponse.json(campaign);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeCampaignForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  await deleteCampaign(id);
  return NextResponse.json({ ok: true });
}
