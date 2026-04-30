/**
 * GET /api/trade/intelligence — 列表
 * POST /api/trade/intelligence — 创建案例
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";
import { createIntelligenceCase } from "@/lib/trade/intelligence-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));

  const where: Record<string, unknown> = { orgId: orgRes.orgId };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { productName: { contains: search, mode: "insensitive" } },
      { brand: { contains: search, mode: "insensitive" } },
      { upc: { contains: search } },
      { mpn: { contains: search } },
    ];
  }

  const [items, total] = await Promise.all([
    db.tradeIntelligenceCase.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        productName: true,
        brand: true,
        upc: true,
        mpn: true,
        status: true,
        confidenceScore: true,
        lastRunAt: true,
        createdAt: true,
        buyerCandidates: true,
      },
    }),
    db.tradeIntelligenceCase.count({ where }),
  ]);

  const lite = items.map((c) => {
    const buyers = Array.isArray(c.buyerCandidates) ? c.buyerCandidates : [];
    const top = buyers[0] as { name?: string; confidence?: number } | undefined;
    return {
      id: c.id,
      title: c.title,
      productName: c.productName,
      brand: c.brand,
      upc: c.upc,
      mpn: c.mpn,
      status: c.status,
      confidenceScore: c.confidenceScore,
      lastRunAt: c.lastRunAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      topBuyerName: top?.name ?? null,
      topBuyerConfidence: typeof top?.confidence === "number" ? top.confidence : null,
    };
  });

  return NextResponse.json({ items: lite, total, page, pageSize });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const created = await createIntelligenceCase({
    orgId: orgRes.orgId,
    userId: auth.user.id,
    input: {
      productName: typeof body.productName === "string" ? body.productName : null,
      brand: typeof body.brand === "string" ? body.brand : null,
      upc: typeof body.upc === "string" ? body.upc : null,
      gtin: typeof body.gtin === "string" ? body.gtin : null,
      sku: typeof body.sku === "string" ? body.sku : null,
      mpn: typeof body.mpn === "string" ? body.mpn : null,
      productUrl: typeof body.productUrl === "string" ? body.productUrl : null,
      retailerName: typeof body.retailerName === "string" ? body.retailerName : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      title: typeof body.title === "string" ? body.title : null,
      sourceType: typeof body.sourceType === "string" ? body.sourceType : null,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
