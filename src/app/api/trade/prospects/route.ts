import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createProspect, listProspects } from "@/lib/trade/service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "缺少 campaignId" }, { status: 400 });
  }

  const stage = url.searchParams.get("stage") ?? undefined;
  const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;

  const result = await listProspects(campaignId, { stage, page, pageSize });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  if (!body.campaignId || !body.orgId || !body.companyName) {
    return NextResponse.json(
      { error: "campaignId、orgId、companyName 为必填" },
      { status: 400 },
    );
  }

  const prospect = await createProspect(body);
  return NextResponse.json(prospect, { status: 201 });
}
