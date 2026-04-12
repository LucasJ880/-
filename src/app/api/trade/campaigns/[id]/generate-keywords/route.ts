import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getCampaign, updateCampaign } from "@/lib/trade/service";
import { generateSearchKeywords } from "@/lib/trade/agents";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "活动不存在" }, { status: 404 });
  }

  const keywords = await generateSearchKeywords(
    campaign.productDesc,
    campaign.targetMarket,
  );

  await updateCampaign(id, { searchKeywords: keywords });

  return NextResponse.json({ keywords });
}
