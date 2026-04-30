/**
 * GET /api/trade/intelligence/[id]
 * PATCH /api/trade/intelligence/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const row = await db.tradeIntelligenceCase.findFirst({
    where: { id, orgId: orgRes.orgId },
    include: {
      assets: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileUrl: true,
          fileName: true,
          fileType: true,
          assetType: true,
          extractedFields: true,
          extractedText: true,
          confidence: true,
          warnings: true,
          createdAt: true,
        },
      },
    },
  });
  if (!row) return NextResponse.json({ error: "案例不存在" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const existing = await db.tradeIntelligenceCase.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!existing) return NextResponse.json({ error: "案例不存在" }, { status: 404 });

  const data: Prisma.TradeIntelligenceCaseUpdateManyMutationInput = {};
  if (typeof body.notes === "string") data.notes = body.notes;
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.status === "string") data.status = body.status;
  if (typeof body.productName === "string") data.productName = body.productName;
  if (typeof body.brand === "string") data.brand = body.brand;
  if (typeof body.upc === "string") data.upc = body.upc;
  if (typeof body.gtin === "string") data.gtin = body.gtin;
  if (typeof body.sku === "string") data.sku = body.sku;
  if (typeof body.mpn === "string") data.mpn = body.mpn;
  if (typeof body.productUrl === "string") data.productUrl = body.productUrl;
  if (typeof body.retailerName === "string") data.retailerName = body.retailerName;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(existing);
  }

  const n = await db.tradeIntelligenceCase.updateMany({
    where: { id, orgId: orgRes.orgId },
    data,
  });
  if (n.count === 0) {
    return NextResponse.json({ error: "案例不存在或无权更新" }, { status: 404 });
  }
  const updated = await db.tradeIntelligenceCase.findFirst({
    where: { id, orgId: orgRes.orgId },
    include: {
      assets: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileUrl: true,
          fileName: true,
          fileType: true,
          assetType: true,
          extractedFields: true,
          extractedText: true,
          confidence: true,
          warnings: true,
          createdAt: true,
        },
      },
    },
  });
  return NextResponse.json(updated);
}
