import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { addQuoteItem, removeQuoteItem } from "@/lib/trade/quote-service";
import { loadTradeQuoteForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeQuoteForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  if (!body.productName || !body.quantity || !body.unitPrice) {
    return NextResponse.json({ error: "productName, quantity, unitPrice 必填" }, { status: 400 });
  }

  const item = await addQuoteItem(id, body);
  return NextResponse.json(item, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId 必填" }, { status: 400 });

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id: quoteId } = await params;
  const loaded = await loadTradeQuoteForOrg(quoteId, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const item = await db.tradeQuoteItem.findFirst({
    where: { id: itemId, quoteId },
  });
  if (!item) {
    return NextResponse.json({ error: "明细不存在" }, { status: 404 });
  }

  await removeQuoteItem(itemId);
  return NextResponse.json({ success: true });
}
