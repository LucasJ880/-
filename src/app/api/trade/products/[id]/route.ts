import { NextRequest, NextResponse } from "next/server";
import {
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";
import { updateTradeCatalogItem } from "@/lib/trade/catalog-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const result = await updateTradeCatalogItem({
    orgId: orgRes.orgId,
    userId: auth.user.id,
    productId: id,
    body,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.item);
}
