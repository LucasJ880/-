import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createCampaign, listCampaigns } from "@/lib/trade/service";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const campaigns = await listCampaigns(orgRes.orgId, { status });
  return NextResponse.json(campaigns);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (!body.name || !body.productDesc || !body.targetMarket) {
    return NextResponse.json(
      { error: "name、productDesc、targetMarket 为必填" },
      { status: 400 },
    );
  }

  const campaign = await createCampaign(
    {
      orgId: orgRes.orgId,
      name: body.name,
      productDesc: body.productDesc,
      targetMarket: body.targetMarket,
      scoreThreshold: body.scoreThreshold,
    },
    auth.user.id,
  );
  return NextResponse.json(campaign, { status: 201 });
}
