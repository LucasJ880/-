import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listQuotes, createQuote } from "@/lib/trade/quote-service";
import {
  loadTradeCampaignForOrg,
  loadTradeProspectForOrg,
  resolveTradeOrgId,
} from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const prospectId = searchParams.get("prospectId") ?? undefined;

  if (prospectId) {
    const p = await loadTradeProspectForOrg(prospectId, orgRes.orgId);
    if (p instanceof NextResponse) return p;
  }

  const quotes = await listQuotes(orgRes.orgId, { status, prospectId });
  return NextResponse.json(quotes);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (!body.companyName) {
    return NextResponse.json({ error: "companyName 必填" }, { status: 400 });
  }

  if (body.prospectId) {
    const p = await loadTradeProspectForOrg(String(body.prospectId), orgRes.orgId);
    if (p instanceof NextResponse) return p;
  }
  if (body.campaignId) {
    const c = await loadTradeCampaignForOrg(String(body.campaignId), orgRes.orgId);
    if (c instanceof NextResponse) return c;
  }

  const quote = await createQuote(
    {
      orgId: orgRes.orgId,
      prospectId: body.prospectId,
      campaignId: body.campaignId,
      companyName: body.companyName,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      country: body.country,
      currency: body.currency,
      incoterm: body.incoterm,
      paymentTerms: body.paymentTerms,
      validDays: body.validDays,
      leadTimeDays: body.leadTimeDays,
      moq: body.moq,
      shippingPort: body.shippingPort,
      notes: body.notes,
      internalNotes: body.internalNotes,
      items: body.items,
    },
    auth.user.id,
  );
  return NextResponse.json(quote, { status: 201 });
}
