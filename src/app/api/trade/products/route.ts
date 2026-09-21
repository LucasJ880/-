/**
 * GET /api/trade/products?q=&sku=
 * 组织内产品目录，供报价/寄样对货号。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { searchTradeProductsForOrg } from "@/lib/trade/product-match";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const items = await searchTradeProductsForOrg({
    orgId: orgRes.orgId,
    query: url.searchParams.get("q") ?? undefined,
    sku: url.searchParams.get("sku") ?? undefined,
    productName: url.searchParams.get("productName") ?? undefined,
    take: 12,
  });
  return NextResponse.json({ items });
}
