import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import {
  loadTradeProspectForOrg,
  loadTradeQuoteForOrg,
  resolveTradeOrgId,
} from "@/lib/trade/access";
import { createTradeSample, listTradeSamples } from "@/lib/trade/sample-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const rows = await listTradeSamples(orgRes.orgId, {
    status: url.searchParams.get("status") ?? undefined,
    prospectId: url.searchParams.get("prospectId") ?? undefined,
  });
  return NextResponse.json({ items: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (body.prospectId) {
    const p = await loadTradeProspectForOrg(String(body.prospectId), orgRes.orgId);
    if (p instanceof NextResponse) return p;
  }
  if (body.quoteId) {
    const q = await loadTradeQuoteForOrg(String(body.quoteId), orgRes.orgId);
    if (q instanceof NextResponse) return q;
  }

  const result = await createTradeSample({
    orgId: orgRes.orgId,
    userId: auth.user.id,
    prospectId: typeof body.prospectId === "string" ? body.prospectId : undefined,
    quoteId: typeof body.quoteId === "string" ? body.quoteId : undefined,
    productId: typeof body.productId === "string" ? body.productId : undefined,
    sku: typeof body.sku === "string" ? body.sku : undefined,
    productName: String(body.productName ?? ""),
    quantity: body.quantity != null ? Number(body.quantity) : undefined,
    unit: typeof body.unit === "string" ? body.unit : undefined,
    destination: typeof body.destination === "string" ? body.destination : undefined,
    recipientName: typeof body.recipientName === "string" ? body.recipientName : undefined,
    recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : undefined,
    address: typeof body.address === "string" ? body.address : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.sample, { status: 201 });
}
