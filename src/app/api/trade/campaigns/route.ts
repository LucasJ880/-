import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createCampaign, listCampaigns } from "@/lib/trade/service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
  }

  const status = url.searchParams.get("status") ?? undefined;
  const campaigns = await listCampaigns(orgId, { status });
  return NextResponse.json(campaigns);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  if (!body.orgId || !body.name || !body.productDesc || !body.targetMarket) {
    return NextResponse.json(
      { error: "orgId、name、productDesc、targetMarket 为必填" },
      { status: 400 },
    );
  }

  const campaign = await createCampaign(body, auth.user.id);
  return NextResponse.json(campaign, { status: 201 });
}
