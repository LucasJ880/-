/**
 * 公开报价查看 API — 无需登录
 * 通过 shareToken 获取报价详情
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return NextResponse.json({ error: "无效的分享链接" }, { status: 400 });
  }

  const quote = await db.salesQuote.findUnique({
    where: { shareToken: token },
    include: {
      customer: { select: { name: true } },
      items: { orderBy: { sortOrder: "asc" } },
      addons: true,
      rooms: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价不存在或链接已失效" }, { status: 404 });
  }

  if (!quote.viewedAt) {
    await db.salesQuote.update({
      where: { id: quote.id },
      data: {
        viewedAt: new Date(),
        status: quote.status === "sent" ? "viewed" : quote.status,
      },
    });
  }

  return NextResponse.json({
    quote: {
      id: quote.id,
      customerName: quote.customer.name,
      version: quote.version,
      status: quote.status,
      installMode: quote.installMode,
      currency: quote.currency,
      merchSubtotal: quote.merchSubtotal,
      addonsSubtotal: quote.addonsSubtotal,
      installApplied: quote.installApplied,
      deliveryFee: quote.deliveryFee,
      preTaxTotal: quote.preTaxTotal,
      taxRate: quote.taxRate,
      taxAmount: quote.taxAmount,
      grandTotal: quote.grandTotal,
      notes: quote.notes,
      signatureUrl: quote.signatureUrl,
      signedAt: quote.signedAt,
      createdAt: quote.createdAt,
      createdBy: quote.createdBy?.name,
      rooms: quote.rooms.map((r) => ({
        roomName: r.roomName,
        items: r.items.map((i) => ({
          product: i.product,
          fabric: i.fabric,
          widthIn: i.widthIn,
          heightIn: i.heightIn,
          msrp: i.msrp,
          price: i.price,
          installFee: i.installFee,
          location: i.location,
        })),
      })),
      items: quote.items.map((i) => ({
        product: i.product,
        fabric: i.fabric,
        widthIn: i.widthIn,
        heightIn: i.heightIn,
        msrp: i.msrp,
        price: i.price,
        installFee: i.installFee,
        location: i.location,
      })),
      addons: quote.addons.map((a) => ({
        displayName: a.displayName,
        qty: a.qty,
        unitPrice: a.unitPrice,
        subtotal: a.subtotal,
      })),
    },
  });
}
