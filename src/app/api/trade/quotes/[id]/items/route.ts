import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { addQuoteItem, removeQuoteItem } from "@/lib/trade/quote-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json();

  if (!body.productName || !body.quantity || !body.unitPrice) {
    return NextResponse.json({ error: "productName, quantity, unitPrice 必填" }, { status: 400 });
  }

  const item = await addQuoteItem(id, body);
  return NextResponse.json(item, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId 必填" }, { status: 400 });

  await removeQuoteItem(itemId);
  return NextResponse.json({ success: true });
}
