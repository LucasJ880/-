/**
 * GET /api/trade/products?q=&sku=
 * GET /api/trade/products?catalog=1  货号页全表
 * POST 新增在售货号（FOB / 起订量 / 交期），不记库存。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { createTradeCatalogItem, listTradeCatalog } from "@/lib/trade/catalog-service";
import { searchTradeProductsForOrg } from "@/lib/trade/product-match";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  if (url.searchParams.get("catalog") === "1") {
    const items = await listTradeCatalog(orgRes.orgId);
    return NextResponse.json({ items });
  }
  const items = await searchTradeProductsForOrg({
    orgId: orgRes.orgId,
    query: url.searchParams.get("q") ?? undefined,
    sku: url.searchParams.get("sku") ?? undefined,
    productName: url.searchParams.get("productName") ?? undefined,
    take: 12,
  });
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const result = await createTradeCatalogItem({
    orgId: orgRes.orgId,
    userId: auth.user.id,
    body,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.item, { status: 201 });
}
