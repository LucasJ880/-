import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import { calculateQuoteTotal } from '@/lib/blinds/pricing-engine';
import type { QuoteItemInput, QuoteAddonInput, InstallMode } from '@/lib/blinds/pricing-types';
import { onQuoteCreated } from '@/lib/sales/opportunity-lifecycle';
import { getAddonDef } from '@/lib/blinds/pricing-addons';

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const {
    customerId,
    opportunityId,
    items,
    addons,
    installMode,
    deliveryFee,
    taxRate,
    notes,
    orderNumber,
    formDataJson,
    totalMsrp,
    specialPromotion,
    finalDiscountPct,
  } = body as {
    customerId: string;
    opportunityId?: string;
    items: QuoteItemInput[];
    addons?: QuoteAddonInput[];
    installMode?: InstallMode;
    deliveryFee?: number;
    taxRate?: number;
    notes?: string;
    orderNumber?: string;
    formDataJson?: string;
    totalMsrp?: number;
    specialPromotion?: number;
    finalDiscountPct?: number;
  };

  if (!customerId || !items?.length) {
    return NextResponse.json({ error: '客户和产品项不能为空' }, { status: 400 });
  }

  const calc = calculateQuoteTotal({ items, addons, installMode, deliveryFee, taxRate });

  if (calc.errors.length > 0 && calc.itemResults.length === 0) {
    return NextResponse.json(
      { error: '所有产品项计算失败', details: calc.errors },
      { status: 400 },
    );
  }

  const existingCount = await db.salesQuote.count({ where: { customerId } });
  const shareToken = randomBytes(16).toString('hex');

  const quote = await db.salesQuote.create({
    data: {
      customerId,
      opportunityId: opportunityId || null,
      version: existingCount + 1,
      shareToken,
      orderNumber: orderNumber || null,
      installMode: installMode || 'default',
      merchSubtotal: calc.merchSubtotal,
      addonsSubtotal: calc.addonsSubtotal,
      installSubtotal: calc.installSubtotal,
      installApplied: calc.installApplied,
      deliveryFee: calc.deliveryFee,
      preTaxTotal: calc.preTaxTotal,
      taxRate: calc.taxRate,
      taxAmount: calc.taxAmount,
      grandTotal: calc.grandTotal,
      notes: notes || null,
      formDataJson: formDataJson || null,
      // Step 4：折扣率追踪
      totalMsrp: typeof totalMsrp === "number" && Number.isFinite(totalMsrp) ? totalMsrp : null,
      specialPromotion:
        typeof specialPromotion === "number" && Number.isFinite(specialPromotion)
          ? Math.max(0, specialPromotion)
          : 0,
      finalDiscountPct:
        typeof finalDiscountPct === "number" && Number.isFinite(finalDiscountPct)
          ? Math.max(0, Math.min(1, finalDiscountPct))
          : null,
      createdById: user.id,
      items: {
        create: calc.itemResults.map((r, idx) => ({
          sortOrder: idx,
          product: r.input.product,
          fabric: r.input.fabric,
          sku: r.input.sku || null,
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
      addons: addons?.length
        ? {
            create: addons.map((a) => {
              const def = getAddonDef(a.addonKey);
              return {
                addonKey: a.addonKey,
                displayName: def?.displayName || a.addonKey,
                unitPrice: def?.unitPrice || 0,
                qty: a.qty,
                subtotal: (def?.unitPrice || 0) * a.qty,
              };
            }),
          }
        : undefined,
    },
    include: { items: true, addons: true },
  });

  const lifecycle = await onQuoteCreated(
    quote.id,
    customerId,
    calc.grandTotal,
    opportunityId || null,
  ).catch((err) => {
    console.error("Lifecycle automation error:", err);
    return { opportunityId: null, advanced: false };
  });

  return NextResponse.json({
    quote,
    errors: calc.errors,
    lifecycle: {
      opportunityId: lifecycle.opportunityId,
      autoAdvanced: lifecycle.advanced,
    },
  }, { status: 201 });
});
