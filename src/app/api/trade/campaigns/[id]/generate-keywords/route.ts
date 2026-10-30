import { NextRequest, NextResponse } from "next/server";
import { updateCampaign } from "@/lib/trade/service";
import { generateSearchKeywords } from "@/lib/trade/agents";
import {
  loadTradeCampaignForOrg,
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeCampaignForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { campaign } = loaded;

  const keywords = await generateSearchKeywords(
    campaign.productDesc,
    campaign.targetMarket,
  );

  await updateCampaign(id, { searchKeywords: keywords });

  return NextResponse.json({ keywords });
}
