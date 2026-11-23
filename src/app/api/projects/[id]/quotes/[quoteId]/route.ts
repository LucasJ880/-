import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { calculateTotals } from "@/lib/quote/calculate";
import type { QuoteLineItemData } from "@/lib/quote/types";
import {
  engineQuoteHref,
  isEngineQuote,
  LEGACY_QUOTE_ENGINE_CONFLICT_ZH,
  legacyQuoteDetailView,
  legacyQuoteWriteForbiddenZh,
} from "@/lib/quote/finance-view";
import { resolveLegacyQuoteCaps } from "@/lib/quote/legacy-access";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

/**
 * FIX-26 判定顺序：项目读权限 → 报价不存在 404 → 报价引擎 / 逐行报价 / 只报总价的报价（所属组织不为空）409 →
 * 写：能编辑报价，否则 403、不读请求体、不写库。详情与修改的返回只给旧报价单字段，没有财务查看权的人内部数字为 null。
 */
function engineConflict(projectId: string, quoteId: string) {
  return NextResponse.json({ error: LEGACY_QUOTE_ENGINE_CONFLICT_ZH, href: engineQuoteHref(projectId, quoteId) }, { status: 409 });
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireProjectReadAccess(_request, id);
  if (access instanceof NextResponse) return access;

  const quote = await db.projectQuote.findUnique({
    where: { id: quoteId },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!quote || quote.projectId !== id) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (isEngineQuote(quote)) return engineConflict(id, quoteId);

  const caps = await resolveLegacyQuoteCaps(access);
  return NextResponse.json(legacyQuoteDetailView(quote, caps));
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const existing = await db.projectQuote.findUnique({
    where: { id: quoteId },
    select: { projectId: true, status: true, orgId: true },
  });
  if (!existing || existing.projectId !== id) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (isEngineQuote(existing)) return engineConflict(id, quoteId);

  const caps = await resolveLegacyQuoteCaps(access);
  if (!caps.canEdit) {
    return NextResponse.json({ error: legacyQuoteWriteForbiddenZh(caps.hintReason) }, { status: 403 });
  }

  const body = await request.json();
  const { header, lineItems } = body as {
    header?: Record<string, unknown>;
    lineItems?: QuoteLineItemData[];
  };

  const headerData: Record<string, unknown> = {};
  if (header) {
    const fields = [
      "title", "templateType", "currency", "tradeTerms",
      "paymentTerms", "deliveryDays", "validUntil", "moq",
      "originCountry", "internalNotes", "status",
    ];
    for (const f of fields) {
      if (f in header) {
        if (f === "validUntil" && header[f]) {
          headerData[f] = new Date(header[f] as string);
        } else {
          headerData[f] = header[f];
        }
      }
    }
  }

  if (lineItems && Array.isArray(lineItems)) {
    const totals = calculateTotals(lineItems);
    headerData.subtotal = totals.subtotal;
    headerData.totalAmount = totals.totalAmount;
    headerData.internalCost = totals.internalCost;
    headerData.profitMargin = totals.profitMargin;

    await db.$transaction([
      db.quoteLineItem.deleteMany({ where: { quoteId } }),
      ...lineItems.map((item, idx) =>
        db.quoteLineItem.create({
          data: {
            quoteId,
            sortOrder: idx,
            category: item.category ?? "product",
            itemName: item.itemName ?? "",
            specification: item.specification ?? "",
            unit: item.unit ?? "",
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            remarks: item.remarks ?? "",
            costPrice: item.costPrice,
            // FIX-26：旧报价单的行都是客户行（编辑器、合计、PDF、Excel 都把全部行当客户行），不采用请求里的值
            isInternal: false,
          },
        })
      ),
      db.projectQuote.update({
        where: { id: quoteId },
        data: headerData,
      }),
    ]);
  } else if (Object.keys(headerData).length > 0) {
    await db.projectQuote.update({
      where: { id: quoteId },
      data: headerData,
    });
  }

  const updated = await db.projectQuote.findUnique({
    where: { id: quoteId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json(updated ? legacyQuoteDetailView(updated, caps) : null);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const existing = await db.projectQuote.findUnique({
    where: { id: quoteId },
    select: { projectId: true, status: true, orgId: true },
  });
  if (!existing || existing.projectId !== id) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (isEngineQuote(existing)) return engineConflict(id, quoteId);

  const caps = await resolveLegacyQuoteCaps(access);
  if (!caps.canEdit) {
    return NextResponse.json({ error: legacyQuoteWriteForbiddenZh(caps.hintReason) }, { status: 403 });
  }
  if (existing.status !== "draft") {
    return NextResponse.json({ error: "只能删除草稿报价" }, { status: 400 });
  }

  await db.projectQuote.delete({ where: { id: quoteId } });
  return NextResponse.json({ ok: true });
}
