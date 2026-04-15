/**
 * 量房记录一键生成报价
 *
 * 读取 MeasurementRecord 的所有窗位，调用定价引擎计算，
 * 创建 SalesQuote + QuoteRoom + SalesQuoteItem。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import { ALL_PRODUCTS, getAvailableFabrics } from "@/lib/blinds/pricing-data";
import type { ProductName, QuoteItemInput } from "@/lib/blinds/pricing-types";
import { randomBytes } from "crypto";

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const installMode = (body.installMode as string) ?? "default";

  const record = await db.measurementRecord.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      windows: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!record) return NextResponse.json({ error: "量房记录不存在" }, { status: 404 });

  const windowsWithProduct = record.windows.filter((w) => w.product && w.widthIn > 0 && w.heightIn > 0);
  if (windowsWithProduct.length === 0) {
    return NextResponse.json({ error: "没有已选产品的窗位，请先选择产品类型" }, { status: 400 });
  }

  const items: QuoteItemInput[] = windowsWithProduct.map((w) => {
    const product = (ALL_PRODUCTS.includes(w.product as ProductName) ? w.product : "Zebra") as ProductName;
    const fabric = w.fabric || getAvailableFabrics(product)[0];
    return {
      product,
      fabric,
      widthIn: w.widthIn,
      heightIn: w.heightIn,
      cordless: w.cordless,
      location: `${w.roomName}${w.windowLabel ? ` - ${w.windowLabel}` : ""}`,
    };
  });

  const calc = calculateQuoteTotal({
    items,
    installMode: installMode === "pickup" ? "pickup" : "default",
  });

  if (calc.itemResults.length === 0) {
    return NextResponse.json({ error: "所有产品计算失败", details: calc.errors }, { status: 400 });
  }

  const existingCount = await db.salesQuote.count({ where: { customerId: record.customerId } });
  const shareToken = randomBytes(16).toString("hex");

  const roomGroups = new Map<string, typeof calc.itemResults>();
  for (const item of calc.itemResults) {
    const roomName = item.input.location?.split(" - ")[0] ?? "Default";
    const group = roomGroups.get(roomName) ?? [];
    group.push(item);
    roomGroups.set(roomName, group);
  }

  const quote = await db.salesQuote.create({
    data: {
      customerId: record.customerId,
      opportunityId: record.opportunityId,
      version: existingCount + 1,
      installMode,
      aiSource: "measurement",
      shareToken,
      merchSubtotal: calc.merchSubtotal,
      addonsSubtotal: calc.addonsSubtotal,
      installSubtotal: calc.installSubtotal,
      installApplied: calc.installApplied,
      deliveryFee: calc.deliveryFee,
      preTaxTotal: calc.preTaxTotal,
      taxRate: calc.taxRate,
      taxAmount: calc.taxAmount,
      grandTotal: calc.grandTotal,
      createdById: user.id,
      rooms: {
        create: Array.from(roomGroups.entries()).map(([roomName, groupItems], roomIdx) => ({
          roomName,
          sortOrder: roomIdx,
          items: {
            create: groupItems.map((r, idx) => ({
              quoteId: undefined as any,
              sortOrder: idx,
              product: r.input.product,
              fabric: r.input.fabric,
              widthIn: r.input.widthIn,
              heightIn: r.input.heightIn,
              bracketWidth: r.bracketWidth,
              bracketHeight: r.bracketHeight,
              cordless: r.cordless,
              msrp: r.msrp,
              discountPct: r.discountPct,
              discountValue: r.discountValue,
              price: r.price,
              installFee: r.install,
              location: r.input.location || null,
            })),
          },
        })),
      },
    },
    include: {
      rooms: { include: { items: true } },
    },
  });

  await db.measurementRecord.update({
    where: { id },
    data: { status: "quoted" },
  });

  return NextResponse.json({
    quote: {
      id: quote.id,
      shareToken,
      grandTotal: quote.grandTotal,
      roomCount: quote.rooms.length,
      itemCount: quote.rooms.reduce((s, r) => s + r.items.length, 0),
    },
    errors: calc.errors,
  }, { status: 201 });
});
