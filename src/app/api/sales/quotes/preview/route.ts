import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { calculateQuoteTotal } from '@/lib/blinds/pricing-engine';
import { getAvailableFabrics, ALL_PRODUCTS } from '@/lib/blinds/pricing-data';
import type { QuoteItemInput, InstallMode } from '@/lib/blinds/pricing-types';

export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { items, installMode, deliveryFee, taxRate } = body as {
    items: QuoteItemInput[];
    installMode?: InstallMode;
    deliveryFee?: number;
    taxRate?: number;
  };

  if (!items?.length) {
    return NextResponse.json({ error: '至少需要一项产品' }, { status: 400 });
  }

  const calc = calculateQuoteTotal({ items, installMode, deliveryFee, taxRate });
  return NextResponse.json(calc);
});

export const GET = withAuth(async () => {
  const products = ALL_PRODUCTS.map((p) => ({
    name: p,
    fabrics: getAvailableFabrics(p),
  }));
  return NextResponse.json({ products });
});
