import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { calculateQuoteTotal } from '@/lib/blinds/pricing-engine';
import { getAvailableFabrics, ALL_PRODUCTS } from '@/lib/blinds/pricing-data';
import { loadDiscountsDto } from '@/lib/blinds/discount-settings';
import { resolveSalesOrgIdForRequest } from '@/lib/sales/org-context';
import type { QuoteItemInput, InstallMode } from '@/lib/blinds/pricing-types';

export const POST = withAuth(async (request, _ctx, user) => {
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

  // 预览费用与正式报价同源：能解析出组织时读驾驶舱设置；请求显式传入的 deliveryFee 优先
  const orgRes = await resolveSalesOrgIdForRequest(request, user).catch(
    () => null,
  );
  const quoteSettings =
    orgRes && orgRes.ok ? await loadDiscountsDto(orgRes.orgId) : null;

  const calc = calculateQuoteTotal({
    items,
    installMode,
    deliveryFee: deliveryFee ?? quoteSettings?.deliveryFee,
    taxRate,
    ...(quoteSettings
      ? {
          sunnyMotorPrice: quoteSettings.sunnyMotorPrice,
          minInstallTotal: quoteSettings.minInstallFee,
        }
      : {}),
  });
  return NextResponse.json(calc);
});

export const GET = withAuth(async () => {
  const products = ALL_PRODUCTS.map((p) => ({
    name: p,
    fabrics: getAvailableFabrics(p),
  }));
  return NextResponse.json({ products });
});
